import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.js';
import type { ConversationSurface, DwsIdentity, UserIdentity } from './types.js';
import { sameIdentity } from './security.js';

const execFileAsync = promisify(execFile);

// Stable marker so the orchestrator can distinguish "authorization could not
// even be initiated" (an infrastructure problem) from other DWS failures.
export const DWS_AUTH_INIT_FAILED = 'DWS_AUTH_INIT_FAILED';

function authInitError(detail: string, output: string): Error {
  // Carry the tail of the child process output for diagnostics; it may contain
  // the reason (OAuth client not configured, bad DWS_CONFIG_DIR, CLI version
  // mismatch). Redact credential-like fragments before surfacing it.
  const tail = output
    .replace(/\s+/g, ' ')
    .replace(/(accessToken|appSecret|authorization|token)[^\s,;]*/gi, '$1=<redacted>')
    .trim()
    .slice(-400);
  return new Error(DWS_AUTH_INIT_FAILED + ': ' + detail + (tail ? '；进程输出尾部：' + tail : ''));
}

export class DwsBroker {
  public constructor(private readonly config: Config) {}

  public async sendBotMessage(user: UserIdentity, markdown: string, title: string): Promise<void> {
    await this.sendBotMarkdown({ type: 'direct', id: user.userId }, markdown, title);
  }

  public async sendBotMarkdown(surface: ConversationSurface, markdown: string, title: string): Promise<void> {
    if (!this.config.DWS_BOT_PROFILE) throw new Error('DWS_BOT_PROFILE is required for bot direct messages');
    const target = surface.type === 'group' ? ['--group', surface.id] : ['--users', surface.id];
    const result = await this.run([
      'chat', '+messages-send', '--as', 'bot',
      '--robot-code', this.config.DINGTALK_ROBOT_CODE,
      ...target,
      '--title', title,
      '--markdown', markdown,
      '--msg-type', 'markdown',
      '--profile', this.config.DWS_BOT_PROFILE,
      '--yes', '--format', 'json'
    ]);
    const parsed = safeJson(result.stdout);
    if (!parsed) throw new Error('DWS bot send returned invalid JSON');
    if (parsed.ok === false) throw new Error(String(parsed.error?.message ?? 'DWS bot send failed'));
    const data = parsed.data ?? parsed;
    if (data?.complete === false || (Array.isArray(data?.failures) && data.failures.length > 0)) {
      throw new Error('DWS bot send was only partially delivered');
    }
  }

  public async createStreamingCard(surface: ConversationSurface): Promise<string> {
    if (!this.config.DWS_BOT_PROFILE) throw new Error('DWS_BOT_PROFILE is required for streaming cards');
    const target = surface.type === 'group' ? ['--group', surface.id] : ['--receiver', surface.id];
    const result = await this.run([
      'chat', '+messages-send-card', ...target,
      '--profile', this.config.DWS_BOT_PROFILE, '--yes', '--format', 'json'
    ]);
    const parsed = safeJson(result.stdout);
    if (!parsed || parsed.ok === false || parsed.success === false || parsed.accepted === false || parsed.error) {
      throw new Error('DWS streaming card creation failed');
    }
    const data = parsed.data ?? parsed;
    const bizId = data.bizId ?? data.biz_id ?? data.result?.bizId ?? data.card?.bizId;
    if (typeof bizId !== 'string' || !bizId) throw new Error('DWS streaming card creation returned no bizId');
    return bizId;
  }

  public async updateStreamingCard(bizId: string, content: string, flowStatus: 1 | 2 | 3 | 4 | 5): Promise<void> {
    if (!this.config.DWS_BOT_PROFILE) throw new Error('DWS_BOT_PROFILE is required for streaming cards');
    const result = await this.run([
      'chat', '+messages-update-card', '--biz-id', bizId, '--content', content,
      '--flow-status', String(flowStatus), '--profile', this.config.DWS_BOT_PROFILE,
      '--yes', '--format', 'json'
    ]);
    const parsed = safeJson(result.stdout);
    if (!parsed || parsed.ok === false || parsed.success === false || parsed.accepted === false || parsed.error || parsed.data?.complete === false) {
      throw new Error('DWS streaming card update failed');
    }
  }

  public async status(user: UserIdentity): Promise<DwsIdentity | null> {
    const profileKey = user.corpId + ':' + user.userId;
    const profilesResult = await this.run(['profile', 'list', '--format', 'json']);
    const profilesPayload = safeJson(profilesResult.stdout);
    const profilesData = profilesPayload?.data ?? profilesPayload;
    const profiles = Array.isArray(profilesData?.profiles) ? profilesData.profiles : [];
    const registered = profiles.some((profile: any) => String(profile?.profile ?? '') === profileKey);
    if (!registered) return null;

    const result = await this.run(['auth', 'status', '--profile', profileKey, '--format', 'json']);
    const parsed = safeJson(result.stdout);
    const data = parsed?.data ?? parsed;
    const identity = data?.identity ?? data?.profile ?? data;
    if (!identity) return null;
    const corpId = String(identity.corpId ?? identity.corp_id ?? user.corpId);
    const userId = String(identity.userId ?? identity.user_id ?? '');
    const authenticated = Boolean(data?.authenticated ?? data?.token_valid ?? data?.authenticated === true);
    if (!authenticated || !userId) return null;
    if (!sameIdentity(user, { corpId, userId })) {
      throw new Error('DWS identity mismatch: authorized identity does not match message user');
    }
    return { corpId, userId, profileKey };
  }

