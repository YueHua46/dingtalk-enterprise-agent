import { describe, expect, it, vi } from 'vitest';
import { DwsBroker, buildDeviceAuthorizationArgs } from '../src/dws-broker.js';

describe('DwsBroker device authorization', () => {
  it('creates and updates a streaming card with the explicitly configured profile', async () => {
    const broker = new DwsBroker({ DWS_BIN: 'dws', DWS_BOT_PROFILE: 'corp-1:user-1' } as any);
    const run = vi.spyOn(broker as any, 'run')
      .mockResolvedValueOnce({ stdout: JSON.stringify({ bizId: 'card-1' }), stderr: '' })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ ok: true }), stderr: '' });

    await expect(broker.createStreamingCard({ type: 'group', id: 'group-1' })).resolves.toBe('card-1');
    await broker.updateStreamingCard('card-1', '答案', 3);
    expect(run).toHaveBeenNthCalledWith(1, [
      'chat', '+messages-send-card', '--group', 'group-1',
      '--profile', 'corp-1:user-1', '--yes', '--format', 'json'
    ]);
    expect(run).toHaveBeenNthCalledWith(2, [
      'chat', '+messages-update-card', '--biz-id', 'card-1', '--content', '答案',
      '--flow-status', '3', '--profile', 'corp-1:user-1', '--yes', '--format', 'json'
    ]);
  });

  it('does not fabricate a card id when creation has no verifiable bizId', async () => {
    const broker = new DwsBroker({ DWS_BIN: 'dws', DWS_BOT_PROFILE: 'corp-1:user-1' } as any);
    vi.spyOn(broker as any, 'run').mockResolvedValue({ stdout: JSON.stringify({ accepted: true }), stderr: '' });
    await expect(broker.createStreamingCard({ type: 'group', id: 'group-1' })).rejects.toThrow('no bizId');
  });

  it('binds --profile only when re-authorizing a registered profile', () => {
    const user = { corpId: 'corp-1', userId: 'user-1' };

    // First-time employee: profile does not exist yet; CLI rejects --profile
    // with code 3 ("profile not found"), so it must be omitted.
    const firstTime = buildDeviceAuthorizationArgs(user, false);
    expect(firstTime).toEqual(['auth', 'login', '--device', '--no-browser', '--recommend', '--format', 'json']);
    expect(firstTime).not.toContain('--profile');

    // Re-authorization (profile registered, token expired): bind the exact profile.
    expect(buildDeviceAuthorizationArgs(user, true)).toEqual([
      'auth', 'login', '--device', '--no-browser', '--recommend',
      '--profile', 'corp-1:user-1',
      '--format', 'json'
    ]);
    expect(buildDeviceAuthorizationArgs(user, true)).not.toContain('--client-id');
    expect(buildDeviceAuthorizationArgs(user, true)).not.toContain('--client-secret');
  });

  it('marks authorization init failures and carries child process diagnostics', async () => {
    // process.execPath treats the first CLI arg as a module path, so the
    // child exits immediately with a "Cannot find module" diagnostic on stderr
    // and never prints an authorization link.
    const broker = new DwsBroker({ DWS_BIN: process.execPath, DWS_CONFIG_DIR: '/tmp/dws-test' } as any);
    await expect(broker.beginDeviceAuthorization({ corpId: 'corp-1', userId: 'user-1' }))
      .rejects.toThrow(/DWS_AUTH_INIT_FAILED: .*code 1.*MODULE_NOT_FOUND/s);
  });

  it('checks profile registration before starting the device flow', async () => {
    const broker = new DwsBroker({ DWS_BIN: process.execPath, DWS_CONFIG_DIR: '/tmp/dws-test' } as any);
    const run = vi.spyOn(broker as any, 'run').mockResolvedValue({
      stdout: JSON.stringify({ profiles: [{ profile: 'corp-1:user-1' }] }),
      stderr: ''
    });
    await expect(broker.beginDeviceAuthorization({ corpId: 'corp-1', userId: 'user-1' }))
      .rejects.toThrow(/DWS_AUTH_INIT_FAILED/);
    expect(run).toHaveBeenCalledWith(['profile', 'list', '--format', 'json']);
  });

  it('returns unauthenticated when the exact employee profile is not registered', async () => {
    const broker = new DwsBroker({ DWS_BIN: 'dws' } as any);
    const run = vi.spyOn(broker as any, 'run').mockResolvedValueOnce({
      stdout: JSON.stringify({ success: true, profiles: [] }),
      stderr: ''
    });

    await expect(broker.status({ corpId: 'corp-1', userId: 'user-1' })).resolves.toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(['profile', 'list', '--format', 'json']);
  });

  it('checks and returns only the exact employee profile identity', async () => {
    const broker = new DwsBroker({ DWS_BIN: 'dws' } as any);
    const run = vi.spyOn(broker as any, 'run')
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ profiles: [{ profile: 'corp-1:user-1' }] }),
        stderr: ''
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ authenticated: true, corp_id: 'corp-1', user_id: 'user-1' }),
        stderr: ''
      });

    await expect(broker.status({ corpId: 'corp-1', userId: 'user-1' })).resolves.toEqual({
      corpId: 'corp-1', userId: 'user-1', profileKey: 'corp-1:user-1'
    });
    expect(run).toHaveBeenLastCalledWith([
      'auth', 'status', '--profile', 'corp-1:user-1', '--format', 'json'
    ]);
  });
});
