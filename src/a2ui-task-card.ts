import { A2UI_CATALOG } from './a2ui-tool.js';
import type { DwsBroker } from './dws-broker.js';
import type { Repository } from './persistence.js';
import type { TaskRecord } from './types.js';
import { sha256 } from './security.js';

export type TaskCardPhase = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting';
export interface TaskCardView {
  phase: TaskCardPhase;
  activity: string;
  steps: string;
  answer: string;
}
/** The host response transport must send as the Agent, never as the requester. */
export interface A2uiRobotTransport {
  identity: 'robot';
  create(task: TaskRecord, messages: string[]): Promise<{ bizId: string }>;
  update(task: TaskRecord, bizId: string, messages: string[], flowStatus: 'INPUTTING' | 'FINISH'): Promise<void>;
}
export const initialTaskCardView = (): TaskCardView => ({ phase: 'queued', activity: '准备处理任务', steps: '任务已受理，正在准备处理。', answer: '' });
const terminal = (phase: TaskCardPhase) => ['completed', 'failed', 'cancelled'].includes(phase);
const title = (view: TaskCardView) => (({ completed: '处理完成', failed: '处理未完成', cancelled: '已取消' } as Partial<Record<TaskCardPhase, string>>)[view.phase]
  ?? (view.phase === 'waiting' ? view.activity : 'Thinking · ' + view.activity));

function components(view: TaskCardView): Record<string, unknown>[] {
  const generating = !terminal(view.phase) && view.phase !== 'waiting';
  return [
    { id: 'root', component: 'Column', children: ['statusRow', 'answer'] },
    { id: 'statusRow', component: 'Row', align: 'center', children: ['loading', 'execution'] },
    // AIGenerating is the DingTalk Markdown host convention for an animated GIF.
    // shimmer alone is a text highlight, currently supported only by iOS.
    { id: 'loading', component: 'Markdown', content: '[AIGenerating]', visible: generating },
    { id: 'execution', component: 'CollapsiblePanel', variant: 'reasoning', title: title(view), defaultExpanded: false,
      children: ['steps'], fallbackMarkdown: view.steps, ...(generating ? { textEffect: 'shimmer' } : {}) },
    { id: 'steps', component: 'Markdown', content: { path: '/process/steps' } },
    { id: 'answer', component: 'Markdown', content: { path: '/answer/text' }, visible: { path: '/answer/visible' } }
  ];
}

/** Stable JSON skeleton; this never includes model reasoning or raw tool arguments. */
export function taskCardMessages(surfaceId: string, view: TaskCardView, create = false): Record<string, unknown>[] {
  return [
    ...(create ? [{ version: 'v1.0', createSurface: { surfaceId, catalogId: A2UI_CATALOG } }] : []),
    { version: 'v1.0', updateDataModel: { surfaceId, path: '/', value: { process: { steps: view.steps }, answer: { text: view.answer, visible: Boolean(view.answer) } } } },
    { version: 'v1.0', updateComponents: { surfaceId, components: components(view) } }
  ];
}

/** Identity and card state survive restart; writes are serialized and never replayed after an unknown outcome. */
export class A2uiTaskCards {
  private readonly writes = new Map<string, Promise<unknown>>();
  public constructor(private readonly dws: DwsBroker, private readonly repo: Repository, private readonly transport?: A2uiRobotTransport) {}
  private key(task: TaskRecord): string {
    const { user, surface } = task.request;
    return sha256({ kind: 'task.a2ui.create', sender: 'robot', id: task.id, corpId: user.corpId, userId: user.userId, surfaceType: surface.type, surfaceId: surface.id });
  }
  public async create(task: TaskRecord): Promise<string> {
    if (this.transport?.identity !== 'robot') throw new Error('A2UI_ROBOT_TRANSPORT_UNAVAILABLE');
    const key = this.key(task);
    const existing = await this.repo.getToolInvocation(key);
    if (existing?.status === 'completed') return (existing.result as { bizId: string }).bizId;
    if (existing) throw new Error('A2UI_TASK_CREATE_OUTCOME_UNKNOWN');
    const view = initialTaskCardView();
    const messages = await this.dws.lintA2ui(task.request.user, taskCardMessages(task.id, view, true));
    if (!await this.repo.beginToolInvocation({ idempotencyKey: key, taskId: task.id, actionHash: key, toolName: 'task.a2ui.create' })) throw new Error('A2UI_TASK_CREATE_OUTCOME_UNKNOWN');
    try {
      const result = await this.transport.create(task, messages);
      await this.repo.finishToolInvocation(key, 'completed', { bizId: result.bizId, view });
      return result.bizId;
    } catch (error) {
      await this.repo.finishToolInvocation(key, 'unknown');
      throw error;
    }
  }

  public async update(task: TaskRecord, view: TaskCardView): Promise<void> {
    const previous = this.writes.get(task.id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.write(task, view));
    this.writes.set(task.id, next);
    try { await next; } finally { if (this.writes.get(task.id) === next) this.writes.delete(task.id); }
  }

  private async write(task: TaskRecord, view: TaskCardView): Promise<void> {
    if (this.transport?.identity !== 'robot') throw new Error('A2UI_ROBOT_TRANSPORT_UNAVAILABLE');
    const state = await this.repo.getToolInvocation(this.key(task));
    const saved = state?.result as { bizId: string; view: TaskCardView } | undefined;
    // A recovered legacy template card has no A2UI creation record. Use text fallback.
    if (state?.status !== 'completed' || !saved?.bizId || saved.bizId !== task.cardBizId) throw new Error('A2UI_TASK_CARD_UNAVAILABLE');
    if (terminal(saved.view.phase)) return;
    view = { phase: view.phase, activity: view.activity, steps: view.steps || saved.view.steps, answer: view.answer };
    const current = await this.repo.findTask(task.id);
    if (current?.status === 'cancelled' && view.phase !== 'cancelled') return;
    if (current?.status.startsWith('waiting_') && ['queued', 'running'].includes(view.phase)) return;
    const key = sha256({ task: task.id, kind: 'task.a2ui.update', view });
    const existing = await this.repo.getToolInvocation(key);
    if (existing?.status === 'completed') return;
    if (existing) throw new Error('A2UI_TASK_UPDATE_OUTCOME_UNKNOWN');
    const messages = taskCardMessages(task.id, view).map(m => JSON.stringify(m));
    if (!await this.repo.beginToolInvocation({ idempotencyKey: key, taskId: task.id, actionHash: key, toolName: 'task.a2ui.update' })) throw new Error('A2UI_TASK_UPDATE_OUTCOME_UNKNOWN');
    try {
      await this.transport.update(task, saved.bizId, messages, terminal(view.phase) ? 'FINISH' : 'INPUTTING');
      await this.repo.finishToolInvocation(key, 'completed', { accepted: true, renderingVerified: false });
      await this.repo.finishToolInvocation(this.key(task), 'completed', { bizId: saved.bizId, view });
    } catch (error) {
      await this.repo.finishToolInvocation(key, 'unknown');
      throw error;
    }
  }
}
