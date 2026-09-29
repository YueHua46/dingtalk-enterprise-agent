import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Config } from './config.js';
import type { ConversationSurface, DwsIdentity, UserIdentity } from './types.js';
import { sameIdentity } from './security.js';
import { generatedDwsCapabilities } from './generated-dws-capabilities.js';

const execFileAsync = promisify(execFile);

// Stable marker so the orchestrator can distinguish "authorization could not
// even be initiated" (an infrastructure problem) from other DWS failures.
export const DWS_AUTH_INIT_FAILED = 'DWS_AUTH_INIT_FAILED';

// Stable marker for the CLI's own ConfirmSafety gate: the command was refused
// because the user has not confirmed it yet (no --yes). The orchestrator turns
// this into the interactive approval flow and retries with --yes.
export const DWS_CLI_CONFIRMATION_REQUIRED = 'DWS_CLI_CONFIRMATION_REQUIRED';

export function isConfirmationGateError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(DWS_CLI_CONFIRMATION_REQUIRED);
}

function isConfirmationDiagnostic(category: string, code: string, message: string): boolean {
  return /confirm/i.test(category) || /confirm/i.test(code)
    || /confirmation[\s_-]*required|requires?[\s_-]*(user[\s_-]*)?confirmation/i.test(message);
}

/** Map a CLI failure (JSON on stdout with ok:false, or a non-zero exit with a
 *  JSON diagnostic on stderr) into an error the orchestrator can branch on.
 */
function asCliCommandError(outputs: Array<{ text: string }>): Error {
  for (const output of outputs) {
    const parsed = safeJson(output.text);
    const err = parsed?.error;
    if (!err && parsed?.ok !== false) continue;
    const category = String(err?.category ?? '');
    const code = String(err?.code ?? '');
    const message = String(err?.message ?? 'DWS command failed');
    if (isConfirmationDiagnostic(category, code, message)) {
      return new Error(DWS_CLI_CONFIRMATION_REQUIRED + '[' + (category || code || 'gate') + ']: ' + message);
    }
  }
  for (const output of outputs) {
    const parsed = safeJson(output.text);
    if (parsed?.ok === false || parsed?.error) {
      return new Error(String(parsed?.error?.message ?? 'DWS command failed'));
    }
  }
  return new Error('DWS command failed');
}

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

const STATUS_CACHE_TTL_MS = 2 * 60 * 1000;

export class DwsBroker {
  private readonly schemaCache = new Map<string, { parameters: Record<string, unknown>; cli_path: string }>();
  private readonly statusCache = new Map<string, { identity: DwsIdentity; expiresAt: number }>();
  public constructor(private readonly config: Config) {}

  /** Read the exact leaf contract from the installed CLI version. This is
   * static capability metadata, so it does not require a user profile. */
  public async schemaForCapability(name: string): Promise<{ parameters: Record<string, unknown>; cli_path: string }> {
    const registered = generatedDwsCapabilities[name as keyof typeof generatedDwsCapabilities];
    if (!registered) throw new Error('DWS_SCHEMA_CAPABILITY_UNREGISTERED');
    const cached = this.schemaCache.get(name);
    if (cached) return cached;
    const cliPath = [registered.service, ...registered.command].join(' ');
    const response = await this.run(['schema', '--cli-path', cliPath, '--compact', '-f', 'json']);
    const parsed = safeJson(response.stdout);
    if (!parsed || parsed.cli_path !== cliPath || !parsed.parameters || typeof parsed.parameters !== 'object' || Array.isArray(parsed.parameters)) {
      throw new Error('DWS_SCHEMA_UNAVAILABLE:' + name);
    }
    const schema = { cli_path: cliPath, parameters: parsed.parameters as Record<string, unknown> };
    this.schemaCache.set(name, schema);
    return schema;
  }

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

  public async sendBotFile(user: UserIdentity, surface: ConversationSurface, filePath: string): Promise<unknown> {
    const identity = await this.status(user);
    if (!identity) throw new Error('DWS_OAUTH_REQUIRED');
    // The installed DWS leaf accepts a safe relative path for bot file upload.
    // Run it from the validated gateway output directory, never in the worker.
    const target = surface.type === 'group' ? ['--group', surface.id] : ['--users', surface.id];
    const result = await this.run([
      '--profile', identity.profileKey, 'chat', '+messages-send', '--as', 'bot',
      '--robot-code', this.config.DINGTALK_ROBOT_CODE, ...target,
      '--msg-type', 'file', '--file', basename(filePath), '--yes', '--format', 'json'
    ], 120_000, dirname(filePath));
    const parsed = safeJson(result.stdout);
    if (!parsed || parsed.ok === false || parsed.error) throw new Error(String(parsed?.error?.message ?? 'DWS_FILE_SEND_FAILED'));
    const data = parsed.data ?? parsed;
    if (data.complete === false || (Array.isArray(data.failures) && data.failures.length)) throw new Error('DWS_FILE_SEND_PARTIAL');
    return data;
  }

