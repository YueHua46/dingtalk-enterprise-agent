import { Alert, Button, Card, Input, Popconfirm, Radio, Select, Space, Table, Tag, message } from 'antd';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useSettingsLayout } from '@/context/SettingsLayoutContext';
import { canManageUsers } from '@/lib/userApi';
import {
  createAgentGrant, deleteAgentGrant, updateAgentGrant, fetchAgentAccessOptions, fetchAgentGrants, fetchDingTalkCandidates,
  fetchAgentScopePreview, fetchAgentGrantPreview, syncDingTalkDirectory, type AgentGrant, type AgentStoreOption, type DingTalkCandidate,
  type SourceAccountOption,
} from '@/lib/agentAccessApi';

const EMPTY_CANDIDATES: DingTalkCandidate[] = [];

function storeLabel(store: AgentStoreOption) {
  return `${store.name} · SID ${store.lingxing_sid}${store.country ? ` · ${store.country}` : ''}`;
}

export function AgentDataAccessPage() {
  const { user } = useAuth();
  const { setPanel, clearPanel } = useSettingsLayout();
  const [corpId, setCorpId] = useState('');
  const [candidates, setCandidates] = useState<DingTalkCandidate[]>(EMPTY_CANDIDATES);
  const [grants, setGrants] = useState<AgentGrant[]>([]);
  const [stores, setStores] = useState<AgentStoreOption[]>([]);
  const [accounts, setAccounts] = useState<SourceAccountOption[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>();
  const [scopeType, setScopeType] = useState<'source_account' | 'selected_stores'>('source_account');
  const [sourceAccount, setSourceAccount] = useState<number>();
  const [selectedStores, setSelectedStores] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [preview, setPreview] = useState<{ stores: AgentStoreOption[]; has_access: boolean }>();
  const [previewProjected, setPreviewProjected] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => { setPanel({ owner: 'user', topbar: null, subNav: [] }); return () => clearPanel(); }, [setPanel, clearPanel]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [options, memberRows, grantRows] = await Promise.all([
        fetchAgentAccessOptions(), fetchDingTalkCandidates(corpId || undefined), fetchAgentGrants(corpId || undefined),
      ]);
      setStores(options.stores || []); setAccounts(options.source_accounts || []);
      setCandidates(memberRows.candidates || []); setGrants(grantRows.grants || []);
      if (!corpId && memberRows.candidates?.length) setCorpId(memberRows.candidates[0].corp_id);
    } catch (error) { message.error(error instanceof Error ? error.message : '加载授权数据失败'); }
    finally { setLoading(false); }
  }, [corpId]);

  useEffect(() => { if (canManageUsers(user?.role)) void reload(); }, [reload, user?.role]);

  useEffect(() => {
    if (!corpId || !selectedUser) { setPreview(undefined); setPreviewProjected(false); setPreviewLoading(false); return; }
    let cancelled = false;
    const proposed = scopeType === 'source_account' ? Boolean(sourceAccount) : selectedStores.length > 0;
    setPreview(undefined);
    setPreviewProjected(false);
    setPreviewLoading(true);
    const request = proposed
      ? fetchAgentGrantPreview({ corp_id: corpId, dingtalk_user_id: selectedUser, scope_type: scopeType, source_app_user_id: sourceAccount, store_ids: selectedStores })
      : fetchAgentScopePreview(corpId, selectedUser);
    void request.then((value) => {
      if (!cancelled) { setPreview(value); setPreviewProjected(proposed); setPreviewLoading(false); }
    }).catch(() => { if (!cancelled) { setPreview(undefined); setPreviewProjected(false); setPreviewLoading(false); } });
    return () => { cancelled = true; };
  }, [corpId, selectedUser, scopeType, sourceAccount, selectedStores, grants]);

  const memberOptions = useMemo(() => candidates.map((item) => ({ value: item.user_id, label: `${item.display_name} · ${(item.department_names || []).join(' / ')}（${item.user_id}）`, corpId: item.corp_id })), [candidates]);
  const storeOptions = useMemo(() => stores.map((item) => ({ value: item.id, label: storeLabel(item) })), [stores]);
  const accountOptions = useMemo(() => accounts.map((item) => ({ value: item.id, label: `${item.display_name}（${item.username}）${['superuser', 'admin'].includes(item.role) ? ' · 全部可用店铺' : ''}` })), [accounts]);

  if (!canManageUsers(user?.role)) return <Navigate to="/settings/user/profile" replace />;

  async function syncDirectory() {
    if (!corpId.trim()) { message.warning('请先填写钉钉 corpId'); return; }
    setSyncing(true);
    try { const result = await syncDingTalkDirectory(corpId.trim()); message.success(`通讯录已同步：${result.count} 人`); await reload(); }
    catch (error) { message.error(error instanceof Error ? error.message : '同步失败'); }
    finally { setSyncing(false); }
  }

  async function addGrant() {
    if (!selectedUser) { message.warning('请选择钉钉用户'); return; }
    if (scopeType === 'source_account' && !sourceAccount) { message.warning('请选择现有后台账号'); return; }
    if (scopeType === 'selected_stores' && !selectedStores.length) { message.warning('请选择店铺'); return; }
    if (previewLoading || !previewProjected || !preview) { message.warning('请等待最终授权范围预览完成'); return; }
    try {
      await createAgentGrant({ corp_id: corpId.trim(), dingtalk_user_id: selectedUser, scope_type: scopeType, source_app_user_id: sourceAccount, store_ids: selectedStores });
      message.success('授权映射已创建'); setSelectedUser(undefined); setSourceAccount(undefined); setSelectedStores([]); await reload();
    } catch (error) { message.error(error instanceof Error ? error.message : '创建授权失败'); }
  }

  async function removeGrant(id: number) {
    try { await deleteAgentGrant(id); message.success('授权映射已删除'); await reload(); }
    catch (error) { message.error(error instanceof Error ? error.message : '删除失败'); }
  }

  async function toggleGrant(row: AgentGrant) {
    try {
      await updateAgentGrant(row.id, {
        scope_type: row.scope_type,
        source_app_user_id: row.source_app_user_id,
        store_ids: (row.stores || []).map((store) => store.id),
        is_active: !row.is_active,
      });
      message.success(row.is_active ? '映射已停用' : '映射已启用');
      await reload();
    } catch (error) { message.error(error instanceof Error ? error.message : '更新失败'); }
  }

  return (
    <div className="settings-content-page">
      <header className="user-mgmt-intro">
        <div className="user-mgmt-intro-eyebrow">AGENT DATA ACCESS</div>
        <h1 className="user-mgmt-intro-title">Agent 数据授权</h1>
        <p className="user-mgmt-intro-desc">按钉钉用户绑定现有后台账号或指定店铺。一个用户可以配置多条映射，实际可见店铺自动取并集；绑定后台超级管理员或管理员账号会授权全部可用店铺。</p>
      </header>
      <Alert type="info" showIcon message="权限只按 corpId + userId 和明确店铺映射计算，不按姓名、部门、站点标签推算。未绑定用户默认无数据权限。" />
      <Card title="通讯录与授权范围" style={{ marginTop: 16 }}>
        <Space wrap>
          <Input value={corpId} onChange={(event) => setCorpId(event.target.value)} placeholder="钉钉 corpId" style={{ width: 300 }} />
          <Button icon={<SyncOutlined />} loading={syncing} onClick={() => void syncDirectory()}>同步钉钉成员</Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void reload()}>刷新</Button>
        </Space>
        <Space wrap style={{ marginTop: 16, width: '100%' }} align="start">
          <Select showSearch optionFilterProp="label" value={selectedUser} onChange={setSelectedUser} options={memberOptions} placeholder="选择钉钉用户" style={{ width: 280 }} />
          <Radio.Group value={scopeType} onChange={(event) => setScopeType(event.target.value)}>
            <Radio value="source_account">关联现有账号</Radio><Radio value="selected_stores">直接指定店铺</Radio>
          </Radio.Group>
          {scopeType === 'source_account' ? (
            <Select showSearch optionFilterProp="label" value={sourceAccount} onChange={setSourceAccount} options={accountOptions} placeholder="选择后台账号" style={{ width: 280 }} />
          ) : (
            <Select mode="multiple" showSearch optionFilterProp="label" value={selectedStores} onChange={setSelectedStores} options={storeOptions} placeholder="选择店铺" style={{ minWidth: 360 }} />
          )}
          <Button type="primary" disabled={previewLoading || !previewProjected || !preview} onClick={() => void addGrant()}>新增授权映射</Button>
        </Space>
        {selectedUser && (
          <Alert
            style={{ marginTop: 16 }}
            type={preview?.has_access ? 'success' : 'warning'}
            showIcon
            message={previewLoading ? '正在计算授权范围…' : preview?.has_access ? `${previewProjected ? '保存后预计范围' : '当前有效范围'}：${preview.stores.length} 个店铺` : '当前用户尚未形成有效店铺范围'}
            description={preview?.stores?.length ? preview.stores.map(storeLabel).join('、') : '选择账号或店铺后会预览与现有映射合并的最终范围；未绑定用户保持无权限。'}
          />
        )}
      </Card>
      <Card title={`当前映射（${grants.length} 条）`} style={{ marginTop: 16 }}>
        <Table rowKey="id" loading={loading} dataSource={grants} pagination={{ pageSize: 12 }} columns={[
          { title: '钉钉用户', render: (_: unknown, row: AgentGrant) => <span>{row.dingtalk_display_name || row.dingtalk_user_id}<br /><small>{row.corp_id} / {row.dingtalk_user_id}</small></span> },
          { title: '映射方式', render: (_: unknown, row: AgentGrant) => row.scope_type === 'source_account' ? <Tag color="blue">后台账号：{row.source_display_name || row.source_username}</Tag> : <Tag color="green">直接指定店铺：{row.stores?.length || 0} 个</Tag> },
          { title: '店铺预览', render: (_: unknown, row: AgentGrant) => row.scope_type === 'source_account' ? '跟随后台账号当前授权' : (row.stores || []).slice(0, 3).map((store) => storeLabel(store)).join('、') + ((row.stores || []).length > 3 ? '…' : '') },
          { title: '状态', render: (_: unknown, row: AgentGrant) => <span>{row.is_active ? <Tag color="green">映射启用</Tag> : <Tag>映射停用</Tag>}{row.dingtalk_user_active === 0 && <Tag color="red">钉钉成员停用</Tag>}{row.scope_type === 'source_account' && row.source_account_active === 0 && <Tag color="red">后台账号停用</Tag>}<br /><small>{row.updated_at ? `更新于 ${new Date(row.updated_at).toLocaleString()}` : ''}</small></span> },
          { title: '操作', render: (_: unknown, row: AgentGrant) => <Space size={0}><Popconfirm title={`确认${row.is_active ? '停用' : '启用'}这条映射？`} onConfirm={() => void toggleGrant(row)}><Button type="link">{row.is_active ? '停用' : '启用'}</Button></Popconfirm><Popconfirm title="删除这条授权映射？" onConfirm={() => void removeGrant(row.id)}><Button danger type="link">删除</Button></Popconfirm></Space> },
        ]} />
      </Card>
    </div>
  );
}

export default AgentDataAccessPage;
