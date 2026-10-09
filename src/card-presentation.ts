import type { ExecutionStep, ExecutionUiState, AgentUiDocument } from './a2ui.js';

/** User-visible activity only. Never feed reasoning or raw tool arguments here. */
export class CardPresentation {
  private activity = '正在处理';
  private note = '';
  private readonly completed: string[] = [];
  private readonly activeTools: string[] = [];
  private readonly steps: ExecutionStep[] = [];
  private sequence = 0;
  private result: AgentUiDocument | undefined;

  public commentary(text: string): void {
    const clean = text.replace(/\s+/g, ' ').trim();
    // Commentary is user-facing text, not reasoning. Still fail closed if the
    // model accidentally includes a credential or a raw URL in a progress note.
    if (clean && !/(?:access[_ -]?token|refresh[_ -]?token|app[_ -]?secret|api[_ -]?key|https?:\/\/|sk-[A-Za-z0-9_-]{8})/i.test(clean)) {
      this.note = clean.slice(0, 100);
    }
  }

  public toolStarted(label: string): void {
    this.activeTools.push(label);
    this.activity = '正在使用工具';
    this.note = label;
    const id = `tool-${++this.sequence}`;
    this.steps.push({ id, label, kind: 'tool', status: 'running', startedAt: new Date().toISOString() });
  }

  public toolCompleted(label: string, success: boolean): void {
    const index = this.activeTools.lastIndexOf(label);
    if (index >= 0) this.activeTools.splice(index, 1);
    this.completed.push((success ? '已完成：' : '未完成：') + label);
    const step = [...this.steps].reverse().find((item) => item.label === label && item.status === 'running');
    if (step) { step.status = success ? 'success' : 'failed'; step.finishedAt = new Date().toISOString(); }
    if (this.completed.length > 3) this.completed.shift();
    if (this.activeTools.length === 0) {
      this.activity = '正在整理结果';
      this.note = '';
    } else {
      this.note = this.activeTools.at(-1)!;
    }
  }

  public setResult(result: AgentUiDocument | undefined): void { this.result = result; }

  public snapshot(title = 'Agent任务'): ExecutionUiState {
    const active = this.steps.find((step) => step.status === 'running');
    const state: ExecutionUiState = { title, status: active ? 'executing' : (this.result ? 'inputting' : 'processing'), steps: this.steps.map((step) => ({ ...step })) };
    if (active) state.activeStepId = active.id;
    if (this.result) state.result = this.result;
    return state;
  }

  public render(answer = ''): string {
    const heading = answer ? '正在回复' : this.activity;
    const parts = ['**' + heading + '**'];
    if (this.note) parts.push(escapeMarkdown(this.note));
    if (this.completed.length) parts.push(this.completed.map((line) => '✓ ' + escapeMarkdown(line)).join('  \n'));
    if (answer) parts.push('---', answer);
    return parts.join('\n\n');
  }

  public renderActivity(): string {
    if (this.activeTools.length > 0) {
      const label = this.activeTools.at(-1)!;
      if (label.startsWith('使用钉钉工具：')) return '正在使用钉钉工具：' + label.slice('使用钉钉工具：'.length);
      if (label.startsWith('读取 Skill：')) return '正在读取 Skill：' + label.slice('读取 Skill：'.length);
      return '正在' + label;
    }
    if (this.note) return this.note;
    return this.activity === '正在整理结果' ? '正在整理回答' : this.activity;
  }
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+.!|<>]/g, '\\$&');
}
