# Amazon Agent 数据授权与 CrossBorderOps 接入计划

更新时间：2026-09-24

## 目标

让钉钉用户通过 Agent 查询 Amazon 经营数据时，按 CrossBorderOps 中配置的真实店铺范围取数：

- 每个钉钉用户可以关联一个现有 CrossBorderOps 账号，继承该账号当前授权的全部店铺；
- 也可以直接指定店铺；同一个用户可以配置多条映射，最终权限取所有映射店铺的并集；
- 同一店铺可以授权给多个运营人员；
- 温敏娟这类跨区域负责人按实际店铺集合授权，不按 EU/US/JP 标签推算；
- 未绑定、停用、离职或工厂部门人员默认无权限；
- 所有经营、广告、库存、排名、评分评论和 AI 分析均使用同一套有效店铺范围。

## 最终权限模型

```text
DingTalk corpId + userId
        │
        ▼
钉钉目录缓存（姓名、部门、在职状态）
        │
        ▼
Agent 数据授权关系
        ├─ source_account：关联现有 CrossBorderOps 账号，继承该账号全部店铺
        └─ selected_stores：直接指定店铺
        │
        ▼
effective_store_ids
        = 所有映射店铺的并集
        │
        ▼
所有数据查询和分析接口统一按 effective_store_ids 裁剪
```

TAG、部门名称、国家站点和运营人员姓名只作为展示与筛选字段，不作为最终权限条件。

## 数据表设计

### 1. `dingtalk_directory_users`

用于缓存钉钉通讯录候选，避免管理页面每次打开都调用钉钉 API。

- `corp_id`
- `user_id`（与 `corp_id` 联合唯一）
- `display_name`
- `department_ids` / `department_names`
- `is_active`
- `source_updated_at`
- `last_synced_at`

只保存授权管理需要的字段，不保存手机号、邮箱和花名册隐私字段。

### 2. `agent_data_grants`

一个钉钉成员可以有多条授权，因此不把授权塞进现有 `app_user` 表。

- `id`
- `corp_id`
- `dingtalk_user_id`
- `source_app_user_id`：可选，现有 CrossBorderOps 账号的 `app_user.id`
- `scope_type`：`source_account` 或 `selected_stores`
- `is_active`
- `created_by`
- `updated_by`
- `created_at` / `updated_at`

### 3. `agent_data_grant_stores`

仅用于 `selected_stores` 映射。

- `grant_id`
- `store_id`
- 联合唯一键 `(grant_id, store_id)`

关联账号店铺变化时，`source_account` 映射自动跟随；直接指定店铺映射不自动扩张。

## CrossBorderOps 后端模块

### 钉钉目录服务

建议新增：

- `services/dingtalk_directory_service.py`
- `database/models/dingtalk_directory.py`
- `database/models/dingtalk_directory_sql.py`

职责：

1. 使用已有 `DingTalkConfigService` 的 AppKey/AppSecret 获取应用令牌；
2. 递归读取部门树和成员列表；
3. 排除“工厂”部门及其全部下级；
4. 按 `(corp_id, user_id)` 去重；
5. 同步后标记离职或不可见成员为 inactive；
6. 不把应用密钥或令牌返回浏览器。

### 授权服务

建议新增：

- `services/agent_data_access_service.py`
- `database/models/agent_data_grant.py`
- `database/models/agent_data_grant_sql.py`

职责：

- 读取和校验关联账号的现有店铺集合；
- 校验直接指定的店铺仍然存在且可用；
- 计算某个 `(corp_id, user_id)` 的有效店铺集合；
- 无映射返回空集合，不降级为超级管理员；
- 关联账号停用时，该条账号映射失效；直接指定店铺映射不受影响；
- 记录授权变更审计。

### 管理 API

建议新增 `apps/backend/api/agent_access_routes.py`：

- `GET /agent-access/dingtalk-candidates`
- `POST /agent-access/dingtalk-sync`
- `GET /agent-access/grants`
- `POST /agent-access/grants`
- `PUT /agent-access/grants/<id>`
- `DELETE /agent-access/grants/<id>`
- `GET /agent-access/preview-scope`
- `GET /agent-access/audits`
- `GET /agent-access/effective-scope/<corp_id>/<user_id>`（仅内部服务调用）
- `POST /agent-access/query`（仅 Agent 内部服务调用）

管理 API 只允许 `superuser` / `admin` 使用。有效范围接口必须使用内部服务令牌，不开放给浏览器。

## CrossBorderOps 前端模块

建议新增：

- `apps/web/src/lib/agentAccessApi.ts`
- `apps/web/src/pages/AgentDataAccessPage.tsx`
- `apps/web/src/components/agent-access/DingTalkMemberSelect.tsx`
- `apps/web/src/components/agent-access/AgentGrantEditor.tsx`

页面功能：

