import { describe, expect, it, vi } from 'vitest';
import { DwsBroker, buildDeviceAuthorizationArgs, buildDwsEnvironment, isConfirmationGateError } from '../src/dws-broker.js';

describe('DwsBroker device authorization', () => {
  it('classifies wrapper startup stderr without retaining its private paths', async () => {
    const broker = new DwsBroker({ DWS_BIN: 'dws' } as any);
    vi.spyOn(broker as any, 'status').mockResolvedValue({ corpId: 'corp-1', userId: 'user-1', profileKey: 'corp-1:user-1' });
    vi.spyOn(broker as any, 'run').mockRejectedValue({ code: 1, stdout: '', stderr: 'Error: Cannot find module secret/private/path\nMODULE_NOT_FOUND' });
    const error = await broker.runCommand({ corpId: 'corp-1', userId: 'user-1' }, ['drive', '+download']).catch(error => error);
    expect(error.dwsExitCode).toBe(1);
    expect(error.dwsLocalFailure).toBe('module_missing');
    expect(error.dwsStdoutBytes).toBe(0);
    expect(JSON.stringify(error)).not.toContain('secret/private');
  });
  it('preserves local spawn failures with empty CLI output without exposing paths', async () => {
    const broker = new DwsBroker({ DWS_BIN: 'dws' } as any);
    vi.spyOn(broker as any, 'status').mockResolvedValue({ corpId: 'corp-1', userId: 'user-1', profileKey: 'corp-1:user-1' });
    vi.spyOn(broker as any, 'run').mockRejectedValue(Object.assign(new Error('spawn secret-path ENOENT'), { code: 'ENOENT', stdout: '', stderr: '' }));
    const error = await broker.runCommand({ corpId: 'corp-1', userId: 'user-1' }, ['drive', '+download']).catch(error => error);
    expect(error.code).toBe('ENOENT');
    expect(error.dwsReason).toBe('local_process_failed');
    expect(error.message).toBe('DWS_LOCAL_PROCESS_FAILED');
    expect(JSON.stringify(error)).not.toContain('secret-path');
  });
  it('isolates DWS routing and preserves existing proxy exclusions', () => {
    const inherited={HTTPS_PROXY:'http://127.0.0.1:7897',NO_PROXY:'localhost',no_proxy:'127.0.0.1'};
    const env=buildDwsEnvironment({DWS_CONFIG_DIR:'./data/dws',DWS_NO_PROXY:'mcp.dingtalk.com,localhost'},inherited);
    expect(env.NO_PROXY).toBe('localhost,127.0.0.1,mcp.dingtalk.com');
    expect(env.no_proxy).toBe(env.NO_PROXY);
    expect(env.HTTPS_PROXY).toBe(inherited.HTTPS_PROXY);
    expect(inherited).toEqual({HTTPS_PROXY:'http://127.0.0.1:7897',NO_PROXY:'localhost',no_proxy:'127.0.0.1'});
  });
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

  it('marks the CLI confirmation gate refusal so the orchestrator can branch on it', async () => {
    const broker = new DwsBroker({ DWS_BIN: 'dws' } as any);
    vi.spyOn(broker as any, 'status').mockResolvedValue({ corpId: 'corp-1', userId: 'user-1', profileKey: 'corp-1:user-1' });
    // The CLI reports gate refusals with a non-zero exit and a JSON diagnostic
    // on stderr (verified shape: {"error":{"category":...,"message":...}}).
    vi.spyOn(broker as any, 'run').mockRejectedValue(Object.assign(new Error('Command failed'), {
      stdout: '',
      stderr: JSON.stringify({ error: { category: 'confirmation', code: 'confirm_required', message: '需要用户确认后加 --yes 执行' } })
    }));

    await expect(broker.runCommand({ corpId: 'corp-1', userId: 'user-1' }, ['chat', '+messages-set-pin', '--message-id', 'm1']))
      .rejects.toSatisfy((error: unknown) => isConfirmationGateError(error));
  });

  it('retains export job and missing-object classification without raw URLs or service output',async()=>{
    const broker=new DwsBroker({DWS_BIN:'dws'} as any);
    vi.spyOn(broker as any,'status').mockResolvedValue({corpId:'corp-1',userId:'user-1',profileKey:'corp-1:user-1'});
    vi.spyOn(broker as any,'run').mockRejectedValue({stdout:'',stderr:JSON.stringify({error:{code:1,category:'api',message:'export download failed',reason:'doc_export_download_failed',retryable:false,details:{jobId:'pdf_fixture123'},cause:'<Code>NoSuchKey</Code> secret signed URL'}})});
    const error=await broker.runCommand({corpId:'corp-1',userId:'user-1'},['doc','+export']).catch(e=>e);
    expect(error.dwsJobId).toBe('pdf_fixture123');expect(error.dwsCauseCode).toBe('NoSuchKey');expect(error.dwsRetryable).toBe(false);
    expect(JSON.stringify(error)).not.toContain('secret');
  });

  it('retains normalized shortcut error type and exit code on non-zero exit',async()=>{
    const broker=new DwsBroker({DWS_BIN:'dws'} as any);
    vi.spyOn(broker as any,'status').mockResolvedValue({corpId:'corp-1',userId:'user-1',profileKey:'corp-1:user-1'});
    vi.spyOn(broker as any,'run').mockRejectedValue({stdout:JSON.stringify({ok:false,outcome:'failure',error:{type:'api',exit_code:1,message:'TLS handshake timeout'}}),stderr:''});
    const error=await broker.runCommand({corpId:'corp-1',userId:'user-1'},['drive','+download']).catch(e=>e);
    expect(error.dwsCategory).toBe('api');expect(error.dwsCode).toBe('1');
    expect(error.dwsReason).toBeUndefined();expect(error.dwsRetryable).toBe(false);
  });

  it('handles shortcut failures on successful process exit and prefers explicit diagnostic fields',async()=>{
    const broker=new DwsBroker({DWS_BIN:'dws'} as any);
    vi.spyOn(broker as any,'status').mockResolvedValue({corpId:'corp-1',userId:'user-1',profileKey:'corp-1:user-1'});
    const run=vi.spyOn(broker as any,'run').mockResolvedValueOnce({stdout:JSON.stringify({ok:false,error:{type:'internal',exit_code:5,message:'local download failed'}}),stderr:''})
      .mockResolvedValueOnce({stdout:JSON.stringify({ok:false,error:{category:'api',code:1,type:'internal',exit_code:5,message:'server rejected',retryable:false}}),stderr:''});
    const first=await broker.runCommand({corpId:'corp-1',userId:'user-1'},['drive','+download']).catch(e=>e);
    expect(first.dwsCategory).toBe('internal');expect(first.dwsCode).toBe('5');
    const second=await broker.runCommand({corpId:'corp-1',userId:'user-1'},['drive','+download']).catch(e=>e);
    expect(second.dwsCategory).toBe('api');expect(second.dwsCode).toBe('1');expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps ordinary CLI failures outside the confirmation-gate marker', async () => {
    const broker = new DwsBroker({ DWS_BIN: 'dws' } as any);
    vi.spyOn(broker as any, 'status').mockResolvedValue({ corpId: 'corp-1', userId: 'user-1', profileKey: 'corp-1:user-1' });
    vi.spyOn(broker as any, 'run').mockRejectedValue(Object.assign(new Error('Command failed'), {
      stdout: '',
      stderr: JSON.stringify({ error: { category: 'validation', code: 3, message: '缺少必填参数 --to：收件人姓名/花名' } })
    }));

    await expect(broker.runCommand({ corpId: 'corp-1', userId: 'user-1' }, ['chat', '+dm']))
      .rejects.toSatisfy((error: unknown) => !isConfirmationGateError(error) && error instanceof Error && error.message.includes('缺少必填参数'));
  });
});
