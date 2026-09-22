import { randomUUID } from 'node:crypto';
import { DelayedError, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Config } from './config.js';
import { sha256 } from './security.js';
import type { TaskRecord } from './types.js';

interface TaskJob {
  taskId: string;
  userKey: string;
  createdAt: number;
}

export interface TaskQueue {
  start(handler: (taskId: string) => Promise<void>): Promise<void>;
  enqueue(task: TaskRecord): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export class RedisTaskQueue implements TaskQueue {
  private readonly queueName: string;
  private readonly redis: Redis;
  private readonly queueConnection: Redis;
  private readonly workerConnection: Redis;
  private readonly queue: Queue<TaskJob>;
  private worker?: Worker<TaskJob>;

  public constructor(private readonly config: Config) {
    this.queueName = config.TASK_QUEUE_NAME;
    this.redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: true });
    this.queueConnection = this.redis.duplicate();
    this.workerConnection = this.redis.duplicate();
    this.queue = new Queue<TaskJob>(this.queueName, { connection: this.queueConnection });
  }

  public async start(handler: (taskId: string) => Promise<void>): Promise<void> {
    if (this.worker) return;
    await Promise.all([this.connect(this.redis), this.connect(this.queueConnection), this.connect(this.workerConnection)]);
    await this.cleanupExhaustedJobs();
    this.worker = new Worker<TaskJob>(
      this.queueName,
      async (job, bullToken) => {
        const sequenceKey = this.sequenceKey(job.data.userKey);
        const head = await this.redis.zrange(sequenceKey, 0, 0);
        if (head[0] !== job.data.taskId) {
          await job.moveToDelayed(Date.now() + 250, bullToken);
          throw new DelayedError();
        }

        const lockKey = this.lockKey(job.data.userKey);
        const lockToken = randomUUID();
        const acquired = await this.redis.set(lockKey, lockToken, 'PX', 30_000, 'NX');
        if (acquired !== 'OK') {
          await job.moveToDelayed(Date.now() + 250, bullToken);
          throw new DelayedError();
        }

        const renew = setInterval(() => {
          void this.redis.eval(RENEW_LOCK_SCRIPT, 1, lockKey, lockToken, '30000');
        }, 10_000);
        renew.unref();
        try {
          await handler(job.data.taskId);
          await this.redis.zrem(sequenceKey, job.data.taskId);
        } finally {
          clearInterval(renew);
          await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockToken).catch(() => undefined);
        }
      },
      {
        connection: this.workerConnection,
        concurrency: this.config.MAX_CONCURRENT_USERS
      }
    );
    this.worker.on('failed', (job) => {
      if (!job || job.attemptsMade < Number(job.opts.attempts ?? 1)) return;
      void this.redis.zrem(this.sequenceKey(job.data.userKey), job.data.taskId).catch(() => undefined);
    });
    await this.worker.waitUntilReady();
  }

  public async enqueue(task: TaskRecord): Promise<void> {
    const userKey = task.request.user.corpId + ':' + task.request.user.userId;
    const sequenceKey = this.sequenceKey(userKey);
    const sequence = await this.redis.incr(this.sequenceCounterKey(userKey));
    await this.redis.zadd(sequenceKey, 'NX', sequence, task.id);
    try {
      await this.queue.add('execute', { taskId: task.id, userKey, createdAt: task.createdAt }, {
        jobId: task.id,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 1000
      });
    } catch (error) {
      await this.redis.zrem(sequenceKey, task.id).catch(() => undefined);
      throw error;
    }
  }

  public async ping(): Promise<void> {
    await this.connect(this.redis);
    const response = await this.redis.ping();
    if (response !== 'PONG') throw new Error('Redis PING failed');
  }

  public async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    await Promise.allSettled([
      this.quit(this.workerConnection),
      this.quit(this.queueConnection),
      this.quit(this.redis)
    ]);
  }

  private async connect(connection: Redis): Promise<void> {
    if (connection.status === 'wait') await connection.connect();
    if (connection.status === 'connecting') await new Promise<void>((resolve, reject) => {
      connection.once('ready', resolve);
      connection.once('error', reject);
    });
  }

  private async quit(connection: Redis): Promise<void> {
    if (connection.status !== 'end') await connection.quit();
  }

  private sequenceKey(userKey: string): string {
    return 'agent:user:' + sha256(userKey) + ':sequence';
  }

  private lockKey(userKey: string): string {
    return 'agent:user:' + sha256(userKey) + ':lock';
  }

  private sequenceCounterKey(userKey: string): string {
    return 'agent:user:' + sha256(userKey) + ':sequence-counter';
  }

  private async cleanupExhaustedJobs(): Promise<void> {
    const failed = await this.queue.getJobs(['failed'], 0, 999);
    await Promise.all(failed
      .filter((job) => job.attemptsMade >= Number(job.opts.attempts ?? 1))
      .map((job) => this.redis.zrem(this.sequenceKey(job.data.userKey), job.data.taskId)));
  }
}

const RENEW_LOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;