1. 同步/刷新钉钉成员；
2. 姓名、部门搜索；
3. 选择“关联现有账号”或“直接指定店铺”；
4. 关联账号模式选择现有账号，直接指定模式按店铺多选；
6. 保存前展示最终有效店铺；
7. 显示停用人员、负责人账号变更和授权更新时间；
8. 不允许通过站点标签直接批量授权。

## Agent 侧模块

当前已完成：

- `src/dingtalk-directory.ts`：读取并过滤钉钉目录；
- `/internal/directory/candidates`：受内部令牌保护的候选接口；
- 工厂部门过滤和 24 人真实联调；
- Docker 部署与健康检查。

已新增：

- `src/crossborderops-access-client.ts`：以 Agent 当前 `corpId + userId` 调用 CrossBorderOps 有效范围接口；
- `src/crossborderops-data-client.ts` / `src/crossborderops-tool.ts`：统一查询 CrossBorderOps 日报、广告、评论、排名和 AI 分析数据；
- `CROSSBORDEROPS_API_URL`、`CROSSBORDEROPS_INTERNAL_TOKEN` 配置；
- Agent 在调用后台数据接口前先取得有效范围；
- 后台不可用、无授权、数据范围为空时 fail closed；
- 将授权范围和数据新鲜度作为分析证据，不写入长期用户记忆。

统一查询入口为 `POST /agent-access/query`，由 CrossBorderOps 服务端重新计算有效范围，禁止客户端通过参数扩大店铺范围。

## Amazon 分析 Skill 接入

更新 `skills/amazon-business-performance-analysis`：

- 明确“先取得有效店铺范围，再读取数据”；
- 明确禁止使用 `superadmin` 代查；
- 明确账号继承/直接选店/多条映射合并规则；
- 对跨店铺聚合结果显示授权范围和数据完整性；
- 将无权限、未绑定、数据延迟和部分店铺缺失区分处理。

## 迁移与部署顺序

1. 在 CrossBorderOps 增加表结构与后端服务，先不启用 Agent 实时取数；
2. 加入通讯录同步与只读候选 API；
3. 加入管理页面，录入现有账号继承映射或直接店铺映射；
4. 为需要细分范围的人员配置直接店铺映射并验证有效范围；
5. 增加有效范围内部接口和审计；
6. Agent 增加后台数据客户端；
7. 在测试环境验证四类权限：负责人、单负责人助理、多负责人助理、未授权人员；
8. 只读灰度运行，确认审计和数据范围正确后再开放全部分析能力。

## 必测场景

- 温敏娟可见其账号当前全部 EU 和 US 店铺；
- 直接店铺映射的用户只见明确选中的店铺；
- 同一店铺授权给多个钉钉用户时每人均可见；
- 同一用户多条映射时只取得所有映射店铺并集；
- 关联账号失去某店铺后，该账号映射同步失去该店铺；
- 工厂人员不出现在候选列表；
- 未绑定钉钉 userId 的请求返回无权限；
- 站点标签变化不会扩大店铺权限；
- 日报、广告、评论、排名和 AI 分析使用同一有效范围；
- CrossBorderOps 或钉钉接口异常时不降级为全量数据。

## 当前状态（2026-09-24）

- Agent 目录读取和工厂过滤：已实现并部署，实测得到 24 名候选人员。
- CrossBorderOps 使用独立的只读通讯录凭证覆盖项，已成功同步 24 名候选，排除工厂部门及其成员 30 人。
- CrossBorderOps 授权表、通用授权服务、管理 API、设置页：已实现并部署。
- 管理页支持 corpId、钉钉成员、关联现有账号、直接指定店铺、多条映射和删除映射；未自动写入任何生产授权映射。
- CrossBorderOps 有效范围内部接口：已实现，使用内部令牌保护；未绑定用户返回空集合，错误令牌返回 401。
- CrossBorderOps 统一数据查询接口：已实现，覆盖 `daily.*`、`ads.*`、`reviews.*`、`rank.*` 数据集；无授权、越权店铺、服务异常均 fail-closed。
- 授权变更审计：已实现独立审计表，记录 create/update/delete 的操作人、钉钉用户、旧映射、新映射和时间。
- Agent 到 CrossBorderOps 的有效范围客户端：已实现，调用领星动态业务工具前 fail-closed 校验；空范围或后台不可用不会降级为全量数据。
- Agent 的 `crossborderops.query` 动态工具：已部署到 Codex App Server，模型应优先通过该工具读取后台采集数据。
- 端到端冒烟验证：临时指定一个测试店铺调用统一查询接口，返回仅包含该 SID，测试映射已清理。
- 已验证：现有后台 92 个可采集店铺、4 个现有账号；临时事务测试确认“关联账号店铺 + 直接指定店铺”取并集。
- 生产授权数据录入：尚未执行，需要在 CrossBorderOps 设置页由管理员按实际业务关系配置。
