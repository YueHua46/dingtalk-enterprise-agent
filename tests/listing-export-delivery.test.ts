import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { it, expect, vi } from 'vitest';
import { TaskOrchestrator } from '../src/task-orchestrator.js';
import { InMemoryRepository } from '../src/persistence.js';
import { loadConfig } from './test-config.js';
import { buildListingExport } from '../src/listing-export.js';
import type { ListingRevisionVersion } from '../src/listing-revision.js';

async function fixture(surfaceType: 'direct' | 'group' = 'group') {
  const { version, previous } = JSON.parse(readFileSync(new URL('../examples/listing/export-version-sample.json', import.meta.url), 'utf8')) as { version: ListingRevisionVersion; previous: ListingRevisionVersion };
  const payload = buildListingExport(version.scope, version, version.context, { previous });
  payload.scope.surface = { type: surfaceType, id: 'original' };
  const repo = new InMemoryRepository();
  const task = await repo.createTask({ requestId: payload.scope.requestId, messageId: 'm', user: structuredClone(payload.scope.owner), surface: structuredClone(payload.scope.surface), text: '导出', attachments: [], receivedAt: Date.now() }, 'original');
  const buffers = new Map(['docx', 'xlsx'].map(ext => [ext, readFileSync(new URL(`../examples/listing/listing-export-sample.${ext}`, import.meta.url))]));
  const paths = { docx: `listing-${'a'.repeat(64)}.docx`, xlsx: `listing-${'a'.repeat(64)}.xlsx` };
  const worker = {
    renderListing: vi.fn(async () => paths),
    inspectOutput: vi.fn(async (_id: string, path: string) => { const data = buffers.get(path.endsWith('.docx') ? 'docx' : 'xlsx')!; return { name: basename(path), path, size: data.length, sha256: createHash('sha256').update(data).digest('hex') }; }),
    downloadOutput: vi.fn(async (_id: string, name: string) => buffers.get(name.endsWith('.docx') ? 'docx' : 'xlsx')!),
  };
  const sender = { send: vi.fn(async () => {}), sendFile: vi.fn(async () => ({ delivered: true })) };
  const dws = { status: vi.fn(async () => ({ profileKey: 'bound-user' })) };
  const directory = await mkdtemp(join(tmpdir(), 'listing-export-test-'));
  const config = loadConfig({ DINGTALK_ROBOT_CODE: 'robot', MEDIA_DIR: directory });
  const host = new TaskOrchestrator(config, repo, worker as any, dws as any, sender as any);
  const scan = vi.spyOn((host as any).media, 'scan').mockResolvedValue(undefined);
  return { payload, host, worker, repo, sender, dws, task, scan, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

it.each(['group', 'direct'] as const)('uses current user and original %s, with durable duplicate protection', async type => {
  const f = await fixture(type);
  try {
    await f.host.deliverListingFiles(f.task, 'thread', f.payload);
    await f.host.deliverListingFiles(f.task, 'thread', f.payload);
    expect(f.sender.sendFile).toHaveBeenCalledTimes(2);
    for (const call of f.sender.sendFile.mock.calls as unknown[][]) { expect(call[0]).toEqual(f.task.request.user); expect(call[1]).toEqual(f.task.request.surface); }
    expect(f.scan).toHaveBeenCalled(); expect(f.dws.status).toHaveBeenCalledWith(f.task.request.user);
    expect((await f.repo.audits).filter(a => a.eventType === 'artifact.delivered')).toHaveLength(2);
  } finally { await f.cleanup(); }
});
it('rejects cross-user and cross-conversation requests before render', async () => {
  const f = await fixture();
  try {
    f.payload.scope.owner.userId = 'other';
    await expect(f.host.deliverListingFiles(f.task, 'thread', f.payload)).rejects.toThrow('SCOPE_MISMATCH');
    f.payload.scope.owner = { ...f.task.request.user }; f.payload.scope.surface.id = 'other';
    await expect(f.host.deliverListingFiles(f.task, 'thread', f.payload)).rejects.toThrow('SCOPE_MISMATCH');
    expect(f.worker.renderListing).not.toHaveBeenCalled(); expect(f.sender.sendFile).not.toHaveBeenCalled();
  } finally { await f.cleanup(); }
});
it('blocks infected files before any send', async () => {
  const f = await fixture();
  try { f.scan.mockRejectedValue(new Error('MALWARE_FOUND')); await expect(f.host.deliverListingFiles(f.task, 'thread', f.payload)).rejects.toThrow('MALWARE_FOUND'); expect(f.sender.sendFile).not.toHaveBeenCalled(); }
  finally { await f.cleanup(); }
});
it('blocks file hash changes before scanning or sending', async () => {
  const f = await fixture();
  try { f.worker.downloadOutput.mockResolvedValue(Buffer.from('changed')); await expect(f.host.deliverListingFiles(f.task, 'thread', f.payload)).rejects.toThrow('OUTPUT_HASH_MISMATCH'); expect(f.scan).not.toHaveBeenCalled(); expect(f.sender.sendFile).not.toHaveBeenCalled(); }
  finally { await f.cleanup(); }
});
it('does not repeat a send after an unknown outcome', async () => {
  const f = await fixture();
  try {
    f.sender.sendFile.mockRejectedValue(new Error('timeout'));
    await expect(f.host.deliverListingFiles(f.task, 'thread', f.payload)).rejects.toThrow('timeout');
    await expect(f.host.deliverListingFiles(f.task, 'thread', f.payload)).rejects.toThrow('OUTCOME_UNKNOWN');
    expect(f.sender.sendFile).toHaveBeenCalledOnce();
  } finally { await f.cleanup(); }
});
it('stops if cancelled during scanning, before sending', async () => {
  const f = await fixture(), controller = new AbortController();
  try { f.scan.mockImplementation(async () => controller.abort()); await expect(f.host.deliverListingFiles(f.task, 'thread', f.payload, controller.signal)).rejects.toThrow('CANCELLED'); expect(f.sender.sendFile).not.toHaveBeenCalled(); }
  finally { await f.cleanup(); }
});
