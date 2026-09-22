// Generated from dingtalk-workspace-cli. Run npm run generate:dws-capabilities after upgrading DWS.
export type GeneratedDwsRisk = 'read' | 'write' | 'high';
export interface GeneratedDwsCapability { service: string; command: readonly string[]; risk: GeneratedDwsRisk; description: string }
export const generatedDwsCapabilities = {
  "aisearch.person": {
    "service": "aisearch",
    "command": [
      "person"
    ],
    "risk": "read",
    "description": "aisearch.person"
  },
  "aisearch.search-person": {
    "service": "aisearch",
    "command": [
      "+search-person"
    ],
    "risk": "read",
    "description": "按姓名、部门、职责或组织关系语义搜索企业人员"
  },
  "aitable.advperm-disable": {
    "service": "aitable",
    "command": [
      "+advperm-disable"
    ],
    "risk": "high",
    "description": "关闭指定 Base 的高级权限总开关（所有自定义角色失效）"
  },
  "aitable.advperm-enable": {
    "service": "aitable",
    "command": [
      "+advperm-enable"
    ],
    "risk": "write",
    "description": "开启指定 Base 的高级权限总开关"
  },
  "aitable.app-block-create": {
    "service": "aitable",
    "command": [
      "+app-block-create"
    ],
    "risk": "write",
    "description": "创建应用 Widget 并独立核对配置和 48 列布局"
  },
  "aitable.app-block-delete": {
    "service": "aitable",
    "command": [
      "+app-block-delete"
    ],
    "risk": "high",
    "description": "删除应用 Widget 并核对其所属页面列表"
  },
  "aitable.app-block-get": {
    "service": "aitable",
    "command": [
      "+app-block-get"
    ],
    "risk": "read",
    "description": "读取准确应用 Widget 配置与布局"
  },
  "aitable.app-block-list": {
    "service": "aitable",
    "command": [
      "+app-block-list"
    ],
    "risk": "read",
    "description": "列出准确应用页面中的全部 Widget"
  },
  "aitable.app-block-update": {
    "service": "aitable",
    "command": [
      "+app-block-update"
    ],
    "risk": "write",
    "description": "更新应用 Widget 并独立核对名称、配置或布局"
  },
  "aitable.app-get": {
    "service": "aitable",
    "command": [
      "+app-get"
    ],
    "risk": "write",
    "description": "获取 Base 唯一应用模式 App；不存在时自动创建，需确认"
  },
  "aitable.app-page-create": {
    "service": "aitable",
    "command": [
      "+app-page-create"
    ],
    "risk": "write",
    "description": "新建应用仪表盘页面并按返回 ID 读回名称"
  },
  "aitable.app-page-delete": {
    "service": "aitable",
    "command": [
      "+app-page-delete"
    ],
    "risk": "high",
    "description": "删除应用页面并核对完整页面目录中已不存在"
  },
  "aitable.app-page-get": {
    "service": "aitable",
    "command": [
      "+app-page-get"
    ],
    "risk": "read",
    "description": "读取准确应用页面及组件摘要"
  },
  "aitable.app-page-list": {
    "service": "aitable",
    "command": [
      "+app-page-list"
    ],
    "risk": "write",
    "description": "列出 Base 应用页面；不存在 App 时会创建默认 App，需确认"
  },
  "aitable.app-page-update": {
    "service": "aitable",
    "command": [
      "+app-page-update"
    ],
    "risk": "write",
    "description": "重命名应用页面并按准确 ID 读回"
  },
  "aitable.attachment-put": {
    "service": "aitable",
    "command": [
      "+attachment-put"
    ],
    "risk": "write",
    "description": "准备凭证、实际 PUT 本地文件、写入 attachment 单元格并读回验证"
  },
  "aitable.attachment-remove": {
    "service": "aitable",
    "command": [
      "+attachment-remove"
    ],
    "risk": "high",
    "description": "清空 attachment 字段或按文件名解析 resourceId 删除，并读回验证"
  },
  "aitable.attachment-upload": {
    "service": "aitable",
    "command": [
      "+attachment-upload"
    ],
    "risk": "write",
    "description": "为 attachment 字段申请 OSS 直传地址（uploadUrl / fileToken）"
  },
  "aitable.base-bootstrap": {
    "service": "aitable",
    "command": [
      "+base-bootstrap"
    ],
    "risk": "write",
    "description": "一次创建 Base、数据表和字段，逐层读回验证并在中断时报告已知副作用"
  },
  "aitable.base-copy": {
    "service": "aitable",
    "command": [
      "+base-copy"
    ],
    "risk": "write",
    "description": "复制 AI 表格（可选目标目录，可仅复制结构）"
  },
  "aitable.base-delete": {
    "service": "aitable",
    "command": [
      "+base-delete"
    ],
    "risk": "high",
    "description": "删除指定 Base（不可逆）"
  },
  "aitable.base-get": {
    "service": "aitable",
    "command": [
      "+base-get"
    ],
    "risk": "read",
    "description": "获取指定 Base 的目录信息（tables / dashboards summary）"
  },
  "aitable.base-get-primary-doc-id": {
    "service": "aitable",
    "command": [
      "+base-get-primary-doc-id"
    ],
    "risk": "read",
    "description": "根据 baseId/tableId/recordId 查询主键文档是否存在及其 dentryUuid"
  },
  "aitable.base-list": {
    "service": "aitable",
    "command": [
      "+base-list"
    ],
    "risk": "read",
    "description": "获取当前用户可访问的 AI 表格 Base 列表（最近访问，支持游标分页）"
  },
  "aitable.base-schema-snapshot": {
    "service": "aitable",
    "command": [
      "+base-schema-snapshot"
    ],
    "risk": "read",
    "description": "读取 Base、全部数据表、字段和视图的可复用结构快照，并严格校验每层响应"
  },
  "aitable.base-search": {
    "service": "aitable",
    "command": [
      "+base-search"
    ],
    "risk": "read",
    "description": "按名称关键词搜索 AI 表格 Base"
  },
  "aitable.base-update": {
    "service": "aitable",
    "command": [
      "+base-update"
    ],
    "risk": "write",
    "description": "更新 Base 名称（可选备注）"
  },
  "aitable.chart-create": {
    "service": "aitable",
    "command": [
      "+chart-create"
    ],
    "risk": "write",
    "description": "创建图表并独立核对配置和布局"
  },
  "aitable.chart-delete": {
    "service": "aitable",
    "command": [
      "+chart-delete"
    ],
    "risk": "high",
    "description": "删除指定 chart 及其布局项（不可逆）"
  },
  "aitable.chart-get": {
    "service": "aitable",
    "command": [
      "+chart-get"
    ],
    "risk": "read",
    "description": "获取指定 chart 的详细信息"
  },
  "aitable.chart-share-get": {
    "service": "aitable",
    "command": [
      "+chart-share-get"
    ],
    "risk": "read",
    "description": "查询 chart 的分享配置"
  },
  "aitable.chart-share-update": {
    "service": "aitable",
    "command": [
      "+chart-share-update"
    ],
    "risk": "write",
    "description": "开启/关闭 chart 分享并可设置分享类型"
  },
  "aitable.chart-update": {
    "service": "aitable",
    "command": [
      "+chart-update"
    ],
    "risk": "write",
    "description": "更新指定 chart 的配置或布局（--config 必填；layout 写前强制校验 12/48 列协议）"
  },
  "aitable.chart-widgets-example": {
    "service": "aitable",
    "command": [
      "+chart-widgets-example"
    ],
    "risk": "read",
    "description": "获取所有图表类型的 widget config 示例"
  },
  "aitable.dashboard-arrange": {
    "service": "aitable",
    "command": [
      "+dashboard-arrange"
    ],
    "risk": "write",
    "description": "对指定仪表盘做服务端智能布局重排"
  },
  "aitable.dashboard-config-example": {
    "service": "aitable",
    "command": [
      "+dashboard-config-example"
    ],
    "risk": "read",
    "description": "获取 dashboard config 的结构示例"
  },
  "aitable.dashboard-create": {
    "service": "aitable",
    "command": [
      "+dashboard-create"
    ],
    "risk": "write",
    "description": "创建仪表盘并独立核对新 ID 与名称"
  },
  "aitable.dashboard-delete": {
    "service": "aitable",
    "command": [
      "+dashboard-delete"
    ],
    "risk": "high",
    "description": "删除指定 dashboard（级联删除其 chart，不可逆）"
  },
  "aitable.dashboard-get": {
    "service": "aitable",
    "command": [
      "+dashboard-get"
    ],
    "risk": "read",
    "description": "获取指定 dashboard 的详细信息（含只读 schemaVersion 类型证据与 charts summary）"
  },
  "aitable.dashboard-list": {
    "service": "aitable",
    "command": [
      "+dashboard-list"
    ],
    "risk": "read",
    "description": "从完整 Base 目录读取仪表盘列表并验证每项 ID"
  },
  "aitable.dashboard-share-get": {
    "service": "aitable",
    "command": [
      "+dashboard-share-get"
    ],
    "risk": "read",
    "description": "查询 dashboard 的分享配置"
  },
  "aitable.dashboard-share-update": {
    "service": "aitable",
    "command": [
      "+dashboard-share-update"
    ],
    "risk": "write",
    "description": "开启/关闭 dashboard 分享并可设置分享类型"
  },
  "aitable.dashboard-update": {
    "service": "aitable",
    "command": [
      "+dashboard-update"
    ],
    "risk": "write",
    "description": "更新指定 dashboard 的配置"
  },
  "aitable.dashboard.create": {
    "service": "aitable",
    "command": [
      "dashboard",
      "create"
    ],
    "risk": "write",
    "description": "aitable.dashboard.create"
  },
  "aitable.data-query": {
    "service": "aitable",
    "command": [
      "+data-query"
    ],
    "risk": "read",
    "description": "用 DWS JSON DSL 统一执行标量或分组聚合，不拉全表做本地统计"
  },
  "aitable.datasource-create": {
    "service": "aitable",
    "command": [
      "+datasource-create"
    ],
    "risk": "write",
    "description": "为指定 AI 表格创建数据源同步配置，创建一张数据源表并触发首次全量同步。返回新建数据源表 ID 和同步任务 ID。"
  },
  "aitable.datasource-get-config": {
    "service": "aitable",
    "command": [
      "+datasource-get-config"
    ],
    "risk": "read",
    "description": "获取指定数据源表的同步配置信息，包括源配置、是否全量同步、是否自动同步、同步状态等。仅适用于数据源表（sync=true），普通表会返回错误。仅支持 OA 审批数据源（datasourceType=OA），其他数据源类型暂不支持，待后续开放。返回的 sourceConfig 包含数据源连接信息（如审批模板 ID、源表 ID 等）。"
  },
  "aitable.datasource-get-fields": {
    "service": "aitable",
    "command": [
      "+datasource-get-fields"
    ],
    "risk": "read",
    "description": "获取指定数据源下可供同步的字段列表，用于了解来源字段结构；当前仅支持全量同步。传入从 +datasource-list-sources 获取的 sourceConfig。仅支持 OA 审批数据源（datasourceType=OA），其他数据源类型暂不支持，待后续开放。"
  },
  "aitable.datasource-list-sources": {
    "service": "aitable",
    "command": [
      "+datasource-list-sources"
    ],
    "risk": "read",
    "description": "列出指定 Base 下可用的数据源条目。仅支持 OA 审批数据源（datasourceType=OA）。返回的每条条目包含 result 字段（下游原始 JSON 字符串）和 sourceType 字段（OA 审批对应 2，仅供参考）。OA 审批场景下 result 为包含 approvals 数组的 JSON 字符串，每个 approval 包含 processCode、name、iconUrl、url、keepRemovedFields、splitParentTableField 等字段。须原样透传至 sourceConfig 的字段（仅以下 4 个）：processCode、name、iconUrl、url；调用方自行设置的字段（即使 result 中有值也不透传）：keepRemovedFields、splitParentTableField；enableDataSyncOaDetailList 为下游内部字段，无需传入 sourceConfig。调用方应自行解析 result，提取目标模板字段后构造 sourceConfig 传入 +datasource-create。"
  },
  "aitable.datasource-sync": {
    "service": "aitable",
    "command": [
      "+datasource-sync"
    ],
    "risk": "write",
    "description": "对指定 AI 表格中的数据源表触发一次手动同步。单次最多 5 张表，每张表独立提交，部分失败不影响其他表。该工具仅触发任务即返回，不会等待同步完成。返回结果包含文档链接，用户可打开文档查看同步进度与最终数据。同步运行中（errorCode=4014）属于幂等冲突，会被标记为 failed 并允许调用方稍后重试。非数据源表（sync=false）不能用此工具触发同步，会以参数错误返回。"
  },
  "aitable.datasource-sync-status": {
    "service": "aitable",
    "command": [
      "+datasource-sync-status"
    ],
    "risk": "read",
    "description": "按任务 ID 查询指定数据源表的同步任务状态。与 +datasource-sync / +datasource-create / +datasource-update 配对使用，单次最多 5 个 taskId。仅 RUNNING 需要继续轮询；FINISHED、FAILED、NOT_FOUND 为终态；UNKNOWN 表示状态不可断言，也不应继续轮询。批量查询整体 success 时仍需逐项检查 tasks[].status 和 errorCode。"
  },
  "aitable.datasource-update": {
    "service": "aitable",
    "command": [
      "+datasource-update"
    ],
    "risk": "write",
    "description": "更新已有数据源表的完整源配置或自动同步设置，并触发一次全量同步。仅适用于数据源表，当前不支持选择同步字段。"
  },
  "aitable.export-data": {
    "service": "aitable",
    "command": [
      "+export-data"
    ],
    "risk": "read",
    "description": "导出 AI 表格数据（创建导出任务或按 taskId 续等）"
  },
  "aitable.field-create": {
    "service": "aitable",
    "command": [
      "+field-create"
    ],
    "risk": "write",
    "description": "批量新增字段，15 个分片并核对新字段 ID、类型与配置"
  },
  "aitable.field-delete": {
    "service": "aitable",
    "command": [
      "+field-delete"
    ],
    "risk": "high",
    "description": "删除指定字段（不可逆）"
  },
  "aitable.field-get": {
    "service": "aitable",
    "command": [
      "+field-get"
    ],
    "risk": "read",
    "description": "批量获取字段详情（含类型相关完整配置）"
  },
  "aitable.field-run-ai": {
    "service": "aitable",
    "command": [
      "+field-run-ai"
    ],
    "risk": "write",
    "description": "提交 AI 字段运行请求；缺少可靠受理证据时非零退出并保留回执"
  },
  "aitable.field-update": {
    "service": "aitable",
    "command": [
      "+field-update"
    ],
    "risk": "write",
    "description": "更新字段名称 / 说明 / 配置 / AI 配置（类型不可改）"
  },
  "aitable.field.list": {
    "service": "aitable",
    "command": [
      "field",
      "list"
    ],
    "risk": "read",
    "description": "aitable.field.list"
  },
  "aitable.find-record": {
    "service": "aitable",
    "command": [
      "+find-record"
    ],
    "risk": "read",
    "description": "在指定多维表里按关键词查记录（只读）"
  },
  "aitable.form-create": {
    "service": "aitable",
    "command": [
      "+form-create"
    ],
    "risk": "write",
    "description": "创建表单并按新 viewId 核对名称"
  },
  "aitable.form-delete": {
    "service": "aitable",
    "command": [
      "+form-delete"
    ],
    "risk": "high",
    "description": "删除指定表单视图（不可逆）"
  },
  "aitable.form-field-hide": {
    "service": "aitable",
    "command": [
      "+form-field-hide"
    ],
    "risk": "write",
    "description": "切换表单字段的隐藏/显示状态"
  },
  "aitable.form-field-list": {
    "service": "aitable",
    "command": [
      "+form-field-list"
    ],
    "risk": "read",
    "description": "列出表单视图当前可见的字段及其配置"
  },
  "aitable.form-field-update": {
    "service": "aitable",
    "command": [
      "+form-field-update"
    ],
    "risk": "write",
    "description": "更新表单字段的必填状态或描述"
  },
  "aitable.form-get": {
    "service": "aitable",
    "command": [
      "+form-get"
    ],
    "risk": "read",
    "description": "按准确 viewId 获取表单及可见题目"
  },
  "aitable.form-list": {
    "service": "aitable",
    "command": [
      "+form-list"
    ],
    "risk": "read",
    "description": "列出指定数据表下的所有表单视图"
  },
  "aitable.form-questions-remove": {
    "service": "aitable",
    "command": [
      "+form-questions-remove"
    ],
    "risk": "write",
    "description": "只隐藏表单题目并核对表字段仍存在，不删除整列"
  },
  "aitable.form-share-get": {
    "service": "aitable",
    "command": [
      "+form-share-get"
    ],
    "risk": "read",
    "description": "读取视图当前的分享表单配置"
  },
  "aitable.form-share-update": {
    "service": "aitable",
    "command": [
      "+form-share-update"
    ],
    "risk": "write",
    "description": "部分更新分享表单的开关、访问范围、有效期和通知等配置"
  },
  "aitable.form-submit": {
    "service": "aitable",
    "command": [
      "+form-submit"
    ],
    "risk": "write",
    "description": "提交已分享表单并按返回 rowId 核对写入值"
  },
  "aitable.form-update": {
    "service": "aitable",
    "command": [
      "+form-update"
    ],
    "risk": "write",
    "description": "更新表单标题 / 描述"
  },
  "aitable.import-data": {
    "service": "aitable",
    "command": [
      "+import-data"
    ],
    "risk": "write",
    "description": "将已上传文件导入 AI 表格（新建表或追加到已有表）"
  },
  "aitable.import-file": {
    "service": "aitable",
    "command": [
      "+import-file"
    ],
    "risk": "write",
    "description": "申请上传、PUT 本地 CSV/XLS/XLSX，并用同一 importId 触发导入；也可只续等已有任务"
  },
  "aitable.import-upload": {
    "service": "aitable",
    "command": [
      "+import-upload"
    ],
    "risk": "write",
    "description": "为导入任务申请 OSS 直传地址（uploadUrl / importId）"
  },
  "aitable.list-tables": {
    "service": "aitable",
    "command": [
      "+list-tables"
    ],
    "risk": "read",
    "description": "列出某个多维表(base)里的所有数据表（只读，投影 tableId/tableName）"
  },
  "aitable.record-batch-create": {
    "service": "aitable",
    "command": [
      "+record-batch-create"
    ],
    "risk": "write",
    "description": "批量新增记录，100 条分片并按返回 ID 独立验证；已有 recordId 明确拒绝"
  },
  "aitable.record-bulk-patch": {
    "service": "aitable",
    "command": [
      "+record-bulk-patch"
    ],
    "risk": "high",
    "description": "完整查询目标记录后批量合并同一组 cells，自动分片并逐条读回验证"
  },
  "aitable.record-delete": {
    "service": "aitable",
    "command": [
      "+record-delete"
    ],
    "risk": "high",
    "description": "批量删除记录（不可逆），自动按 100 条分片并逐批确认记录已不存在"
  },
  "aitable.record-download-attachment": {
    "service": "aitable",
    "command": [
      "+record-download-attachment"
    ],
    "risk": "read",
    "description": "按记录单元格中的准确 resourceId 下载附件，校验字节数并返回 SHA256"
  },
  "aitable.record-history-list": {
    "service": "aitable",
    "command": [
      "+record-history-list"
    ],
    "risk": "read",
    "description": "按 recordId 查询单条记录的变更历史"
  },
  "aitable.record-primary-doc-create": {
    "service": "aitable",
    "command": [
      "+record-primary-doc-create"
    ],
    "risk": "write",
    "description": "为记录创建主键文档（幂等），fieldId 须为 primaryDoc 类型"
  },
  "aitable.record-primary-doc-get": {
    "service": "aitable",
    "command": [
      "+record-primary-doc-get"
    ],
    "risk": "read",
    "description": "查询记录关联的主键文档 nodeId"
  },
  "aitable.record-query": {
    "service": "aitable",
    "command": [
      "+record-query"
    ],
    "risk": "read",
    "description": "查询单表记录，支持准确 ID、视图、条件、全量分页与 NDJSON 文件"
  },
  "aitable.record-query-empty": {
    "service": "aitable",
    "command": [
      "+record-query-empty"
    ],
    "risk": "read",
    "description": "扫描并过滤出完全没填用户字段的空行"
  },
  "aitable.record-share-links": {
    "service": "aitable",
    "command": [
      "+record-share-links"
    ],
    "risk": "read",
    "description": "批量（可 >20 条）获取多维表记录分享链接：去重+分片+合并"
  },
  "aitable.record-share-url": {
    "service": "aitable",
    "command": [
      "+record-share-url"
    ],
    "risk": "read",
    "description": "按 recordId 批量获取记录分享链接，单次最多 20 条"
  },
  "aitable.record-update": {
    "service": "aitable",
    "command": [
      "+record-update"
    ],
    "risk": "write",
    "description": "批量更新记录，自动按 100 条分片并逐批读回验证"
  },
  "aitable.record-upsert": {
    "service": "aitable",
    "command": [
      "+record-upsert"
    ],
    "risk": "write",
    "description": "按 recordId 自动拆分 create/update，按 100 条分片并读回验证"
  },
  "aitable.record-upsert-by-key": {
    "service": "aitable",
    "command": [
      "+record-upsert-by-key"
    ],
    "risk": "write",
    "description": "按唯一字段值有则更新、无则创建记录，并读回验证"
  },
  "aitable.record.create": {
    "service": "aitable",
    "command": [
      "record",
      "create"
    ],
    "risk": "write",
    "description": "aitable.record.create"
  },
  "aitable.resolve-base": {
    "service": "aitable",
    "command": [
      "+resolve-base"
    ],
    "risk": "read",
    "description": "按名称搜索多维表 Base 并解析出唯一 baseId（只读）"
  },
  "aitable.resolve-field": {
    "service": "aitable",
    "command": [
      "+resolve-field"
    ],
    "risk": "read",
    "description": "按精确名称唯一定位字段"
  },
  "aitable.resolve-table": {
    "service": "aitable",
    "command": [
      "+resolve-table"
    ],
    "risk": "read",
    "description": "在某个多维表 Base 内按名称解析出唯一的数据表 tableId（只读）"
  },
  "aitable.resolve-view": {
    "service": "aitable",
    "command": [
      "+resolve-view"
    ],
    "risk": "read",
    "description": "按精确名称唯一定位视图"
  },
  "aitable.role-create": {
    "service": "aitable",
    "command": [
      "+role-create"
    ],
    "risk": "write",
    "description": "在指定 Base 下创建自定义角色"
  },
  "aitable.role-delete": {
    "service": "aitable",
    "command": [
      "+role-delete"
    ],
    "risk": "high",
    "description": "删除 Base 下指定的自定义角色（不可逆）"
  },
  "aitable.role-get": {
    "service": "aitable",
    "command": [
      "+role-get"
    ],
    "risk": "read",
    "description": "获取单个角色的完整配置"
  },
  "aitable.role-list": {
    "service": "aitable",
    "command": [
      "+role-list"
    ],
    "risk": "read",
    "description": "列出指定 Base 下的全部角色"
  },
  "aitable.role-update": {
    "service": "aitable",
    "command": [
      "+role-update"
    ],
    "risk": "write",
    "description": "按 PATCH 语义增量更新自定义角色"
  },
  "aitable.section-create": {
    "service": "aitable",
    "command": [
      "+section-create"
    ],
    "risk": "write",
    "description": "在指定 Base 下创建文件夹（组织 table / dashboard）"
  },
  "aitable.section-delete": {
    "service": "aitable",
    "command": [
      "+section-delete"
    ],
    "risk": "high",
    "description": "删除指定文件夹（不可逆）"
  },
  "aitable.section-list-empty": {
    "service": "aitable",
    "command": [
      "+section-list-empty"
    ],
    "risk": "read",
    "description": "列出指定 Base 下所有没有子节点的空文件夹"
  },
  "aitable.section-list-nodes": {
    "service": "aitable",
    "command": [
      "+section-list-nodes"
    ],
    "risk": "read",
    "description": "列出指定 Base 当前版本下的全部 nsheet 节点"
  },
  "aitable.section-move-node": {
    "service": "aitable",
    "command": [
      "+section-move-node"
    ],
    "risk": "write",
    "description": "把任意 nsheet 节点移动到目标文件夹下（可选调整位置）"
  },
  "aitable.section-rename": {
    "service": "aitable",
    "command": [
      "+section-rename"
    ],
    "risk": "write",
    "description": "重命名指定文件夹"
  },
  "aitable.section-reorder": {
    "service": "aitable",
    "command": [
      "+section-reorder"
    ],
    "risk": "write",
    "description": "在当前父文件夹下调整文件夹的展示顺序"
  },
  "aitable.table-bootstrap": {
    "service": "aitable",
    "command": [
      "+table-bootstrap"
    ],
    "risk": "write",
    "description": "在已有 Base 中一次创建数据表和字段，自动分片并读回验证"
  },
  "aitable.table-copy": {
    "service": "aitable",
    "command": [
      "+table-copy"
    ],
    "risk": "write",
    "description": "跨 Base 同步复制一张表的可创建字段结构，并可同步复制全部记录"
  },
  "aitable.table-delete": {
    "service": "aitable",
    "command": [
      "+table-delete"
    ],
    "risk": "high",
    "description": "删除指定数据表（不可逆）"
  },
  "aitable.table-get": {
    "service": "aitable",
    "command": [
      "+table-get"
    ],
    "risk": "read",
    "description": "批量获取指定数据表的表级信息、字段目录与视图目录"
  },
  "aitable.table-update": {
    "service": "aitable",
    "command": [
      "+table-update"
    ],
    "risk": "write",
    "description": "更新数据表名称 / 备注 / 行命名规则"
  },
  "aitable.template-search": {
    "service": "aitable",
    "command": [
      "+template-search"
    ],
    "risk": "read",
    "description": "按名称关键词搜索 AI 表格模板"
  },
  "aitable.url-resolve": {
    "service": "aitable",
    "command": [
      "+url-resolve"
    ],
    "risk": "read",
    "description": "解析 AI 表格 URL 中的 baseId/tableId/viewId/recordId"
  },
  "aitable.view-delete": {
    "service": "aitable",
    "command": [
      "+view-delete"
    ],
    "risk": "high",
    "description": "删除指定视图（不可逆）"
  },
  "aitable.view-duplicate": {
    "service": "aitable",
    "command": [
      "+view-duplicate"
    ],
    "risk": "write",
    "description": "复制视图，生成配置相同的新视图"
  },
  "aitable.view-get": {
    "service": "aitable",
    "command": [
      "+view-get"
    ],
    "risk": "read",
    "description": "获取视图完整信息（列顺序、筛选、排序、分组等）"
  },
  "aitable.view-get-frozen-cols": {
    "service": "aitable",
    "command": [
      "+view-get-frozen-cols"
    ],
    "risk": "read",
    "description": "获取视图当前冻结的左侧列数"
  },
  "aitable.view-get-lock": {
    "service": "aitable",
    "command": [
      "+view-get-lock"
    ],
    "risk": "read",
    "description": "获取视图锁定状态"
  },
  "aitable.view-get-row-height": {
    "service": "aitable",
    "command": [
      "+view-get-row-height"
    ],
    "risk": "read",
    "description": "获取视图单元格行高（像素）"
  },
  "aitable.view-lock": {
    "service": "aitable",
    "command": [
      "+view-lock"
    ],
    "risk": "write",
    "description": "锁定视图（默认）或解锁（--off）"
  },
  "aitable.view-preset-apply": {
    "service": "aitable",
    "command": [
      "+view-preset-apply"
    ],
    "risk": "write",
    "description": "按视图精确名称幂等创建或更新预设；Gantt 可用独立 timebar 完成专用两步写入"
  },
  "aitable.view-set-fill-color-rule": {
    "service": "aitable",
    "command": [
      "+view-set-fill-color-rule"
    ],
    "risk": "write",
    "description": "全量覆盖 Grid 视图的条件填色规则（传 '[]' 清空）"
  },
  "aitable.view-set-frozen-cols": {
    "service": "aitable",
    "command": [
      "+view-set-frozen-cols"
    ],
    "risk": "write",
    "description": "设置视图冻结列数（0 表示取消冻结）"
  },
  "aitable.view-set-row-height": {
    "service": "aitable",
    "command": [
      "+view-set-row-height"
    ],
    "risk": "write",
    "description": "设置视图单元格行高（像素，合法档位 32/56/88/128）"
  },
  "aitable.view-update": {
    "service": "aitable",
    "command": [
      "+view-update"
    ],
    "risk": "write",
    "description": "更新视图名称 / 描述 / 配置（含类型校验后的筛选）"
  },
  "aitable.view.create": {
    "service": "aitable",
    "command": [
      "view",
      "create"
    ],
    "risk": "write",
    "description": "aitable.view.create"
  },
  "aitable.workflow-deploy": {
    "service": "aitable",
    "command": [
      "+workflow-deploy"
    ],
    "risk": "write",
    "description": "创建或更新完整 workflow-dsl/v1，检查 valid/flowId；新建默认验证 STOP，--enable 验证 RUNNING"
  },
  "aitable.workflow-disable": {
    "service": "aitable",
    "command": [
      "+workflow-disable"
    ],
    "risk": "high",
    "description": "禁用指定 Base 中的自动化工作流（影响业务自动化）"
  },
  "aitable.workflow-enable": {
    "service": "aitable",
    "command": [
      "+workflow-enable"
    ],
    "risk": "write",
    "description": "启用指定 Base 中的自动化工作流"
  },
  "aitable.workflow-get": {
    "service": "aitable",
    "command": [
      "+workflow-get"
    ],
    "risk": "read",
    "description": "获取单个自动化工作流的详细信息"
  },
  "aitable.workflow-list": {
    "service": "aitable",
    "command": [
      "+workflow-list"
    ],
    "risk": "read",
    "description": "列出指定 Base 中的自动化工作流（分页）"
  },
  "calendar.agenda": {
    "service": "calendar",
    "command": [
      "+agenda"
    ],
    "risk": "read",
    "description": "查询日程列表（不传时间默认查询今天）"
  },
  "calendar.attendee-list": {
    "service": "calendar",
    "command": [
      "+attendee-list"
    ],
    "risk": "read",
    "description": "查看日程参会人"
  },
  "calendar.attendee.add": {
    "service": "calendar",
    "command": [
      "attendee",
      "add"
    ],
    "risk": "write",
    "description": "calendar.attendee.add"
  },
  "calendar.attendee.delete": {
    "service": "calendar",
    "command": [
      "attendee",
      "delete"
    ],
    "risk": "write",
    "description": "calendar.attendee.delete"
  },
  "calendar.attendee.list": {
    "service": "calendar",
    "command": [
      "attendee",
      "list"
    ],
    "risk": "read",
    "description": "calendar.attendee.list"
  },
  "calendar.book": {
    "service": "calendar",
    "command": [
      "+book"
    ],
    "risk": "write",
    "description": "创建日程，并可按姓名邀请参会人（自动解析 userId，失败自动回滚删除日程）"
  },
  "calendar.book-list": {
    "service": "calendar",
    "command": [
      "+book-list"
    ],
    "risk": "read",
    "description": "查询用户的日历本列表"
  },
  "calendar.book-search": {
    "service": "calendar",
    "command": [
      "+book-search"
    ],
    "risk": "read",
    "description": "按名称模糊搜索日历本"
  },
  "calendar.busy.search": {
    "service": "calendar",
    "command": [
      "busy",
      "search"
    ],
    "risk": "read",
    "description": "calendar.busy.search"
  },
  "calendar.cancel-event": {
    "service": "calendar",
    "command": [
      "+cancel-event"
    ],
    "risk": "high",
    "description": "取消（删除）一个已有日程（删除前先确认它真实存在）"
  },
  "calendar.conflicts": {
    "service": "calendar",
    "command": [
      "+conflicts"
    ],
    "risk": "read",
    "description": "检测我某天日程的时间冲突（重叠/双重预订，默认今天）"
  },
  "calendar.create": {
    "service": "calendar",
    "command": [
      "+create"
    ],
    "risk": "write",
    "description": "创建日程并读回验证"
  },
  "calendar.event.create": {
    "service": "calendar",
    "command": [
      "event",
      "create"
    ],
    "risk": "write",
    "description": "calendar.event.create"
  },
  "calendar.event.delete": {
    "service": "calendar",
    "command": [
      "event",
      "delete"
    ],
    "risk": "high",
    "description": "calendar.event.delete"
  },
  "calendar.event.get": {
    "service": "calendar",
    "command": [
      "event",
      "get"
    ],
    "risk": "read",
    "description": "calendar.event.get"
  },
  "calendar.event.list": {
    "service": "calendar",
    "command": [
      "event",
      "list"
    ],
    "risk": "read",
    "description": "calendar.event.list"
  },
  "calendar.event.update": {
    "service": "calendar",
    "command": [
      "event",
      "update"
    ],
    "risk": "write",
    "description": "calendar.event.update"
  },
  "calendar.free": {
    "service": "calendar",
    "command": [
      "+free"
    ],
    "risk": "read",
    "description": "按姓名查询某人在指定时间段内的忙闲状态（自动解析 userId）"
  },
  "calendar.free-slots": {
    "service": "calendar",
    "command": [
      "+free-slots"
    ],
    "risk": "read",
    "description": "找我某天工作时段内的空闲时间段（默认今天 09:00-18:00）"
  },
  "calendar.freebusy": {
    "service": "calendar",
    "command": [
      "+freebusy"
    ],
    "risk": "read",
    "description": "查询用户 / 会议室闲忙状态（--users 与 --rooms 至少其一）"
  },
  "calendar.get": {
    "service": "calendar",
    "command": [
      "+get"
    ],
    "risk": "read",
    "description": "严格获取日程详情"
  },
  "calendar.invite": {
    "service": "calendar",
    "command": [
      "+invite"
    ],
    "risk": "write",
    "description": "按姓名把参会人加入已有日程（自动解析 userId 后批量添加）"
  },
  "calendar.my-free": {
    "service": "calendar",
    "command": [
      "+my-free"
    ],
    "risk": "read",
    "description": "查我自己在某时间段的忙闲（默认今天，无需输入姓名）"
  },
  "calendar.next-event": {
    "service": "calendar",
    "command": [
      "+next-event"
    ],
    "risk": "read",
    "description": "查看接下来最近的一个日程（默认扫描未来 7 天）"
  },
  "calendar.reschedule": {
    "service": "calendar",
    "command": [
      "+reschedule"
    ],
    "risk": "write",
    "description": "改一个已有日程的时间（只动开始/结束时间，其他字段不变）"
  },
  "calendar.room-find": {
    "service": "calendar",
    "command": [
      "+room-find"
    ],
    "risk": "read",
    "description": "按时间段搜索可用会议室（不传时间默认当前起 1 小时）"
  },
  "calendar.room-groups": {
    "service": "calendar",
    "command": [
      "+room-groups"
    ],
    "risk": "read",
    "description": "会议室分组列表"
  },
  "calendar.room-search": {
    "service": "calendar",
    "command": [
      "+room-search"
    ],
    "risk": "read",
    "description": "按名称模糊搜索会议室（不检查可用性）"
  },
  "calendar.room.add": {
    "service": "calendar",
    "command": [
      "room",
      "add"
    ],
    "risk": "write",
    "description": "calendar.room.add"
  },
  "calendar.room.delete": {
    "service": "calendar",
    "command": [
      "room",
      "delete"
    ],
    "risk": "write",
    "description": "calendar.room.delete"
  },
  "calendar.room.search": {
    "service": "calendar",
    "command": [
      "room",
      "search"
    ],
    "risk": "read",
    "description": "calendar.room.search"
  },
  "calendar.rsvp": {
    "service": "calendar",
    "command": [
      "+rsvp"
    ],
    "risk": "write",
    "description": "响应日程邀请并读取终态"
  },
  "calendar.search-event": {
    "service": "calendar",
    "command": [
      "+search-event"
    ],
    "risk": "read",
    "description": "在一个日程页内严格搜索事件"
  },
  "calendar.suggest-time": {
    "service": "calendar",
    "command": [
      "+suggest-time"
    ],
    "risk": "read",
    "description": "按姓名解析多位参与者，推荐大家都有空的可开会时间段（自动解析 userId）"
  },
  "calendar.suggestion": {
    "service": "calendar",
    "command": [
      "+suggestion"
    ],
    "risk": "read",
    "description": "按 userId 严格推荐共同空闲时间"
  },
  "calendar.today": {
    "service": "calendar",
    "command": [
      "+today"
    ],
    "risk": "read",
    "description": "列出我今天的日程（自动计算今天的起止时间，无需手动填时间范围）"
  },
  "calendar.tomorrow": {
    "service": "calendar",
    "command": [
      "+tomorrow"
    ],
    "risk": "read",
    "description": "列出我明天的日程（自动计算明天的起止时间，无需手动填时间范围）"
  },
  "calendar.update": {
    "service": "calendar",
    "command": [
      "+update"
    ],
    "risk": "write",
    "description": "分阶段更新日程并读回验证"
  },
  "calendar.week": {
    "service": "calendar",
    "command": [
      "+week"
    ],
    "risk": "read",
    "description": "列出我本周的日程（自动按周一为周首计算本周起止时间，无需手动填时间范围）"
  },
  "chat.at-me": {
    "service": "chat",
    "command": [
      "+at-me"
    ],
    "risk": "read",
    "description": "查最近 @我 的消息（自动算时间窗，投影发送人/时间/内容/会话）"
  },
  "chat.bot-find": {
    "service": "chat",
    "command": [
      "+bot-find"
    ],
    "risk": "read",
    "description": "搜索全部可用机器人（含他人/官方，返回 openDingTalkId 可发单聊）"
  },
  "chat.bot-search": {
    "service": "chat",
    "command": [
      "+bot-search"
    ],
    "risk": "read",
    "description": "搜索当前用户自己创建的机器人"
  },
  "chat.broadcast": {
    "service": "chat",
    "command": [
      "+broadcast"
    ],
    "risk": "write",
    "description": "按姓名逐一给多个人群发同一条单聊消息（自动解析 userId、逐个发送）"
  },
  "chat.category-add-conversation": {
    "service": "chat",
    "command": [
      "+category-add-conversation"
    ],
    "risk": "write",
    "description": "将会话移动到指定的自定义分组中"
  },
  "chat.category-create": {
    "service": "chat",
    "command": [
      "+category-create"
    ],
    "risk": "write",
    "description": "创建用户自定义会话分组"
  },
  "chat.category-delete": {
    "service": "chat",
    "command": [
      "+category-delete"
    ],
    "risk": "high",
    "description": "删除用户自定义会话分组"
  },
  "chat.category-list": {
    "service": "chat",
    "command": [
      "+category-list"
    ],
    "risk": "read",
    "description": "获取用户自定义会话分组"
  },
  "chat.category-list-conversations": {
    "service": "chat",
    "command": [
      "+category-list-conversations"
    ],
    "risk": "read",
    "description": "按稳定 categoryId 列出会话分组中的会话"
  },
  "chat.category-remove-conversation": {
    "service": "chat",
    "command": [
      "+category-remove-conversation"
    ],
    "risk": "write",
    "description": "将会话从指定的自定义分组中移出"
  },
  "chat.category-rename": {
    "service": "chat",
    "command": [
      "+category-rename"
    ],
    "risk": "write",
    "description": "更新用户自定义会话分组的名称"
  },
  "chat.chat-add-bot": {
    "service": "chat",
    "command": [
      "+chat-add-bot"
    ],
    "risk": "write",
    "description": "将机器人添加到群中"
  },
  "chat.chat-audit-join": {
    "service": "chat",
    "command": [
      "+chat-audit-join"
    ],
    "risk": "write",
    "description": "审批入群验证（通过/拒绝/删除/忽略/拉黑）"
  },
  "chat.chat-bots": {
    "service": "chat",
    "command": [
      "+chat-bots"
    ],
    "risk": "read",
    "description": "查看群内所有机器人"
  },
  "chat.chat-create": {
    "service": "chat",
    "command": [
      "+chat-create"
    ],
    "risk": "write",
    "description": "按成员和可选群主全量预检后创建一个钉钉群聊"
  },
  "chat.chat-dismiss": {
    "service": "chat",
    "command": [
      "+chat-dismiss"
    ],
    "risk": "high",
    "description": "解散群聊（不可逆，需群主权限）"
  },
  "chat.chat-get-by-id": {
    "service": "chat",
    "command": [
      "+chat-get-by-id"
    ],
    "risk": "read",
    "description": "根据群号获取群聊信息"
  },
  "chat.chat-invite-url": {
    "service": "chat",
    "command": [
      "+chat-invite-url"
    ],
    "risk": "read",
    "description": "获取群邀请链接"
  },
  "chat.chat-list": {
    "service": "chat",
    "command": [
      "+chat-list"
    ],
    "risk": "read",
    "description": "分页列出当前用户加入的会话（默认群聊；可选包含单聊）"
  },
  "chat.chat-list-all": {
    "service": "chat",
    "command": [
      "+chat-list-all"
    ],
    "risk": "read",
    "description": "分页拉取我加入的所有群列表"
  },
  "chat.chat-list-join-requests": {
    "service": "chat",
    "command": [
      "+chat-list-join-requests"
    ],
    "risk": "read",
    "description": "分页拉取入群验证记录"
  },
  "chat.chat-list-mine": {
    "service": "chat",
    "command": [
      "+chat-list-mine"
    ],
    "risk": "read",
    "description": "拉取我创建/管理的群"
  },
  "chat.chat-members-get": {
    "service": "chat",
    "command": [
      "+chat-members-get"
    ],
    "risk": "read",
    "description": "根据成员 openDingTalkId 批量查询群成员详情"
  },
  "chat.chat-members-list": {
    "service": "chat",
    "command": [
      "+chat-members-list"
    ],
    "risk": "read",
    "description": "列出群成员并把用户与机器人分桶（支持群名语义解析）"
  },
  "chat.chat-messages": {
    "service": "chat",
    "command": [
      "+chat-messages"
    ],
    "risk": "read",
    "description": "读取指定群聊或单聊的消息记录，支持有界全量分页与原子 JSON 导出"
  },
  "chat.chat-mute": {
    "service": "chat",
    "command": [
      "+chat-mute"
    ],
    "risk": "write",
    "description": "全员禁言 / 取消全员禁言"
  },
  "chat.chat-mute-member": {
    "service": "chat",
    "command": [
      "+chat-mute-member"
    ],
    "risk": "write",
    "description": "指定群成员禁言 / 取消禁言"
  },
  "chat.chat-quit": {
    "service": "chat",
    "command": [
      "+chat-quit"
    ],
    "risk": "write",
    "description": "退出群聊"
  },
  "chat.chat-remove-bot": {
    "service": "chat",
    "command": [
      "+chat-remove-bot"
    ],
    "risk": "high",
    "description": "从群内移除机器人"
  },
  "chat.chat-role-add": {
    "service": "chat",
    "command": [
      "+chat-role-add"
    ],
    "risk": "write",
    "description": "添加群身份"
  },
  "chat.chat-role-list": {
    "service": "chat",
    "command": [
      "+chat-role-list"
    ],
    "risk": "read",
    "description": "拉取会话的群身份列表"
  },
  "chat.chat-role-query-user": {
    "service": "chat",
    "command": [
      "+chat-role-query-user"
    ],
    "risk": "read",
    "description": "查询群成员的群身份"
  },
  "chat.chat-role-remove": {
    "service": "chat",
    "command": [
      "+chat-role-remove"
    ],
    "risk": "high",
    "description": "删除群身份"
  },
  "chat.chat-role-remove-user": {
    "service": "chat",
    "command": [
      "+chat-role-remove-user"
    ],
    "risk": "write",
    "description": "移除用户的指定群身份"
  },
  "chat.chat-role-set-user": {
    "service": "chat",
    "command": [
      "+chat-role-set-user"
    ],
    "risk": "write",
    "description": "设置用户的群身份（覆盖该用户的全部群身份）"
  },
  "chat.chat-role-update": {
    "service": "chat",
    "command": [
      "+chat-role-update"
    ],
    "risk": "write",
    "description": "更新群身份名称"
  },
  "chat.chat-search": {
    "service": "chat",
    "command": [
      "+chat-search"
    ],
    "risk": "read",
    "description": "按关键词分页搜索群聊，支持有界自动翻页和完整性检查"
  },
  "chat.chat-set-admin": {
    "service": "chat",
    "command": [
      "+chat-set-admin"
    ],
    "risk": "write",
    "description": "设置 / 取消群管理员"
  },
  "chat.chat-set-history": {
    "service": "chat",
    "command": [
      "+chat-set-history"
    ],
    "risk": "write",
    "description": "设置新成员入群可查看历史消息范围"
  },
  "chat.chat-transfer-owner": {
    "service": "chat",
    "command": [
      "+chat-transfer-owner"
    ],
    "risk": "write",
    "description": "转让群主"
  },
  "chat.chat-update": {
    "service": "chat",
    "command": [
      "+chat-update"
    ],
    "risk": "write",
    "description": "更新群名称（仅名称，不支持 description）"
  },
  "chat.chat-update-alias": {
    "service": "chat",
    "command": [
      "+chat-update-alias"
    ],
    "risk": "write",
    "description": "设置群备注（仅自己可见）"
  },
  "chat.chat-update-icon": {
    "service": "chat",
    "command": [
      "+chat-update-icon"
    ],
    "risk": "write",
    "description": "更新群头像"
  },
  "chat.chat-update-nick": {
    "service": "chat",
    "command": [
      "+chat-update-nick"
    ],
    "risk": "write",
    "description": "设置当前用户在群内的群昵称"
  },
  "chat.chat-update-settings": {
    "service": "chat",
    "command": [
      "+chat-update-settings"
    ],
    "risk": "write",
    "description": "更新群设置（settingKey + status）"
  },
  "chat.conversation-clear-all-red-point": {
    "service": "chat",
    "command": [
      "+conversation-clear-all-red-point"
    ],
    "risk": "write",
    "description": "清除所有会话红点（全部已读）"
  },
  "chat.conversation-clear-messages": {
    "service": "chat",
    "command": [
      "+conversation-clear-messages"
    ],
    "risk": "high",
    "description": "清空当前用户指定会话的聊天记录（仅本人视角，不可逆）"
  },
  "chat.conversation-clear-red-point": {
    "service": "chat",
    "command": [
      "+conversation-clear-red-point"
    ],
    "risk": "write",
    "description": "清除会话红点"
  },
  "chat.conversation-hide": {
    "service": "chat",
    "command": [
      "+conversation-hide"
    ],
    "risk": "write",
    "description": "会话列表中隐藏会话（收到新消息会重新出现）"
  },
  "chat.conversation-info": {
    "service": "chat",
    "command": [
      "+conversation-info"
    ],
    "risk": "read",
    "description": "获取会话信息（群聊传 --group，单聊传 --open-dingtalk-id）"
  },
  "chat.conversation-list": {
    "service": "chat",
    "command": [
      "+conversation-list"
    ],
    "risk": "read",
    "description": "分页或一键全量获取当前用户的会话列表（单聊+群聊）"
  },
  "chat.conversation-list-top": {
    "service": "chat",
    "command": [
      "+conversation-list-top"
    ],
    "risk": "read",
    "description": "拉取置顶会话列表，可只看群聊或单聊"
  },
  "chat.conversation-mark-read": {
    "service": "chat",
    "command": [
      "+conversation-mark-read"
    ],
    "risk": "write",
    "description": "标记消息已读（该消息及之前的消息都标记为已读）"
  },
  "chat.conversation-mark-unread": {
    "service": "chat",
    "command": [
      "+conversation-mark-unread"
    ],
    "risk": "write",
    "description": "标记会话为未读"
  },
  "chat.conversation-mute": {
    "service": "chat",
    "command": [
      "+conversation-mute"
    ],
    "risk": "write",
    "description": "会话消息免打扰（支持单聊/群聊）"
  },
  "chat.conversation-set-top": {
    "service": "chat",
    "command": [
      "+conversation-set-top"
    ],
    "risk": "write",
    "description": "批量会话置顶 / 取消置顶（最多 10 个）"
  },
  "chat.dm": {
    "service": "chat",
    "command": [
      "+dm"
    ],
    "risk": "write",
    "description": "按姓名直接给某人发单聊消息（自动解析唯一 openDingTalkId）"
  },
  "chat.feed-group-query-item": {
    "service": "chat",
    "command": [
      "+feed-group-query-item"
    ],
    "risk": "read",
    "description": "在会话分组结果中按会话 ID 精确查询多项"
  },
  "chat.feed-shortcut-create": {
    "service": "chat",
    "command": [
      "+feed-shortcut-create"
    ],
    "risk": "write",
    "description": "置顶指定会话（固定设置置顶；不支持 head/tail 顺序）"
  },
  "chat.feed-shortcut-remove": {
    "service": "chat",
    "command": [
      "+feed-shortcut-remove"
    ],
    "risk": "write",
    "description": "取消指定会话置顶（固定取消，不需要 --off）"
  },
  "chat.flag-cancel": {
    "service": "chat",
    "command": [
      "+flag-cancel"
    ],
    "risk": "write",
    "description": "取消收藏一条或多条消息（最多 10 条）"
  },
  "chat.flag-create": {
    "service": "chat",
    "command": [
      "+flag-create"
    ],
    "risk": "write",
    "description": "收藏一条或多条消息（最多 10 条）"
  },
  "chat.flag-list": {
    "service": "chat",
    "command": [
      "+flag-list"
    ],
    "risk": "read",
    "description": "分页查询当前用户收藏的消息，支持有界自动翻页"
  },
  "chat.group-members": {
    "service": "chat",
    "command": [
      "+group-members"
    ],
    "risk": "read",
    "description": "按群名唯一解析后全量列出用户成员并公开分页完整性"
  },
  "chat.messages-add-emoji": {
    "service": "chat",
    "command": [
      "+messages-add-emoji"
    ],
    "risk": "write",
    "description": "对消息添加 emoji 表情回应"
  },
  "chat.messages-add-text-emotion": {
    "service": "chat",
    "command": [
      "+messages-add-text-emotion"
    ],
    "risk": "write",
    "description": "对消息添加文字表情回应"
  },
  "chat.messages-batch-recall-by-bot": {
    "service": "chat",
    "command": [
      "+messages-batch-recall-by-bot"
    ],
    "risk": "write",
    "description": "机器人撤回单聊消息"
  },
  "chat.messages-batch-send-by-bot": {
    "service": "chat",
    "command": [
      "+messages-batch-send-by-bot"
    ],
    "risk": "write",
    "description": "机器人批量向用户发送单聊 Markdown 消息"
  },
  "chat.messages-combine-forward": {
    "service": "chat",
    "command": [
      "+messages-combine-forward"
    ],
    "risk": "write",
    "description": "合并转发多条消息"
  },
  "chat.messages-create-text-emotion": {
    "service": "chat",
    "command": [
      "+messages-create-text-emotion"
    ],
    "risk": "write",
    "description": "创建文字表情（获取 emotionId）"
  },
  "chat.messages-edit": {
    "service": "chat",
    "command": [
      "+messages-edit"
    ],
    "risk": "write",
    "description": "编辑当前用户自己的 Markdown 消息（不支持 Bot 普通消息编辑）"
  },
  "chat.messages-forward": {
    "service": "chat",
    "command": [
      "+messages-forward"
    ],
    "risk": "write",
    "description": "转发单条消息"
  },
  "chat.messages-forward-topic": {
    "service": "chat",
    "command": [
      "+messages-forward-topic"
    ],
    "risk": "write",
    "description": "转发话题消息到目标会话"
  },
  "chat.messages-list": {
    "service": "chat",
    "command": [
      "+messages-list"
    ],
    "risk": "read",
    "description": "拉取群聊会话消息"
  },
  "chat.messages-list-direct": {
    "service": "chat",
    "command": [
      "+messages-list-direct"
    ],
    "risk": "read",
    "description": "拉取单聊会话消息"
  },
  "chat.messages-list-pin": {
    "service": "chat",
    "command": [
      "+messages-list-pin"
    ],
    "risk": "read",
    "description": "拉取会话中钉住的消息列表"
  },
  "chat.messages-list-unread-conversations": {
    "service": "chat",
    "command": [
      "+messages-list-unread-conversations"
    ],
    "risk": "read",
    "description": "获取有未读消息的会话列表"
  },
  "chat.messages-mget": {
    "service": "chat",
    "command": [
      "+messages-mget"
    ],
    "risk": "read",
    "description": "根据消息 ID 批量查询消息（最多 50 条）"
  },
  "chat.messages-query-send-status": {
    "service": "chat",
    "command": [
      "+messages-query-send-status"
    ],
    "risk": "read",
    "description": "查询消息投递状态并衔接后续消息操作"
  },
  "chat.messages-read-status": {
    "service": "chat",
    "command": [
      "+messages-read-status"
    ],
    "risk": "read",
    "description": "查询消息的已读/未读状态"
  },
  "chat.messages-recall": {
    "service": "chat",
    "command": [
      "+messages-recall"
    ],
    "risk": "write",
    "description": "撤回当前用户发送的消息"
  },
  "chat.messages-recall-by-bot": {
    "service": "chat",
    "command": [
      "+messages-recall-by-bot"
    ],
    "risk": "write",
    "description": "机器人撤回群消息"
  },
  "chat.messages-remove-emoji": {
    "service": "chat",
    "command": [
      "+messages-remove-emoji"
    ],
    "risk": "write",
    "description": "移除消息的 emoji 表情回应"
  },
  "chat.messages-remove-text-emotion": {
    "service": "chat",
    "command": [
      "+messages-remove-text-emotion"
    ],
    "risk": "write",
    "description": "移除消息的文字表情回应"
  },
  "chat.messages-reply": {
    "service": "chat",
    "command": [
      "+messages-reply"
    ],
    "risk": "write",
    "description": "统一回复已有消息：个人群/单聊引用、个人 Thread 追加、Bot 群引用"
  },
  "chat.messages-resource-download": {
    "service": "chat",
    "command": [
      "+messages-resource-download"
    ],
    "risk": "read",
    "description": "安全下载消息资源（图片/视频/语音/文件）到本地"
  },
  "chat.messages-resource-url": {
    "service": "chat",
    "command": [
      "+messages-resource-url"
    ],
    "risk": "read",
    "description": "获取消息资源（图片/视频/语音）下载链接"
  },
  "chat.messages-send": {
    "service": "chat",
    "command": [
      "+messages-send"
    ],
    "risk": "write",
    "description": "按身份和目标统一发送消息，Bot 多群返回逐目标 ledger"
  },
  "chat.messages-send-by-bot": {
    "service": "chat",
    "command": [
      "+messages-send-by-bot"
    ],
    "risk": "write",
    "description": "机器人向群聊发送 Markdown 消息"
  },
  "chat.messages-send-by-webhook": {
    "service": "chat",
    "command": [
      "+messages-send-by-webhook"
    ],
    "risk": "write",
    "description": "兼容旧入口的自定义机器人 Webhook 群消息发送"
  },
  "chat.messages-send-card": {
    "service": "chat",
    "command": [
      "+messages-send-card"
    ],
    "risk": "write",
    "description": "创建流式卡片，可在同一次调用中写入内容并结束；群聊创建时可 @成员或 @所有人"
  },
  "chat.messages-set-pin": {
    "service": "chat",
    "command": [
      "+messages-set-pin"
    ],
    "risk": "write",
    "description": "钉住消息（Pin）"
  },
  "chat.messages-set-top": {
    "service": "chat",
    "command": [
      "+messages-set-top"
    ],
    "risk": "write",
    "description": "置顶消息"
  },
  "chat.messages-unset-pin": {
    "service": "chat",
    "command": [
      "+messages-unset-pin"
    ],
    "risk": "write",
    "description": "取消钉住消息（Unpin）"
  },
  "chat.messages-unset-top": {
    "service": "chat",
    "command": [
      "+messages-unset-top"
    ],
    "risk": "write",
    "description": "取消置顶消息"
  },
  "chat.messages-update-card": {
    "service": "chat",
    "command": [
      "+messages-update-card"
    ],
    "risk": "write",
    "description": "流式更新卡片内容（最后一次 --flow-status 应为 3）"
  },
  "chat.my-groups": {
    "service": "chat",
    "command": [
      "+my-groups"
    ],
    "risk": "read",
    "description": "列出我加入的群，可按类型过滤并投影关键字段"
  },
  "chat.recent-conversations": {
    "service": "chat",
    "command": [
      "+recent-conversations"
    ],
    "risk": "read",
    "description": "列出指定时间以来有新消息的单聊和群聊"
  },
  "chat.search-msg": {
    "service": "chat",
    "command": [
      "+search-msg"
    ],
    "risk": "read",
    "description": "按稳定 ID、内容、时间等条件搜索消息，可校验会话范围、全量翻页并批量富化"
  },
  "chat.send-to-group": {
    "service": "chat",
    "command": [
      "+send-to-group"
    ],
    "risk": "write",
    "description": "按群名或 openConversationId 直接给群发消息"
  },
  "chat.thread-replies": {
    "service": "chat",
    "command": [
      "+thread-replies"
    ],
    "risk": "read",
    "description": "按主消息 ID 或 thread/topic ID 分页读取话题回复，支持完整排序与有界自动翻页"
  },
  "chat.unread-chats": {
    "service": "chat",
    "command": [
      "+unread-chats"
    ],
    "risk": "read",
    "description": "列出我有未读消息的会话（投影会话名/未读数/会话ID）"
  },
  "contact.by-mobile": {
    "service": "contact",
    "command": [
      "+by-mobile"
    ],
    "risk": "read",
    "description": "按手机号查询某人的完整资料（自动解析 userId 后取详情）"
  },
  "contact.dept-members": {
    "service": "contact",
    "command": [
      "+dept-members"
    ],
    "risk": "read",
    "description": "按部门名列出部门成员（自动解析 deptId）"
  },
  "contact.dept.get-info": {
    "service": "contact",
    "command": [
      "dept",
      "get-info"
    ],
    "risk": "read",
    "description": "contact.dept.get-info"
  },
  "contact.dept.list-children": {
    "service": "contact",
    "command": [
      "dept",
      "list-children"
    ],
    "risk": "read",
    "description": "contact.dept.list-children"
  },
  "contact.dept.list-members": {
    "service": "contact",
    "command": [
      "dept",
      "list-members"
    ],
    "risk": "read",
    "description": "contact.dept.list-members"
  },
  "contact.dept.search": {
    "service": "contact",
    "command": [
      "dept",
      "search"
    ],
    "risk": "read",
    "description": "contact.dept.search"
  },
  "contact.label.get": {
    "service": "contact",
    "command": [
      "label",
      "get"
    ],
    "risk": "read",
    "description": "contact.label.get"
  },
  "contact.label.list": {
    "service": "contact",
    "command": [
      "label",
      "list"
    ],
    "risk": "read",
    "description": "contact.label.list"
  },
  "contact.label.list-members": {
    "service": "contact",
    "command": [
      "label",
      "list-members"
    ],
    "risk": "read",
    "description": "contact.label.list-members"
  },
  "contact.list-dept-members": {
    "service": "contact",
    "command": [
      "+list-dept-members"
    ],
    "risk": "read",
    "description": "查看部门成员（仅本部门，不含下级）"
  },
  "contact.list-followings": {
    "service": "contact",
    "command": [
      "+list-followings"
    ],
    "risk": "read",
    "description": "获取当前用户的特别关注列表"
  },
  "contact.list-role-members": {
    "service": "contact",
    "command": [
      "+list-role-members"
    ],
    "risk": "read",
    "description": "查询角色下的成员列表"
  },
  "contact.list-sub-depts": {
    "service": "contact",
    "command": [
      "+list-sub-depts"
    ],
    "risk": "read",
    "description": "查看指定部门的子部门"
  },
  "contact.lookup": {
    "service": "contact",
    "command": [
      "+lookup"
    ],
    "risk": "read",
    "description": "按姓名查询某人的完整资料（自动解析 userId 后取详情）"
  },
  "contact.me": {
    "service": "contact",
    "command": [
      "+me"
    ],
    "risk": "read",
    "description": "查看我自己的通讯录资料（姓名/userId/手机/部门/组织，干净投影）"
  },
  "contact.org": {
    "service": "contact",
    "command": [
      "+org"
    ],
    "risk": "read",
    "description": "按姓名查某人所在部门的详情（自动解析 userId 与 deptId）"
  },
  "contact.resolve-dept": {
    "service": "contact",
    "command": [
      "+resolve-dept"
    ],
    "risk": "read",
    "description": "按名称搜索部门并解析出唯一 deptId（只读）"
  },
  "contact.search-mobile": {
    "service": "contact",
    "command": [
      "+search-mobile"
    ],
    "risk": "read",
    "description": "按手机号搜索通讯录用户"
  },
  "contact.search-user": {
    "service": "contact",
    "command": [
      "+search-user"
    ],
    "risk": "read",
    "description": "按关键词搜索通讯录用户"
  },
  "contact.team": {
    "service": "contact",
    "command": [
      "+team"
    ],
    "risk": "read",
    "description": "按姓名列出某人所在部门的成员（自动解析 userId 与 deptId）"
  },
  "contact.user.get": {
    "service": "contact",
    "command": [
      "user",
      "get"
    ],
    "risk": "read",
    "description": "contact.user.get"
  },
  "contact.user.get-self": {
    "service": "contact",
    "command": [
      "user",
      "get-self"
    ],
    "risk": "read",
    "description": "contact.user.get-self"
  },
  "contact.user.search-mobile": {
    "service": "contact",
    "command": [
      "user",
      "search-mobile"
    ],
    "risk": "read",
    "description": "contact.user.search-mobile"
  },
  "doc.access-change": {
    "service": "doc",
    "command": [
      "+access-change"
    ],
    "risk": "write",
    "description": "预检已有协作者后变更文档角色"
  },
  "doc.access-grant": {
    "service": "doc",
    "command": [
      "+access-grant"
    ],
    "risk": "write",
    "description": "按姓名解析后批量授予文档权限"
  },
  "doc.access-revoke": {
    "service": "doc",
    "command": [
      "+access-revoke"
    ],
    "risk": "high",
    "description": "预检并移除指定协作者的文档权限"
  },
  "doc.background-delete": {
    "service": "doc",
    "command": [
      "+background-delete"
    ],
    "risk": "write",
    "description": "清除文档背景色"
  },
  "doc.background-update": {
    "service": "doc",
    "command": [
      "+background-update"
    ],
    "risk": "write",
    "description": "设置文档 #RRGGBB 背景纯色"
  },
  "doc.checkpoint-update": {
    "service": "doc",
    "command": [
      "+checkpoint-update"
    ],
    "risk": "write",
    "description": "先保存可回滚版本，再更新并读回验证"
  },
  "doc.comment-create": {
    "service": "doc",
    "command": [
      "+comment-create"
    ],
    "risk": "write",
    "description": "创建全文评论，或按 selection 创建划词评论"
  },
  "doc.comment-delete": {
    "service": "doc",
    "command": [
      "+comment-delete"
    ],
    "risk": "high",
    "description": "永久删除指定文档评论"
  },
  "doc.comment-list": {
    "service": "doc",
    "command": [
      "+comment-list"
    ],
    "risk": "read",
    "description": "查询文档评论列表"
  },
  "doc.comment-reply": {
    "service": "doc",
    "command": [
      "+comment-reply"
    ],
    "risk": "write",
    "description": "回复文档中的一条评论"
  },
  "doc.comment-update": {
    "service": "doc",
    "command": [
      "+comment-update"
    ],
    "risk": "write",
    "description": "更新指定文档评论正文和 mention"
  },
  "doc.copy": {
    "service": "doc",
    "command": [
      "+copy"
    ],
    "risk": "write",
    "description": "复制文档/文件到指定文件夹或知识库"
  },
  "doc.create": {
    "service": "doc",
    "command": [
      "+create"
    ],
    "risk": "write",
    "description": "从 Markdown 或 JSONML 创建在线文字文档"
  },
  "doc.create-from-template": {
    "service": "doc",
    "command": [
      "+create-from-template"
    ],
    "risk": "write",
    "description": "使用已选定的 templateId 创建文档"
  },
  "doc.create-with-media": {
    "service": "doc",
    "command": [
      "+create-with-media"
    ],
    "risk": "write",
    "description": "确认后创建文档并按顺序上传本地图片和附件"
  },
  "doc.doc-append": {
    "service": "doc",
    "command": [
      "+doc-append"
    ],
    "risk": "write",
    "description": "在文档末尾追加一段文本（安全追加，不改动原有内容）"
  },
  "doc.download-overwrite": {
    "service": "doc",
    "command": [
      "+download-overwrite"
    ],
    "risk": "write",
    "description": "确认后下载正文媒体或封面，允许原子替换已有普通文件"
  },
  "doc.export": {
    "service": "doc",
    "command": [
      "+export"
    ],
    "risk": "read",
    "description": "提交、轮询并安全下载在线文档导出文件"
  },
  "doc.export-get": {
    "service": "doc",
    "command": [
      "+export-get"
    ],
    "risk": "read",
    "description": "根据 jobId 查询文档导出任务结果"
  },
  "doc.export-submit": {
    "service": "doc",
    "command": [
      "+export-submit"
    ],
    "risk": "read",
    "description": "提交在线文档导出任务 (docx/markdown/pdf)，返回 jobId"
  },
  "doc.fetch": {
    "service": "doc",
    "command": [
      "+fetch"
    ],
    "risk": "read",
    "description": "读取完整或局部文档内容，并按 detail 控制保真度"
  },
  "doc.find-doc": {
    "service": "doc",
    "command": [
      "+find-doc"
    ],
    "risk": "read",
    "description": "按关键词搜索云文档并投影关键字段（只读）"
  },
  "doc.grant-and-share": {
    "service": "doc",
    "command": [
      "+grant-and-share"
    ],
    "risk": "write",
    "description": "确保目标角色后按姓名逐人发送文档链接"
  },
  "doc.history-list": {
    "service": "doc",
    "command": [
      "+history-list"
    ],
    "risk": "read",
    "description": "兼容入口：分页列出文档历史版本"
  },
  "doc.history-revert": {
    "service": "doc",
    "command": [
      "+history-revert"
    ],
    "risk": "high",
    "description": "兼容入口：预检并回滚文档到指定历史版本"
  },
  "doc.history-save": {
    "service": "doc",
    "command": [
      "+history-save"
    ],
    "risk": "write",
    "description": "兼容入口：手动保存当前文档版本快照"
  },
  "doc.import": {
    "service": "doc",
    "command": [
      "+import"
    ],
    "risk": "write",
    "description": "上传本地文件并等待转换成在线文档对象；白名单外格式自动改走文件上传原样入库"
  },
  "doc.inspect": {
    "service": "doc",
    "command": [
      "+inspect"
    ],
    "risk": "read",
    "description": "聚合文档元信息，并按需附带样式、权限、历史、媒体和评论"
  },
  "doc.list": {
    "service": "doc",
    "command": [
      "+list"
    ],
    "risk": "read",
    "description": "列出文件夹或知识库下的直接子节点"
  },
  "doc.media-download": {
    "service": "doc",
    "command": [
      "+media-download"
    ],
    "risk": "read",
    "description": "安全下载文档正文附件到工作目录"
  },
  "doc.media-insert": {
    "service": "doc",
    "command": [
      "+media-insert"
    ],
    "risk": "write",
    "description": "上传本地图片或文件并插入文档正文"
  },
  "doc.media-list": {
    "service": "doc",
    "command": [
      "+media-list"
    ],
    "risk": "read",
    "description": "列出文档正文中的图片和附件资源"
  },
  "doc.media-preview": {
    "service": "doc",
    "command": [
      "+media-preview"
    ],
    "risk": "read",
    "description": "下载正文媒体到受控临时目录并返回预览路径"
  },
  "doc.media-upload": {
    "service": "doc",
    "command": [
      "+media-upload"
    ],
    "risk": "write",
    "description": "上传同文档可复用媒体并下载校验字节，不插入正文"
  },
  "doc.move": {
    "service": "doc",
    "command": [
      "+move"
    ],
    "risk": "write",
    "description": "移动文档/文件到指定文件夹或知识库"
  },
  "doc.resource-delete": {
    "service": "doc",
    "command": [
      "+resource-delete"
    ],
    "risk": "high",
    "description": "幂等清除文档封面"
  },
  "doc.resource-download": {
    "service": "doc",
    "command": [
      "+resource-download"
    ],
    "risk": "read",
    "description": "读取并安全下载当前文档封面"
  },
  "doc.resource-update": {
    "service": "doc",
    "command": [
      "+resource-update"
    ],
    "risk": "write",
    "description": "从本地图片或 HTTPS URL 设置文档封面"
  },
  "doc.review": {
    "service": "doc",
    "command": [
      "+review"
    ],
    "risk": "read",
    "description": "聚合未解决评论、引用原文和块上下文"
  },
  "doc.script": {
    "service": "doc",
    "command": [
      "+script"
    ],
    "risk": "write",
    "description": "初始化本地文档草稿，或检查Markdown/JSONML结构和字数"
  },
  "doc.search": {
    "service": "doc",
    "command": [
      "+search"
    ],
    "risk": "read",
    "description": "按关键词或过滤条件搜索有权限的文档；默认只读取一页"
  },
  "doc.share": {
    "service": "doc",
    "command": [
      "+share"
    ],
    "risk": "write",
    "description": "按姓名发送文档链接，不改变文档权限"
  },
  "doc.share-doc": {
    "service": "doc",
    "command": [
      "+share-doc"
    ],
    "risk": "write",
    "description": "按姓名把文档链接私信发给某人（自动解析 userId）"
  },
  "doc.template-list": {
    "service": "doc",
    "command": [
      "+template-list"
    ],
    "risk": "read",
    "description": "浏览当前用户可用的 MY/PUBLIC 文档模板；默认只读取一页"
  },
  "doc.template-search": {
    "service": "doc",
    "command": [
      "+template-search"
    ],
    "risk": "read",
    "description": "按名称或关键词检索文档模板"
  },
  "doc.update": {
    "service": "doc",
    "command": [
      "+update"
    ],
    "risk": "write",
    "description": "追加、覆盖或按 block 精确更新文档内容"
  },
  "doc.version-list": {
    "service": "doc",
    "command": [
      "+version-list"
    ],
    "risk": "read",
    "description": "分页列出文档历史版本"
  },
  "doc.version-revert": {
    "service": "doc",
    "command": [
      "+version-revert"
    ],
    "risk": "high",
    "description": "预检并回滚文档到指定历史版本"
  },
  "doc.version-save": {
    "service": "doc",
    "command": [
      "+version-save"
    ],
    "risk": "write",
    "description": "手动保存当前文档版本快照"
  },
  "drive.copy": {
    "service": "drive",
    "command": [
      "+copy"
    ],
    "risk": "write",
    "description": "复制在线文档到指定位置并读回验证"
  },
  "drive.cover": {
    "service": "drive",
    "command": [
      "+cover"
    ],
    "risk": "read",
    "description": "读取节点封面或缩略图地址"
  },
  "drive.create-folder": {
    "service": "drive",
    "command": [
      "+create-folder"
    ],
    "risk": "write",
    "description": "创建钉盘文件夹并读回验证"
  },
  "drive.create-shortcut": {
    "service": "drive",
    "command": [
      "+create-shortcut"
    ],
    "risk": "write",
    "description": "为已有节点创建快捷方式并验证新节点"
  },
  "drive.delete": {
    "service": "drive",
    "command": [
      "+delete"
    ],
    "risk": "high",
    "description": "将已确认节点移入回收站"
  },
  "drive.download": {
    "service": "drive",
    "command": [
      "+download"
    ],
    "risk": "read",
    "description": "安全下载钉盘文件到工作目录"
  },
  "drive.find-file": {
    "service": "drive",
    "command": [
      "+find-file"
    ],
    "risk": "read",
    "description": "按名称关键词搜索钉盘文件并投影关键字段（只读）"
  },
  "drive.info": {
    "service": "drive",
    "command": [
      "+info"
    ],
    "risk": "read",
    "description": "获取钉盘文件/文件夹元数据"
  },
  "drive.inspect": {
    "service": "drive",
    "command": [
      "+inspect"
    ],
    "risk": "read",
    "description": "聚合检查节点元数据及可选统计、公开状态和封面"
  },
  "drive.list": {
    "service": "drive",
    "command": [
      "+list"
    ],
    "risk": "read",
    "description": "严格分页列出钉盘文件和文件夹"
  },
  "drive.move": {
    "service": "drive",
    "command": [
      "+move"
    ],
    "risk": "write",
    "description": "移动文件/文档到指定位置"
  },
  "drive.publish-get": {
    "service": "drive",
    "command": [
      "+publish-get"
    ],
    "risk": "read",
    "description": "查询文件互联网公开状态"
  },
  "drive.publish-unset": {
    "service": "drive",
    "command": [
      "+publish-unset"
    ],
    "risk": "high",
    "description": "关闭文件互联网公开发布"
  },
  "drive.recent": {
    "service": "drive",
    "command": [
      "+recent"
    ],
    "risk": "read",
    "description": "获取最近访问/编辑的文档列表"
  },
  "drive.recycle-list": {
    "service": "drive",
    "command": [
      "+recycle-list"
    ],
    "risk": "read",
    "description": "严格分页列出钉盘回收站"
  },
  "drive.recycle-restore": {
    "service": "drive",
    "command": [
      "+recycle-restore"
    ],
    "risk": "write",
    "description": "恢复已确认的回收站条目并读回节点"
  },
  "drive.rename": {
    "service": "drive",
    "command": [
      "+rename"
    ],
    "risk": "write",
    "description": "重命名文件或文件夹并读回验证"
  },
  "drive.search": {
    "service": "drive",
    "command": [
      "+search"
    ],
    "risk": "read",
    "description": "搜索钉盘文件"
  },
  "drive.search-docs": {
    "service": "drive",
    "command": [
      "+search-docs"
    ],
    "risk": "read",
    "description": "搜索文档空间文档"
  },
  "drive.star-add": {
    "service": "drive",
    "command": [
      "+star-add"
    ],
    "risk": "write",
    "description": "收藏指定节点"
  },
  "drive.star-list": {
    "service": "drive",
    "command": [
      "+star-list"
    ],
    "risk": "read",
    "description": "严格分页列出当前用户收藏"
  },
  "drive.star-remove": {
    "service": "drive",
    "command": [
      "+star-remove"
    ],
    "risk": "write",
    "description": "取消收藏指定节点"
  },
  "drive.stats": {
    "service": "drive",
    "command": [
      "+stats"
    ],
    "risk": "read",
    "description": "读取节点访问和协作统计"
  },
  "drive.upload": {
    "service": "drive",
    "command": [
      "+upload"
    ],
    "risk": "write",
    "description": "从工作目录上传普通文件到钉盘或文档空间并读回验证"
  },
  "drive.version-download": {
    "service": "drive",
    "command": [
      "+version-download"
    ],
    "risk": "read",
    "description": "安全下载普通文件指定历史版本"
  },
  "drive.version-get": {
    "service": "drive",
    "command": [
      "+version-get"
    ],
    "risk": "read",
    "description": "按版本号精确读取普通文件版本元数据"
  },
  "drive.version-history": {
    "service": "drive",
    "command": [
      "+version-history"
    ],
    "risk": "read",
    "description": "严格分页列出普通文件历史版本"
  },
  "drive.version-revert": {
    "service": "drive",
    "command": [
      "+version-revert"
    ],
    "risk": "high",
    "description": "预检并回滚普通文件到指定历史版本"
  },
  "mail.attachment.download": {
    "service": "mail",
    "command": [
      "attachment",
      "download"
    ],
    "risk": "read",
    "description": "mail.attachment.download"
  },
  "mail.attachment.list": {
    "service": "mail",
    "command": [
      "attachment",
      "list"
    ],
    "risk": "read",
    "description": "mail.attachment.list"
  },
  "mail.find-mail-user": {
    "service": "mail",
    "command": [
      "+find-mail-user"
    ],
    "risk": "read",
    "description": "按关键词搜索邮箱联系人并投影列表（姓名/昵称/邮箱/工号等）"
  },
  "mail.folder-list": {
    "service": "mail",
    "command": [
      "+folder-list"
    ],
    "risk": "read",
    "description": "列出顶层文件夹或指定父文件夹下的子文件夹"
  },
  "mail.mailbox.list": {
    "service": "mail",
    "command": [
      "mailbox",
      "list"
    ],
    "risk": "read",
    "description": "mail.mailbox.list"
  },
  "mail.message": {
    "service": "mail",
    "command": [
      "+message"
    ],
    "risk": "read",
    "description": "读取一封邮件的完整正文与附件元数据"
  },
  "mail.message.forward": {
    "service": "mail",
    "command": [
      "message",
      "forward"
    ],
    "risk": "write",
    "description": "mail.message.forward"
  },
  "mail.message.get": {
    "service": "mail",
    "command": [
      "message",
      "get"
    ],
    "risk": "read",
    "description": "mail.message.get"
  },
  "mail.message.list": {
    "service": "mail",
    "command": [
      "message",
      "list"
    ],
    "risk": "read",
    "description": "mail.message.list"
  },
  "mail.message.reply": {
    "service": "mail",
    "command": [
      "message",
      "reply"
    ],
    "risk": "write",
    "description": "mail.message.reply"
  },
  "mail.message.reply-all": {
    "service": "mail",
    "command": [
      "message",
      "reply-all"
    ],
    "risk": "write",
    "description": "mail.message.reply-all"
  },
  "mail.message.search": {
    "service": "mail",
    "command": [
      "message",
      "search"
    ],
    "risk": "read",
    "description": "mail.message.search"
  },
  "mail.message.send": {
    "service": "mail",
    "command": [
      "message",
      "send"
    ],
    "risk": "write",
    "description": "mail.message.send"
  },
  "mail.message.verify": {
    "service": "mail",
    "command": [
      "message",
      "verify"
    ],
    "risk": "read",
    "description": "mail.message.verify"
  },
  "mail.messages": {
    "service": "mail",
    "command": [
      "+messages"
    ],
    "risk": "read",
    "description": "按请求顺序读取多封邮件并逐封验证身份"
  },
  "mail.search-mail": {
    "service": "mail",
    "command": [
      "+search-mail"
    ],
    "risk": "read",
    "description": "按 KQL 关键词搜索邮件并投影列表（主题/发件人/时间/messageId）"
  },
  "mail.thread": {
    "service": "mail",
    "command": [
      "+thread"
    ],
    "risk": "read",
    "description": "读取完整邮件会话并精确验证 conversationId"
  },
  "mail.triage": {
    "service": "mail",
    "command": [
      "+triage"
    ],
    "risk": "read",
    "description": "列出或筛选邮件摘要，自动解析邮箱与收件箱"
  },
  "mail.user-search": {
    "service": "mail",
    "command": [
      "+user-search"
    ],
    "risk": "read",
    "description": "按关键词或工号搜索邮箱用户（仅企业邮箱）"
  },
  "mail.user.search": {
    "service": "mail",
    "command": [
      "user",
      "search"
    ],
    "risk": "read",
    "description": "mail.user.search"
  },
  "minutes.action-items": {
    "service": "minutes",
    "command": [
      "+action-items"
    ],
    "risk": "read",
    "description": "读取指定或我最新一条听记中已抽取的行动项"
  },
  "minutes.apply-permission": {
    "service": "minutes",
    "command": [
      "+apply-permission"
    ],
    "risk": "write",
    "description": "为当前用户申请语义化的听记访问权限"
  },
  "minutes.detail": {
    "service": "minutes",
    "command": [
      "+detail"
    ],
    "risk": "read",
    "description": "批量聚合听记基础信息、摘要、关键词、完整逐字稿和行动项，支持安全文件输出"
  },
  "minutes.download": {
    "service": "minutes",
    "command": [
      "+download"
    ],
    "risk": "read",
    "description": "批量取得听记音视频地址并安全下载到本地"
  },
  "minutes.export-pack": {
    "service": "minutes",
    "command": [
      "+export-pack"
    ],
    "risk": "read",
    "description": "把听记文本产物清理签名凭据后写入受控目录并生成清理台账"
  },
  "minutes.latest": {
    "service": "minutes",
    "command": [
      "+latest"
    ],
    "risk": "read",
    "description": "取我最新的一条妙记（听记）详情"
  },
  "minutes.list-all": {
    "service": "minutes",
    "command": [
      "+list-all"
    ],
    "risk": "read",
    "description": "预览或完整查询我有权限访问的听记列表"
  },
  "minutes.list-mine": {
    "service": "minutes",
    "command": [
      "+list-mine"
    ],
    "risk": "read",
    "description": "查询我创建的听记列表"
  },
  "minutes.list-shared": {
    "service": "minutes",
    "command": [
      "+list-shared"
    ],
    "risk": "read",
    "description": "查询他人共享给我的听记列表"
  },
  "minutes.mindmap": {
    "service": "minutes",
    "command": [
      "+mindmap"
    ],
    "risk": "write",
    "description": "创建听记思维导图并轮询到明确成功、失败或超时"
  },
  "minutes.prepare-asr": {
    "service": "minutes",
    "command": [
      "+prepare-asr"
    ],
    "risk": "write",
    "description": "读取个人热词、只新增缺失项并读回验证"
  },
  "minutes.record-pause": {
    "service": "minutes",
    "command": [
      "+record-pause"
    ],
    "risk": "write",
    "description": "暂停听记录音"
  },
  "minutes.record-resume": {
    "service": "minutes",
    "command": [
      "+record-resume"
    ],
    "risk": "write",
    "description": "恢复听记录音"
  },
  "minutes.record-start": {
    "service": "minutes",
    "command": [
      "+record-start"
    ],
    "risk": "write",
    "description": "发起听记（开始录音）"
  },
  "minutes.record-stop": {
    "service": "minutes",
    "command": [
      "+record-stop"
    ],
    "risk": "write",
    "description": "结束听记录音"
  },
  "minutes.record-wrap-up": {
    "service": "minutes",
    "command": [
      "+record-wrap-up"
    ],
    "risk": "write",
    "description": "停止实时录音并有界等待听记产物，失败时保留恢复句柄"
  },
  "minutes.replace-batch": {
    "service": "minutes",
    "command": [
      "+replace-batch"
    ],
    "risk": "write",
    "description": "预检并批量执行多组听记文字替换，逐项验证且失败必定非零"
  },
  "minutes.search": {
    "service": "minutes",
    "command": [
      "+search"
    ],
    "risk": "read",
    "description": "按范围、标题关键词和时间搜索听记，支持安全全量翻页"
  },
  "minutes.share": {
    "service": "minutes",
    "command": [
      "+share"
    ],
    "risk": "write",
    "description": "按成员逐项授予一个或多个听记权限，输出可审计的部分写入 ledger"
  },
  "minutes.speaker-insights": {
    "service": "minutes",
    "command": [
      "+speaker-insights"
    ],
    "risk": "write",
    "description": "创建发言人段落总结并轮询结果，保留异步任务恢复句柄"
  },
  "minutes.speaker-replace": {
    "service": "minutes",
    "command": [
      "+speaker-replace"
    ],
    "risk": "write",
    "description": "预检逐字稿中的发言人昵称，替换后重新读回验证"
  },
  "minutes.summary": {
    "service": "minutes",
    "command": [
      "+summary"
    ],
    "risk": "write",
    "description": "读取当前纪要、校验图片引用、全量覆盖并读回验证"
  },
  "minutes.sync-asr": {
    "service": "minutes",
    "command": [
      "+sync-asr"
    ],
    "risk": "high",
    "description": "把个人热词精确同步为目标集合，删除多余项后读回验证"
  },
  "minutes.transcript": {
    "service": "minutes",
    "command": [
      "+transcript"
    ],
    "risk": "read",
    "description": "读取指定或我最新一条听记的完整逐字稿，并交付分页完整性证据"
  },
  "minutes.unshare": {
    "service": "minutes",
    "command": [
      "+unshare"
    ],
    "risk": "write",
    "description": "按成员逐项移除一个或多个听记权限，输出可审计的部分写入 ledger"
  },
  "minutes.update": {
    "service": "minutes",
    "command": [
      "+update"
    ],
    "risk": "write",
    "description": "读取现状、预览差异、更新听记标题并读回验证"
  },
  "minutes.upload": {
    "service": "minutes",
    "command": [
      "+upload"
    ],
    "risk": "write",
    "description": "把本地音视频完整上传并创建听记，不发送额外消息"
  },
  "minutes.upload-and-analyze": {
    "service": "minutes",
    "command": [
      "+upload-and-analyze"
    ],
    "risk": "write",
    "description": "本地音视频直传听记并等待分析产物，可选思维导图和发言人洞察"
  },
  "minutes.upload-and-notify": {
    "service": "minutes",
    "command": [
      "+upload-and-notify"
    ],
    "risk": "write",
    "description": "上传本地音视频创建听记，并在生成后推送闪记卡片"
  },
  "oa.approval.approve": {
    "service": "oa",
    "command": [
      "approval",
      "approve"
    ],
    "risk": "high",
    "description": "oa.approval.approve"
  },
  "oa.approval.detail": {
    "service": "oa",
    "command": [
      "approval",
      "detail"
    ],
    "risk": "read",
    "description": "oa.approval.detail"
  },
  "oa.approval.form-schema": {
    "service": "oa",
    "command": [
      "approval",
      "form-schema"
    ],
    "risk": "read",
    "description": "oa.approval.form-schema"
  },
  "oa.approval.list-by-admin": {
    "service": "oa",
    "command": [
      "approval",
      "list-by-admin"
    ],
    "risk": "read",
    "description": "oa.approval.list-by-admin"
  },
  "oa.approval.list-cc": {
    "service": "oa",
    "command": [
      "approval",
      "list-cc"
    ],
    "risk": "read",
    "description": "oa.approval.list-cc"
  },
  "oa.approval.list-executed": {
    "service": "oa",
    "command": [
      "approval",
      "list-executed"
    ],
    "risk": "read",
    "description": "oa.approval.list-executed"
  },
  "oa.approval.list-forms": {
    "service": "oa",
    "command": [
      "approval",
      "list-forms"
    ],
    "risk": "read",
    "description": "oa.approval.list-forms"
  },
  "oa.approval.list-initiated": {
    "service": "oa",
    "command": [
      "approval",
      "list-initiated"
    ],
    "risk": "read",
    "description": "oa.approval.list-initiated"
  },
  "oa.approval.list-pending": {
    "service": "oa",
    "command": [
      "approval",
      "list-pending"
    ],
    "risk": "read",
    "description": "oa.approval.list-pending"
  },
  "oa.approval.list-submitted": {
    "service": "oa",
    "command": [
      "approval",
      "list-submitted"
    ],
    "risk": "read",
    "description": "oa.approval.list-submitted"
  },
  "oa.approval.oa-cc-noticer": {
    "service": "oa",
    "command": [
      "approval",
      "oa-cc-noticer"
    ],
    "risk": "write",
    "description": "oa.approval.oa-cc-noticer"
  },
  "oa.approval.oa-comments": {
    "service": "oa",
    "command": [
      "approval",
      "oa-comments"
    ],
    "risk": "write",
    "description": "oa.approval.oa-comments"
  },
  "oa.approval.records": {
    "service": "oa",
    "command": [
      "approval",
      "records"
    ],
    "risk": "read",
    "description": "oa.approval.records"
  },
  "oa.approval.redirect-task": {
    "service": "oa",
    "command": [
      "approval",
      "redirect-task"
    ],
    "risk": "high",
    "description": "oa.approval.redirect-task"
  },
  "oa.approval.reject": {
    "service": "oa",
    "command": [
      "approval",
      "reject"
    ],
    "risk": "high",
    "description": "oa.approval.reject"
  },
  "oa.approval.revoke": {
    "service": "oa",
    "command": [
      "approval",
      "revoke"
    ],
    "risk": "high",
    "description": "oa.approval.revoke"
  },
  "oa.approval.tasks": {
    "service": "oa",
    "command": [
      "approval",
      "tasks"
    ],
    "risk": "read",
    "description": "oa.approval.tasks"
  },
  "oa.search-forms": {
    "service": "oa",
    "command": [
      "+search-forms"
    ],
    "risk": "read",
    "description": "按关键字模糊搜索当前用户可见的审批表单"
  },
  "report.entry.get": {
    "service": "report",
    "command": [
      "entry",
      "get"
    ],
    "risk": "read",
    "description": "report.entry.get"
  },
  "report.entry.stats": {
    "service": "report",
    "command": [
      "entry",
      "stats"
    ],
    "risk": "read",
    "description": "report.entry.stats"
  },
  "report.entry.submit": {
    "service": "report",
    "command": [
      "entry",
      "submit"
    ],
    "risk": "write",
    "description": "report.entry.submit"
  },
  "report.inbox-list": {
    "service": "report",
    "command": [
      "+inbox-list"
    ],
    "risk": "read",
    "description": "列出我收到的日志"
  },
  "report.outbox-list": {
    "service": "report",
    "command": [
      "+outbox-list"
    ],
    "risk": "read",
    "description": "列出我发出的日志"
  },
  "report.report-latest": {
    "service": "report",
    "command": [
      "+report-latest"
    ],
    "risk": "read",
    "description": "读取我最近提交的一篇日志详情"
  },
  "report.template-search": {
    "service": "report",
    "command": [
      "+template-search"
    ],
    "risk": "read",
    "description": "按名称搜索可用日志模板"
  },
  "report.template.get": {
    "service": "report",
    "command": [
      "template",
      "get"
    ],
    "risk": "read",
    "description": "report.template.get"
  },
  "report.template.list": {
    "service": "report",
    "command": [
      "template",
      "list"
    ],
    "risk": "read",
    "description": "report.template.list"
  },
  "sheet.append": {
    "service": "sheet",
    "command": [
      "append"
    ],
    "risk": "write",
    "description": "sheet.append"
  },
  "sheet.create": {
    "service": "sheet",
    "command": [
      "create"
    ],
    "risk": "write",
    "description": "sheet.create"
  },
  "sheet.create-with-data": {
    "service": "sheet",
    "command": [
      "create-with-data"
    ],
    "risk": "write",
    "description": "sheet.create-with-data"
  },
  "sheet.csv-get": {
    "service": "sheet",
    "command": [
      "csv-get"
    ],
    "risk": "read",
    "description": "sheet.csv-get"
  },
  "sheet.csv-put": {
    "service": "sheet",
    "command": [
      "csv-put"
    ],
    "risk": "write",
    "description": "sheet.csv-put"
  },
  "sheet.export": {
    "service": "sheet",
    "command": [
      "export"
    ],
    "risk": "read",
    "description": "sheet.export"
  },
  "sheet.export-csv": {
    "service": "sheet",
    "command": [
      "export-csv"
    ],
    "risk": "read",
    "description": "sheet.export-csv"
  },
  "sheet.import.create": {
    "service": "sheet",
    "command": [
      "import",
      "create"
    ],
    "risk": "write",
    "description": "sheet.import.create"
  },
  "sheet.info": {
    "service": "sheet",
    "command": [
      "info"
    ],
    "risk": "read",
    "description": "sheet.info"
  },
  "sheet.list-sheets": {
    "service": "sheet",
    "command": [
      "+list-sheets"
    ],
    "risk": "read",
    "description": "严格列出在线电子表格的工作表，并可按完整标题精确筛选"
  },
  "sheet.range.update": {
    "service": "sheet",
    "command": [
      "range",
      "update"
    ],
    "risk": "write",
    "description": "sheet.range.update"
  },
  "sheet.read": {
    "service": "sheet",
    "command": [
      "+read"
    ],
    "risk": "read",
    "description": "完整读取并严格校验在线电子表格范围；截断结果失败关闭"
  },
  "todo.assign": {
    "service": "todo",
    "command": [
      "+assign"
    ],
    "risk": "write",
    "description": "按姓名给某人创建并指派一条待办（自动解析 userId）"
  },
  "todo.assign-multi": {
    "service": "todo",
    "command": [
      "+assign-multi"
    ],
    "risk": "write",
    "description": "把一条待办按姓名一次性指派给多个人（自动把每个姓名解析成 userId）"
  },
  "todo.comment": {
    "service": "todo",
    "command": [
      "+comment"
    ],
    "risk": "write",
    "description": "添加待办评论并读回验证"
  },
  "todo.complete": {
    "service": "todo",
    "command": [
      "+complete"
    ],
    "risk": "write",
    "description": "完成待办并读回验证"
  },
  "todo.create": {
    "service": "todo",
    "command": [
      "+create"
    ],
    "risk": "write",
    "description": "创建待办并读回验证"
  },
  "todo.created-todos": {
    "service": "todo",
    "command": [
      "+created-todos"
    ],
    "risk": "read",
    "description": "列出我创建的待办（我作为创建人 creator 发起的待办，而非分配给我执行的）"
  },
  "todo.due-today": {
    "service": "todo",
    "command": [
      "+due-today"
    ],
    "risk": "read",
    "description": "列出我今天到期的待办"
  },
  "todo.get": {
    "service": "todo",
    "command": [
      "+get"
    ],
    "risk": "read",
    "description": "查询待办详情"
  },
  "todo.get-my-tasks": {
    "service": "todo",
    "command": [
      "+get-my-tasks"
    ],
    "risk": "read",
    "description": "查询当前组织下我的待办列表"
  },
  "todo.get-related-tasks": {
    "service": "todo",
    "command": [
      "+get-related-tasks"
    ],
    "risk": "read",
    "description": "一次性列出与我相关的全部待办（我作为创建人/执行人/参与人三种角色的并集，按 taskId 去重）"
  },
  "todo.list-attachment": {
    "service": "todo",
    "command": [
      "+list-attachment"
    ],
    "risk": "read",
    "description": "查询待办任务的附件列表"
  },
  "todo.list-comment": {
    "service": "todo",
    "command": [
      "+list-comment"
    ],
    "risk": "read",
    "description": "查询待办评论列表"
  },
  "todo.list-sub": {
    "service": "todo",
    "command": [
      "+list-sub"
    ],
    "risk": "read",
    "description": "查询子待办列表"
  },
  "todo.overdue": {
    "service": "todo",
    "command": [
      "+overdue"
    ],
    "risk": "read",
    "description": "列出我已过期未完成的待办"
  },
  "todo.remind": {
    "service": "todo",
    "command": [
      "+remind"
    ],
    "risk": "write",
    "description": "给自己创建一条带可选截止时间的待办"
  },
  "todo.reminder": {
    "service": "todo",
    "command": [
      "+reminder"
    ],
    "risk": "write",
    "description": "设置或清除待办提醒（仅终端回执）"
  },
  "todo.reopen": {
    "service": "todo",
    "command": [
      "+reopen"
    ],
    "risk": "write",
    "description": "重新打开待办并读回验证"
  },
  "todo.search": {
    "service": "todo",
    "command": [
      "+search"
    ],
    "risk": "read",
    "description": "搜索与我相关的全部待办"
  },
  "todo.task.create": {
    "service": "todo",
    "command": [
      "task",
      "create"
    ],
    "risk": "write",
    "description": "todo.task.create"
  },
  "todo.task.delete": {
    "service": "todo",
    "command": [
      "task",
      "delete"
    ],
    "risk": "high",
    "description": "todo.task.delete"
  },
  "todo.task.done": {
    "service": "todo",
    "command": [
      "task",
      "done"
    ],
    "risk": "write",
    "description": "todo.task.done"
  },
  "todo.task.get": {
    "service": "todo",
    "command": [
      "task",
      "get"
    ],
    "risk": "read",
    "description": "todo.task.get"
  },
  "todo.task.list": {
    "service": "todo",
    "command": [
      "task",
      "list"
    ],
    "risk": "read",
    "description": "todo.task.list"
  },
  "todo.task.update": {
    "service": "todo",
    "command": [
      "task",
      "update"
    ],
    "risk": "write",
    "description": "todo.task.update"
  },
  "todo.todo-done": {
    "service": "todo",
    "command": [
      "+todo-done"
    ],
    "risk": "write",
    "description": "按标题关键词把我的某条待办标记完成（自动定位 taskId）"
  },
  "todo.update": {
    "service": "todo",
    "command": [
      "+update"
    ],
    "risk": "write",
    "description": "更新待办并读回验证"
  },
  "wiki.delete-space": {
    "service": "wiki",
    "command": [
      "+delete-space"
    ],
    "risk": "high",
    "description": "删除知识库"
  },
  "wiki.feed-list": {
    "service": "wiki",
    "command": [
      "+feed-list"
    ],
    "risk": "read",
    "description": "严格分页列出知识库动态"
  },
  "wiki.member-add": {
    "service": "wiki",
    "command": [
      "+member-add"
    ],
    "risk": "write",
    "description": "添加知识库成员"
  },
  "wiki.member-list": {
    "service": "wiki",
    "command": [
      "+member-list"
    ],
    "risk": "read",
    "description": "严格列出知识库成员"
  },
  "wiki.member-remove": {
    "service": "wiki",
    "command": [
      "+member-remove"
    ],
    "risk": "write",
    "description": "移除知识库成员"
  },
  "wiki.member-update": {
    "service": "wiki",
    "command": [
      "+member-update"
    ],
    "risk": "write",
    "description": "更新知识库成员角色"
  },
  "wiki.move": {
    "service": "wiki",
    "command": [
      "+move"
    ],
    "risk": "write",
    "description": "移动节点到知识库并读回验证"
  },
  "wiki.move-to-drive": {
    "service": "wiki",
    "command": [
      "+move-to-drive"
    ],
    "risk": "write",
    "description": "移动 Wiki 节点到我的文档并验证目标域"
  },
  "wiki.node-copy": {
    "service": "wiki",
    "command": [
      "+node-copy"
    ],
    "risk": "high",
    "description": "复制知识库节点并验证独立副本"
  },
  "wiki.node-create": {
    "service": "wiki",
    "command": [
      "+node-create"
    ],
    "risk": "write",
    "description": "创建知识库节点并严格读回验证"
  },
  "wiki.node-delete": {
    "service": "wiki",
    "command": [
      "+node-delete"
    ],
    "risk": "high",
    "description": "删除知识库节点"
  },
  "wiki.node-get": {
    "service": "wiki",
    "command": [
      "+node-get"
    ],
    "risk": "read",
    "description": "获取知识库节点详情"
  },
  "wiki.node-list": {
    "service": "wiki",
    "command": [
      "+node-list"
    ],
    "risk": "read",
    "description": "严格分页列出知识库节点"
  },
  "wiki.node-search": {
    "service": "wiki",
    "command": [
      "+node-search"
    ],
    "risk": "read",
    "description": "严格分页搜索知识库节点"
  },
  "wiki.resolve-space": {
    "service": "wiki",
    "command": [
      "+resolve-space"
    ],
    "risk": "read",
    "description": "按名称搜索知识空间并解析单次结果中的唯一 spaceId（只读）"
  },
  "wiki.space-create": {
    "service": "wiki",
    "command": [
      "+space-create"
    ],
    "risk": "write",
    "description": "创建知识库并读回验证空间类型"
  },
  "wiki.space-get": {
    "service": "wiki",
    "command": [
      "+space-get"
    ],
    "risk": "read",
    "description": "获取知识库详情"
  },
  "wiki.space-list": {
    "service": "wiki",
    "command": [
      "+space-list"
    ],
    "risk": "read",
    "description": "严格分页列出知识库并保留类型范围证据"
  },
  "wiki.space-search": {
    "service": "wiki",
    "command": [
      "+space-search"
    ],
    "risk": "read",
    "description": "严格搜索知识库"
  },
  "wiki.wiki-new-doc": {
    "service": "wiki",
    "command": [
      "+wiki-new-doc"
    ],
    "risk": "write",
    "description": "在指定名称的知识库下新建一个文档节点（按单次名称搜索解析 workspaceId）"
  }
} as const satisfies Record<string, GeneratedDwsCapability>;
