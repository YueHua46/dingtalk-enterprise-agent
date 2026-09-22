import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../dist/config.js';
import { RedisTaskQueue } from '../dist/task-queue.js';

const suffix = randomUUID();
const config = loadConfig({
  NODE_ENV: 'test',
  DINGTALK_ROBOT_CODE: 'robot',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  TASK_QUEUE_NAME: 'dingtalk-agent-smoke-' + suffix,
  MAX_CONCURRENT_USERS: '4'
});
const queue = new RedisTaskQueue(config);
const active = new Map();
let sameUserMax = 0;
const completed = [];
const failedAttempts = new Map();

await queue.start(async (taskId) => {
  const user = taskId.includes('user-a') ? 'user-a' : taskId.includes('user-b') ? 'user-b' : 'user-c';
  const count = (active.get(user) ?? 0) + 1;
  active.set(user, count);
  if (user === 'user-a') sameUserMax = Math.max(sameUserMax, count);
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (taskId.includes('user-c-fail')) {
    failedAttempts.set(taskId, (failedAttempts.get(taskId) ?? 0) + 1);
    active.set(user, count - 1);
    throw new Error('intentional queue smoke failure');
  }
  completed.push(taskId);
  active.set(user, count - 1);
});

try {
  const makeTask = (name, userId, createdAt) => ({
    id: name + '-' + suffix,
    request: {
      requestId: 'request-' + name,
      messageId: 'message-' + name,
      user: { corpId: 'smoke-corp-' + suffix, userId },
      surface: { type: 'direct', id: userId },
      text: name,
      attachments: [],
      receivedAt: createdAt
    },
    status: 'queued',
    createdAt
  });
  const base = Date.now();
  await Promise.all([
    queue.enqueue(makeTask('user-a-1', 'user-a', base)),
    queue.enqueue(makeTask('user-a-2', 'user-a', base)),
    queue.enqueue(makeTask('user-a-3', 'user-a', base)),
    queue.enqueue(makeTask('user-b-1', 'user-b', base)),
    queue.enqueue(makeTask('user-c-fail', 'user-c', base)),
    queue.enqueue(makeTask('user-c-after', 'user-c', base))
  ]);
  const deadline = Date.now() + 30_000;
  while (completed.length < 5 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(completed.length, 5);
  assert.equal(sameUserMax, 1);
  assert.deepEqual(completed.filter((id) => id.includes('user-a')).map((id) => id.split('-' + suffix)[0]), ['user-a-1', 'user-a-2', 'user-a-3']);
  assert.equal(failedAttempts.values().next().value, 5);
  assert.equal(completed.some((id) => id.includes('user-c-after')), true);
  console.log(JSON.stringify({ ok: true, sameUserMax, completed: completed.length, exhaustedFailureUnblocked: true }));
} finally {
  await queue.close();
}