  public async inspectDriveFile(user: UserIdentity, nodeId: string): Promise<{ node: any; version: any }> {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(nodeId)) throw new Error('DRIVE_NODE_ID_INVALID');
    const node = await this.runCommand(user, ['drive', '+inspect', '--node', nodeId]);
    const version = await this.runCommand(user, ['drive', '+version-history', '--node', nodeId, '--limit', '1']);
    return { node, version };
  }

  /**
   * DingTalk's Stream callback does not consistently include quote metadata
   * for replies sent by a user identity. The message detail API does, so a
   * bare cancellation command can recover the referenced message without
   * asking the operator to copy an internal task id.
   */
  public async resolveQuotedMessage(user: UserIdentity, messageId: string): Promise<{
    messageId: string;
    conversationId?: string;
    quotedMessageId?: string;
    quotedConversationId?: string;
    quotedCreateTime?: string;
    quotedText?: string;
  } | undefined> {
    const result = await this.runCommand(user, [
      'chat', '+messages-mget', '--msg-ids', messageId, '--no-reactions', '--no-threads'
    ]) as Record<string, any>;
    const messages = Array.isArray(result?.messages) ? result.messages : [];
    const message = messages.find((item: any) => String(item?.messageId ?? '') === messageId) ?? messages[0];
    if (!message || typeof message !== 'object') return undefined;
    const quoted = message.quotedMessage ?? message.quoteMessage ?? message.originalMessage;
    const quotedMessageId = firstNonEmptyString(
      quoted?.messageId,
      quoted?.openMessageId,
      message.quotedMessageId,
      message.originalMessageId
    );
    const conversationId = firstNonEmptyString(message.conversationId, message.openConversationId);
    const quotedConversationId = firstNonEmptyString(quoted?.conversationId, quoted?.openConversationId);
    const quotedCreateTime = firstNonEmptyString(quoted?.createTime, quoted?.createdAt, quoted?.createAt);
    const quotedText = firstNonEmptyString(quoted?.text, quoted?.content);
    return {
      messageId: firstNonEmptyString(message.messageId, message.openMessageId) ?? messageId,
      ...(conversationId ? { conversationId } : {}),
      ...(quotedMessageId ? { quotedMessageId } : {}),
      ...(quotedConversationId ? { quotedConversationId } : {}),
      ...(quotedCreateTime ? { quotedCreateTime } : {}),
      ...(quotedText ? { quotedText } : {})
    };
  }

  /**
   * Returns message ids immediately preceding a quoted bot card/message. A
   * delivered card's DingTalk openMessageId is different from its outTrackId,
   * so the preceding user request is the stable task correlation point.
   */
  public async precedingConversationMessageIds(
    user: UserIdentity,
    conversationId: string,
    quotedMessageId: string,
    quotedCreateTime: string
  ): Promise<string[]> {
    const timestamp = dingTalkMessageTime(quotedCreateTime);
    if (!timestamp) return [];
    const result = await this.runCommand(user, [
      'chat', '+chat-messages', '--conversation-id', conversationId,
      '--start', new Date(timestamp - 5 * 60_000).toISOString(),
      '--end', new Date(timestamp + 2_000).toISOString(),
      '--order', 'desc', '--limit', '100', '--no-reactions'
    ]) as Record<string, any>;
    const messages = Array.isArray(result?.messages) ? result.messages : [];
    const quoteIndex = messages.findIndex((item: any) => firstNonEmptyString(item?.messageId, item?.openMessageId) === quotedMessageId);
    const older = quoteIndex >= 0
      ? messages.slice(quoteIndex + 1)
      : messages.filter((item: any) => {
        const itemTime = dingTalkMessageTime(firstNonEmptyString(item?.createTime, item?.createdAt));
        return itemTime !== undefined && itemTime <= timestamp;
      });
    return older
      .map((item: any) => firstNonEmptyString(item?.messageId, item?.openMessageId))
      .filter((value: string | undefined): value is string => Boolean(value));
  }

  public async downloadDriveFile(user: UserIdentity, nodeId: string, directory: string, fileName: string): Promise<unknown> {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(nodeId)) throw new Error('DRIVE_NODE_ID_INVALID');
    const identity = await this.status(user);
    if (!identity) throw new Error('DWS_OAUTH_REQUIRED');
    const result = await this.run([
      '--profile', identity.profileKey, 'drive', '+download', '--node', nodeId,
      '--output', basename(fileName), '--format', 'json'
    ], 120_000, directory);
    const parsed = safeJson(result.stdout);
    if (!parsed || parsed.ok === false || parsed.error) throw new Error(String(parsed?.error?.message ?? 'DRIVE_DOWNLOAD_FAILED'));
    return parsed.data ?? parsed;
  }

  public async downloadChatFile(user: UserIdentity, conversationId: string, messageId: string, fileId: string, directory: string, fileName: string): Promise<string> {
    const identity = await this.status(user);
    if (!identity) throw new Error('DWS_OAUTH_REQUIRED');
    const result = await this.run([
      '--profile', identity.profileKey, 'chat', '+messages-resource-download',
      '--type', 'fileId', '--resource-id', fileId, '--message-id', messageId,
      '--open-conversation-id', conversationId, '--output', basename(fileName), '--format', 'json'
    ], 120_000, directory);
    const parsed = safeJson(result.stdout);
    if (!parsed || parsed.error || parsed.messageVerified !== true || parsed.resourceId !== fileId || parsed.messageId !== messageId) {
      throw new Error(String(parsed?.error?.message ?? 'CHAT_FILE_DOWNLOAD_UNVERIFIED'));
    }
    return String(parsed.localPath ?? fileName);
  }

  public async overwriteDriveFile(user: UserIdentity, nodeId: string, filePath: string, fileName?: string): Promise<unknown> {
    const identity = await this.status(user);
    if (!identity) throw new Error('DWS_OAUTH_REQUIRED');
    const result = await this.run([
      '--profile', identity.profileKey, 'drive', '+upload', '--file', basename(filePath),
      '--node', nodeId, ...(fileName ? ['--file-name', fileName] : []), '--yes', '--format', 'json'
    ], 120_000, dirname(filePath));
    const parsed = safeJson(result.stdout);
    if (!parsed || parsed.ok === false || parsed.error) throw new Error(String(parsed?.error?.message ?? 'DRIVE_OVERWRITE_FAILED'));
    return parsed.data ?? parsed;
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

  /**
   * Verified identities are cached briefly: every DWS call used to spawn the
   * CLI twice just to re-check a token that was valid seconds earlier.
   * Negative results are never cached, and authorization polling bypasses it.
   */
  public async status(user: UserIdentity, options: { fresh?: boolean } = {}): Promise<DwsIdentity | null> {
    const profileKey = user.corpId + ':' + user.userId;
    const cached = this.statusCache.get(profileKey);
    if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.identity;
    const identity = await this.readStatus(user, profileKey);
    if (identity) this.statusCache.set(profileKey, { identity, expiresAt: Date.now() + STATUS_CACHE_TTL_MS });
    else this.statusCache.delete(profileKey);
    return identity;
  }

  /** Drops a cached identity after the CLI reports an authorization failure. */
  public invalidateStatus(user: UserIdentity): void {
    this.statusCache.delete(user.corpId + ':' + user.userId);
  }

  private async readStatus(user: UserIdentity, profileKey: string): Promise<DwsIdentity | null> {
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
    let result: { stdout: string; stderr: string };
    try {
      result = await this.run(['--profile', identity.profileKey, ...args, '--format', 'json']);
    } catch (error) {
      // The CLI reports gate/validation failures with a non-zero exit code and
      // a JSON diagnostic on stderr (verified: {"error":{"category":...}}).
      const stdout = (error as { stdout?: unknown })?.stdout;
      const stderr = (error as { stderr?: unknown })?.stderr;
      if (typeof stdout === 'string' || typeof stderr === 'string') {
        throw asCliCommandError([{ text: String(stdout ?? '') }, { text: String(stderr ?? '') }]);
      }
      throw error;
    }
    const parsed = safeJson(result.stdout);
    if (parsed?.ok === false || parsed?.error) {
      const error = asCliCommandError([{ text: result.stdout }, { text: result.stderr }]);
      if (/auth|token|unauthori[sz]ed|expired|login/i.test(error.message)) this.invalidateStatus(user);
      throw error;
    }
    return parsed?.data ?? parsed;
  }

  private async run(args: string[], timeout = 60_000, cwd?: string): Promise<{ stdout: string; stderr: string }> {
    const invocation = resolveInvocation(this.config.DWS_BIN);
    const result = await execFileAsync(invocation.file, [...invocation.prefix, ...args], {
      env: { ...process.env, DWS_CONFIG_DIR: this.config.DWS_CONFIG_DIR },
      cwd,
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
        const identity = await this.status(user, { fresh: true });
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

function firstNonEmptyString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function dingTalkMessageTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? value.replace(' ', 'T') + '+08:00'
    : value;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : undefined;
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