  public async beginDeviceAuthorization(user: UserIdentity): Promise<{ prompt: string; completion: Promise<DwsIdentity> }> {
    const args = buildDeviceAuthorizationArgs(user, await this.profileRegistered(user));
    const invocation = resolveInvocation(this.config.DWS_BIN);
    const child = spawn(invocation.file, [...invocation.prefix, ...args], {
      env: { ...process.env, DWS_CONFIG_DIR: this.config.DWS_CONFIG_DIR },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let output = '';
    let promptResolved = false;
    let resolvePrompt!: (value: string) => void;
    let rejectPrompt!: (reason: unknown) => void;
    const promptPromise = new Promise<string>((resolve, reject) => {
      resolvePrompt = resolve;
      rejectPrompt = reject;
    });
    const inspect = (chunk: unknown) => {
      output += String(chunk);
      if (output.length > 16_000) output = output.slice(-16_000);
      const prompt = extractAuthorizationPrompt(output);
      if (prompt && !promptResolved) {
        promptResolved = true;
        resolvePrompt(prompt);
      }
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.on('error', (error) => {
      if (!promptResolved) rejectPrompt(authInitError('无法启动设备授权进程（' + String(error) + '）', output));
    });
    child.on('exit', (code) => {
      if (!promptResolved) {
        const prompt = extractAuthorizationPrompt(output);
        if (prompt) {
          promptResolved = true;
          resolvePrompt(prompt);
        } else {
          rejectPrompt(authInitError('设备授权进程在输出授权链接前退出（code ' + String(code) + '）', output));
        }
      }
    });
    const promptTimer = setTimeout(() => {
      if (!promptResolved) rejectPrompt(authInitError('设备授权进程未在限时内输出授权链接', output));
    }, 20_000);
    const prompt = await promptPromise.finally(() => clearTimeout(promptTimer));
    const completion = this.pollAuthorization(user, 15 * 60 * 1000)
      .finally(() => {
        if (!child.killed) child.kill('SIGTERM');
      });
    return { prompt, completion };
  }

  public async runCommand(user: UserIdentity, args: string[]): Promise<unknown> {
    const identity = await this.status(user);
    if (!identity) throw new Error('DWS_OAUTH_REQUIRED');
    const result = await this.run(['--profile', identity.profileKey, ...args, '--format', 'json']);
    const parsed = safeJson(result.stdout);
    if (parsed?.ok === false) throw new Error(String(parsed?.error?.message ?? 'DWS command failed'));
    return parsed?.data ?? parsed;
  }

  private async run(args: string[], timeout = 60_000): Promise<{ stdout: string; stderr: string }> {
    const invocation = resolveInvocation(this.config.DWS_BIN);
    const result = await execFileAsync(invocation.file, [...invocation.prefix, ...args], {
      env: { ...process.env, DWS_CONFIG_DIR: this.config.DWS_CONFIG_DIR },
      timeout,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  }

  private async profileRegistered(user: UserIdentity): Promise<boolean> {
    // Registration-only lookup (unlike status(), which also requires a valid
    // token): a profile with an expired token still exists and should be
    // re-authorized with --profile bound to it.
    try {
      const profilesResult = await this.run(['profile', 'list', '--format', 'json']);
      const payload = safeJson(profilesResult.stdout);
      const data = payload?.data ?? payload;
      const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
      const profileKey = user.corpId + ':' + user.userId;
      return profiles.some((profile: any) => String(profile?.profile ?? '') === profileKey);
    } catch {
      return false;
    }
  }

  private async pollAuthorization(user: UserIdentity, timeoutMs: number): Promise<DwsIdentity> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const identity = await this.status(user);
        if (identity) return identity;
      } catch (error) {
        if (error instanceof Error && error.message.includes('identity mismatch')) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('DWS device authorization timed out');
  }
}

export function buildDeviceAuthorizationArgs(user: UserIdentity, registeredProfile: boolean): string[] {
  // The CLI rejects --profile for unregistered profiles (code 3, "profile not
  // found"), so a first-time employee must authorize WITHOUT it; the device
  // flow then creates their <corpId>:<userId> profile from the authorized
  // account. Identity binding is enforced afterwards in pollAuthorization via
  // status() + sameIdentity, so a mismatched account never passes.
  const args = ['auth', 'login', '--device', '--no-browser', '--recommend'];
  if (registeredProfile) args.push('--profile', user.corpId + ':' + user.userId);
  args.push('--format', 'json');
  return args;
}

function safeJson(value: string): any {
  try { return JSON.parse(value); } catch { return undefined; }
}

function resolveInvocation(command: string): { file: string; prefix: string[] } {
  if (process.platform === 'win32' && (command === 'dws' || command.toLowerCase().endsWith('dws.cmd'))) {
    const appData = process.env.APPDATA;
    const script = appData ? join(appData, 'npm', 'node_modules', 'dingtalk-workspace-cli', 'bin', 'dws.js') : '';
    if (script && existsSync(script)) return { file: process.execPath, prefix: [script] };
  }
  return { file: command, prefix: [] };
}

function extractAuthorizationPrompt(output: string): string | undefined {
  const parsed = safeJson(output.trim());
  const candidates = [
    parsed?.data?.verificationUriComplete,
    parsed?.data?.verification_uri_complete,
    parsed?.data?.url,
    parsed?.data?.shortUrl,
    parsed?.data?.short_url
  ];
  const structured = candidates.find((item) => typeof item === 'string' && item.length > 0);
  const url = structured ?? output.match(/https?:\/\/[^\s"'<>]+/)?.[0];
  const code = parsed?.data?.userCode ?? parsed?.data?.user_code ?? output.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/)?.[0];
  if (!url && !code) return undefined;
  return [url ? '授权地址：' + url : '', code ? '授权码：' + code : ''].filter(Boolean).join('\n\n');
}
