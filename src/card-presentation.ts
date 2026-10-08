/** User-visible activity only. Never feed reasoning or raw tool arguments here. */
export class CardPresentation {
  private activity = '正在处理';
  private note = '';
  private readonly completed: string[] = [];
  private readonly activeTools: string[] = [];

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
  }

  public toolCompleted(label: string, success: boolean): void {
    const index = this.activeTools.lastIndexOf(label);
    if (index >= 0) this.activeTools.splice(index, 1);
    this.completed.push((success ? '已完成：' : '未完成：') + label);
    if (this.completed.length > 3) this.completed.shift();
    if (this.activeTools.length === 0) {
      this.activity = '正在整理结果';
      this.note = '';
    } else {
      this.note = this.activeTools.at(-1)!;
    }
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
