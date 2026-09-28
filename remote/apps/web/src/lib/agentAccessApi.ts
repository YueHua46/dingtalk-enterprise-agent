import { fetchJson, type JsonEnvelope } from './api';

export type DingTalkCandidate = {
  corp_id: string;
  user_id: string;
  display_name: string;
  department_ids?: number[];
  department_names?: string[];
  is_active?: number;
};

export type AgentStoreOption = {
  id: number;
  lingxing_sid: number;
  name: string;
  account_name?: string | null;
  country?: string | null;
  region?: string | null;
  market?: string | null;
};

export type SourceAccountOption = {
  id: number;
  username: string;
  display_name: string;
  role: string;
  is_active: number;
};

export type AgentGrant = {
  id: number;
  corp_id: string;
  dingtalk_user_id: string;
  dingtalk_display_name?: string | null;
  dingtalk_user_active?: number | null;
  scope_type: 'source_account' | 'selected_stores';
  source_app_user_id?: number | null;
  source_username?: string | null;
  source_display_name?: string | null;
  source_account_active?: number | null;
  is_active: number;
  stores?: AgentStoreOption[];
  created_at?: string;
  updated_at?: string;
};

export type EffectiveAgentScope = {
  corp_id: string;
  dingtalk_user_id: string;
  lingxing_sids: number[];
  stores: AgentStoreOption[];
  has_access: boolean;
};

export type AgentAccessOptions = { source_accounts: SourceAccountOption[]; stores: AgentStoreOption[] };

async function unwrap<T>(promise: Promise<JsonEnvelope<T>>): Promise<T> {
  const response = await promise;
  return response.data as T;
}

export function fetchAgentAccessOptions() {
  return unwrap(fetchJson<JsonEnvelope<AgentAccessOptions>>('/agent-access/options'));
}

export function fetchDingTalkCandidates(corpId?: string) {
  const query = corpId ? `?corp_id=${encodeURIComponent(corpId)}` : '';
  return unwrap(fetchJson<JsonEnvelope<{ candidates: DingTalkCandidate[] }>>(`/agent-access/dingtalk-candidates${query}`));
}

export function syncDingTalkDirectory(corpId: string) {
  return unwrap(fetchJson<JsonEnvelope<{ corp_id: string; count: number }>>('/agent-access/dingtalk-sync', {
    method: 'POST', body: JSON.stringify({ corp_id: corpId }),
  }));
}

export function fetchAgentGrants(corpId?: string) {
  const query = corpId ? `?corp_id=${encodeURIComponent(corpId)}` : '';
  return unwrap(fetchJson<JsonEnvelope<{ grants: AgentGrant[] }>>(`/agent-access/grants${query}`));
}

export function fetchAgentScopePreview(corpId: string, userId: string) {
  return unwrap(fetchJson<JsonEnvelope<EffectiveAgentScope>>(`/agent-access/preview-scope?corp_id=${encodeURIComponent(corpId)}&user_id=${encodeURIComponent(userId)}`));
}

export function fetchAgentGrantPreview(payload: Record<string, unknown>) {
  return unwrap(fetchJson<JsonEnvelope<EffectiveAgentScope>>('/agent-access/preview-grant', {
    method: 'POST', body: JSON.stringify(payload),
  }));
}

export function createAgentGrant(payload: Record<string, unknown>) {
  return unwrap(fetchJson<JsonEnvelope<{ grant: AgentGrant }>>('/agent-access/grants', {
    method: 'POST', body: JSON.stringify(payload),
  }));
}

export function updateAgentGrant(id: number, payload: Record<string, unknown>) {
  return unwrap(fetchJson<JsonEnvelope<{ grant: AgentGrant }>>(`/agent-access/grants/${id}`, {
    method: 'PUT', body: JSON.stringify(payload),
  }));
}

export function deleteAgentGrant(id: number) {
  return fetchJson<JsonEnvelope>(`/agent-access/grants/${id}`, { method: 'DELETE' });
}
