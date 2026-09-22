export type SurfaceType = 'direct' | 'group';
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_oauth'
  | 'waiting_confirmation'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface UserIdentity {
  corpId: string;
  userId: string;
  displayName?: string;
}

export interface ConversationSurface {
  type: SurfaceType;
  id: string;
}

export interface Attachment {
  id: string;
  name: string;
  sourceType?: 'image' | 'audio' | 'video' | 'file';
  contentType?: string;
  size?: number;
  url?: string;
  downloadCode?: string;
  localPath?: string;
  sha256?: string;
  extractedText?: string;
}

export interface AgentRequest {
  requestId: string;
  messageId: string;
  user: UserIdentity;
  surface: ConversationSurface;
  text: string;
  attachments: Attachment[];
  quotedMessageId?: string;
  quotedText?: string;
  receivedAt: number;
}

export interface OutboundMessage {
  surface: ConversationSurface;
  markdown: string;
  title?: string;
}

export interface TaskRecord {
  id: string;
  request: AgentRequest;
  status: TaskStatus;
  createdAt: number;
  threadId?: string;
  cardBizId?: string;
  resultSummary?: string;
  errorCode?: string;
}

export type RiskLevel = 'read' | 'write' | 'high';

export interface ToolAction {
  name: string;
  risk: RiskLevel;
  target?: string;
  parameters?: unknown;
}

export interface ApprovalChallenge {
  taskId: string;
  user: UserIdentity;
  action: ToolAction;
  parameterHash: string;
  expiresAt: number;
}

export interface StoredApproval {
  challenge: ApprovalChallenge;
  method: string;
  status: 'pending' | 'approved' | 'cancelled' | 'expired' | 'executed';
}

export interface ToolInvocationRecord {
  idempotencyKey: string;
  taskId: string;
  actionHash: string;
  status: 'started' | 'completed' | 'failed' | 'unknown';
  result?: unknown;
}

export interface UserMemory {
  key: string;
  value: string;
  sensitivity: 'normal';
  expiresAt?: number;
}

export interface CodexTurnResult {
  text: string;
  threadId: string;
  approval?: ApprovalChallenge;
}

export interface DwsIdentity {
  corpId: string;
  userId: string;
  profileKey: string;
}
