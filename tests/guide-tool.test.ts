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

  it('reads the Amazon toolkit and a validated routed sub-skill', async () => {
    const root = await guide.execute({ name: 'nexscope-amazon-skills' });
    expect(root.text).toContain('Amazon Seller Toolkit by Nexscope');
    const routed = await guide.execute({ name: 'nexscope-amazon-skills', subSkill: 'amazon-product-research' });
    expect(routed.subSkill).toBe('amazon-product-research');
    expect(routed.text).toContain('amazon-product-research');
    await expect(guide.execute({ name: 'nexscope-amazon-skills', subSkill: '../dingtalk-office' })).rejects.toThrow('GUIDE_SUBSKILL_INVALID');
  });

  it('reads the business analysis skill and only its registered references', async () => {
    const root = await guide.execute({ name: 'amazon-business-performance-analysis' });
    expect(root.text).toContain('# Amazon 店铺经营分析');
    const reference = await guide.execute({ name: 'amazon-business-performance-analysis', reference: 'lingxing-adapter' });
    expect(reference.reference).toBe('lingxing-adapter');
    expect(reference.text).toContain('lingxing.action');
    expect(reference.text).toContain('lingxing.read_scoped');
    const backendReference = await guide.execute({ name: 'amazon-business-performance-analysis', reference: 'crossborderops-adapter' });
    expect(backendReference.text).toContain('business_complete');
    await expect(guide.execute({ name: 'amazon-business-performance-analysis', reference: '../data-contract' })).rejects.toThrow('GUIDE_REFERENCE_INVALID');
    await expect(guide.execute({ name: 'nexscope-amazon-skills', reference: 'data-contract' })).rejects.toThrow('GUIDE_REFERENCE_INVALID');
  });

  it('reads references with non-ASCII names and any document by contained relative path', async () => {
    const chinese = await guide.execute({ name: 'zach-search-term-analyzer', reference: '字段说明' });
    expect(chinese.text.length).toBeGreaterThan(0);
    const agent = await guide.execute({ name: 'zach-product-research', path: 'agents/report-writer.md' });
    expect(agent.text.length).toBeGreaterThan(0);
    await expect(guide.execute({ name: 'zach-product-research', path: '../dingtalk-office/SKILL.md' })).rejects.toThrow('GUIDE_PATH_INVALID');
    await expect(guide.execute({ name: 'zach-product-research', path: 'scripts/cross_analysis.py' })).rejects.toThrow('GUIDE_PATH_INVALID');
    await expect(guide.execute({ name: 'zach-product-research', path: 'agents/missing.md' })).rejects.toThrow(/GUIDE_PATH_INVALID: 可用文档/);
  });

  it('builds a compact skill index with references, documents and scripts', async () => {
    const index = await guide.index();
    expect(index).toContain('- amazon-business-performance-analysis：');
    expect(index).toContain('crossborderops-adapter');
    expect(index).toContain('字段说明');
    expect(index).toContain('analyze_search_terms.py');
    expect(index).toContain('amazon-product-research');
  });
});

