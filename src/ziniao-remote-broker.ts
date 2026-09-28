import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Config } from './config.js';
import type { UserIdentity } from './types.js';
import { ZiniaoBroker, ZINIAO_AUTH_INIT_FAILED, type ZiniaoAuthSession } from './ziniao-broker.js';

type RemoteResult = { type: 'result'; ok: boolean; code?: string; configured?: boolean; profileKey?: string; data?: unknown };
type RemotePrompt = { type: 'prompt'; url: string };

export class ZiniaoRemoteBroker extends ZiniaoBroker {
  public constructor(private readonly remote: Config) { super(remote); }

  protected override async statusRaw(user: UserIdentity): Promise<{ profileKey: string } | null> {
    const request = this.start('status', user);
    const result = await request.result;
    if (!result.ok) throw new Error(result.code ?? 'ZINIAO_REMOTE_UNAVAILABLE');
    return result.configured ? { profileKey: result.profileKey! } : null;
  }

  protected override async beginAuthorizationRaw(user: UserIdentity): Promise<ZiniaoAuthSession> {
    const request = this.start('authorize', user, undefined, 16 * 60 * 1000);
    let prompt: string;
    let promptTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      prompt = await Promise.race([
        request.prompt,
        request.result.then((result) => { throw new Error(result.code ?? ZINIAO_AUTH_INIT_FAILED); }),
        new Promise<never>((_, reject) => {
          promptTimer = setTimeout(() => reject(new Error(ZINIAO_AUTH_INIT_FAILED)), 30_000);
        })
      ]);
    } catch (error) {
      request.child.kill('SIGTERM');
      throw error;
    } finally {
      if (promptTimer) clearTimeout(promptTimer);
    }
    return {
      prompt: '授权地址：' + prompt,
      completion: request.result.then((result) => {
        if (!result.ok) throw new Error(result.code ?? 'ZINIAO_AUTH_FAILED');
      }),
      cancel: () => request.child.kill('SIGTERM')
    };
  }

  protected override async runRaw(user: UserIdentity, args: string[]): Promise<unknown> {
    const request = this.start('run', user, args, 75_000);
    const result = await request.result;
    if (!result.ok) throw new Error(result.code ?? 'ZINIAO_COMMAND_FAILED');
    return result.data;
  }

  private start(op: 'status' | 'authorize' | 'run', user: UserIdentity, args?: string[], timeoutMs = 25_000): {
    child: ChildProcessWithoutNullStreams;
    prompt: Promise<string>;
    result: Promise<RemoteResult>;
  } {
    const host = this.remote.ZINIAO_REMOTE_HOST;
    if (!host) throw new Error('ZINIAO_REMOTE_UNAVAILABLE');
    const child = spawn('ssh', [
      '-i', this.remote.ZINIAO_REMOTE_KEY_PATH,
      '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'UserKnownHostsFile=' + this.remote.ZINIAO_REMOTE_KNOWN_HOSTS_PATH,
      '-o', 'ConnectTimeout=6', '-T', this.remote.ZINIAO_REMOTE_USER + '@' + host
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const digest = createHash('sha256').update(JSON.stringify([user.corpId, user.userId])).digest('hex');
    child.stdin.end(JSON.stringify({ op, digest, ...(args ? { args } : {}) }));
    let resolvePrompt!: (value: string) => void;
    const prompt = new Promise<string>((resolve) => { resolvePrompt = resolve; });
    let pending = '';
    let final: RemoteResult | undefined;
    let tooLarge = false;
    child.stdout.on('data', (chunk) => {
      pending += String(chunk);
      if (pending.length > 12 * 1024 * 1024) { tooLarge = true; child.kill('SIGTERM'); return; }
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as RemoteResult | RemotePrompt;
          if (event.type === 'prompt' && /^https:\/\/open\.ziniao\.com\/memberAuth\?/.test(event.url)) resolvePrompt(event.url);
          if (event.type === 'result') final = event;
        } catch { /* invalid worker output is rejected when SSH closes */ }
      }
    });
    // SSH diagnostics can include host details; never forward them to users or model.
    child.stderr.resume();
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    const result = new Promise<RemoteResult>((resolve, reject) => {
      child.once('error', () => { clearTimeout(timer); reject(new Error('ZINIAO_REMOTE_UNAVAILABLE')); });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (tooLarge || code !== 0 || !final) reject(new Error('ZINIAO_REMOTE_UNAVAILABLE'));
        else resolve(final);
      });
    });
    void result.catch(() => undefined);
    return { child, prompt, result };
  }
}
