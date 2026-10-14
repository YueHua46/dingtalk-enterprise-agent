import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { TaskRecoveryError } from './task-recovery.js';
import type { TaskRecoveryRequest } from './task-recovery.js';

const inputSchema = z.object({
  requestId: z.string().min(1).max(128),
  user: z.object({corpId:z.string().min(1).max(256),userId:z.string().min(1).max(256)}).strict(),
  surface: z.object({type:z.enum(['direct','group']),id:z.string().min(1).max(512)}).strict()
}).strict();

export function registerTaskRecoveryRoute(app: FastifyInstance, token: string | undefined,
  resume: (taskId: string, request: TaskRecoveryRequest) => Promise<void>): void {
  app.post<{Params:{taskId:string}}>('/internal/tasks/:taskId/resume', {bodyLimit:4096}, async (request, reply) => {
    const received = request.headers['x-internal-token'];
    if (!token || typeof received !== 'string' || Buffer.byteLength(received) !== Buffer.byteLength(token)
      || !timingSafeEqual(Buffer.from(received),Buffer.from(token))) return reply.code(401).send({ok:false,error:'unauthorized'});
    const parsed = inputSchema.safeParse(request.body);
    if (!z.uuid().safeParse(request.params.taskId).success || !parsed.success) return reply.code(400).send({ok:false,error:'invalid_recovery_request'});
    try {
      await resume(request.params.taskId, parsed.data);
      return reply.code(202).send({ok:true,taskId:request.params.taskId});
    } catch (error) {
      if (error instanceof TaskRecoveryError) return reply.code(error.code === 'TASK_RECOVERY_NOT_FOUND' ? 404 : 409).send({ok:false,error:error.code});
      request.log.error({error:error instanceof Error ? error.name : 'UnknownError'},'task recovery scheduling failed');
      return reply.code(503).send({ok:false,error:'task_recovery_unavailable'});
    }
  });
}
