import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { GuideTool } from '../src/guide-tool.js';

describe('GuideTool', () => {
  const guide = new GuideTool({ SKILLS_DIR: resolve('skills') }, resolve('nonexistent-codex-home'));

  it('reads the registered public DingTalk guide without shell or OAuth', async () => {
    const result = await guide.execute({ name: 'dingtalk-office' });
    expect(result.name).toBe('dingtalk-office');
    expect(result.text).toContain('# 钉钉办公 Skill');
  });

  it('rejects arbitrary paths and unknown guides', async () => {
    await expect(guide.execute({ name: '../../.env' })).rejects.toThrow('GUIDE_NOT_REGISTERED');
    await expect(guide.execute({ name: '/var/lib/dws/keychain' })).rejects.toThrow('GUIDE_NOT_REGISTERED');
    await expect(guide.execute(null)).rejects.toThrow('GUIDE_ARGUMENTS_INVALID');
  });
});
