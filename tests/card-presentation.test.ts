import { describe, expect, it } from 'vitest';
import { CardPresentation } from '../src/card-presentation.js';

describe('CardPresentation', () => {
  it('keeps process and answer in a single stable snapshot', () => {
    const card = new CardPresentation();
    expect(card.render()).toBe('**正在处理**');
    card.commentary('先查看相关资料');
    card.toolStarted('读取 Skill：dingtalk-office');
    expect(card.render()).toContain('正在使用工具');
    card.toolCompleted('读取 Skill：dingtalk-office', true);
    expect(card.render('结论一')).toContain('---\n\n结论一');
    expect(card.render('结论一，结论二')).toContain('结论一，结论二');
  });

  it('shows one concise tool status without completed-tool history', () => {
    const card = new CardPresentation();
    expect(card.renderActivity()).toBe('正在处理');
    card.toolStarted('使用钉钉工具：chat.search-msg');
    expect(card.renderActivity()).toBe('正在使用钉钉工具：chat.search-msg');
    card.toolCompleted('使用钉钉工具：chat.search-msg', true);
    expect(card.renderActivity()).toBe('正在整理回答');
    expect(card.renderActivity()).not.toContain('已完成');
  });

  it('keeps the remaining active tool visible when calls overlap', () => {
    const card = new CardPresentation();
    card.toolStarted('使用钉钉工具：chat.search-msg');
    card.toolStarted('读取 Skill：dingtalk-office');
    card.toolCompleted('读取 Skill：dingtalk-office', true);
    expect(card.renderActivity()).toBe('正在使用钉钉工具：chat.search-msg');
  });

  it('escapes tool labels as text instead of allowing Markdown injection', () => {
    const card = new CardPresentation();
    card.toolStarted('查询 *private* [link](x)');
    expect(card.render()).toContain('\\*private\\*');
    expect(card.render()).not.toContain('[link](x)');
  });

  it('does not render a commentary note containing a credential or URL', () => {
    const card = new CardPresentation();
    card.commentary('进度：access_token=secret-value');
    card.commentary('查看 https://private.example.org');
    expect(card.render()).toBe('**正在处理**');
  });
});
