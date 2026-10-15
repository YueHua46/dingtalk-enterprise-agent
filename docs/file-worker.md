# 文件工作流部署与验证

## 结构

`gateway` 保留钉钉、DWS、紫鸟与上游模型长期凭证。`file-worker` 仅接收任务级输入文件，使用不同 Linux UID 和独立 `CODEX_HOME` 运行每个任务的 Codex App Server。两者通过 Compose 内部网络上的 HTTP（文件传输）及 WebSocket（App Server JSON-RPC）通信。文件容器加入内部 `file-worker-net` 与外网出口 `worker-egress`，不挂载 gateway 媒体目录、业务凭证或 Docker Socket。每个任务的 Codex 可用 shell 和公开互联网；企业业务仍经网关注入的工具执行。

Agent 使用容器内 `documents`、`pdf`、`spreadsheets`、`presentations` 技能和 shell。成果写入 `output`，调用 `artifact.submit`。gateway 重新下载并校验大小、扩展名与文件头、SHA-256、ClamAV 扫描后，使用当前发起人的 DWS profile、配置的 `robotCode` 和 bot 身份，将文件投递到原群或原私聊。每个目标单独发送。投递前写宿主幂等记录；超时或结果未知时不自动重发。

Worker 启用 Codex 原生 `web.run`：`web_search=live`、`features.standalone_web_search=true`、`model_providers.enterprise_proxy.supports_standalone_web_search=true`。网关实现 `POST /internal/model/v1/alpha/search`，将 Codex 的独立搜索请求交给 Gemini 原生 Google Search grounding，并按 Codex 的 `SearchResponse` 格式返回。Worker 不注入 `internet.search` 动态工具，公开联网查询优先走 `web.run`。当前适配器支持搜索、打开公开 HTTPS 网页、查找页内文本和点击已打开页面的链接；图片搜索、PDF 截图、行情、天气、体育和时间命令会明确报告不支持。此方案使用 Codex 原生工具界面和事件，搜索后端仍是 Gemini，不能称为 OpenAI 自家的搜索服务。

`artifact.import_drive` 通过当前用户的 DWS profile 下载钉盘普通文件并导入当前工作区。`artifact.overwrite_drive` 仅处理明确要求覆盖的钉盘普通文件：读取节点及当前版本、显示原会话确认卡，确认后复查版本，调用 `drive +upload --node`，再读回。在线文档使用对应 DWS 文档能力。

群聊经 DWS CLI 测试时，用户文件消息不能同时带 `@`。先在群内发文件，再用 `@` 机器人文本指定该文件；Agent 从原群消息的 `resourceRefs` 取得消息 ID 与 fileId，调用 `artifact.import_chat` 以当前用户身份下载并导入任务工作区。`artifact.submit` 在调用时完成文件校验、病毒扫描和原会话投递，并返回投递证据；宿主收尾时的再次检查由幂等记录拦截。

## 配置和启用

1. 生成至少 32 字符的随机 `FILE_WORKER_SECRET`，放入 Compose 插值环境（项目 `.env` 或启动 Compose 的 shell 环境）；Compose 同时注入 gateway 和 file-worker。仅放进 `AGENT_ENV_FILE` 不会用于 `${FILE_WORKER_SECRET}` 插值。不要把上游模型密钥、DWS 或紫鸟配置注入 file-worker。
2. 设置 `MODEL_TOOL_COMPAT_PROXY=true`。默认 `FILE_WORKER_MODE=all`，全部新任务启用；此模式不再启动普通路径的本地 Codex。`test` 配合 `FILE_WORKER_TEST_SURFACES=group:<openConversationId>,direct:<userId>` 限定验收会话；`off` 走原宿主预提取路径。
3. 先启动 `docker compose up -d --build file-worker`，确认健康后构建并启动 gateway。检查 `/readyz`。不要在旧任务运行或等待澄清时切换该任务的执行模式；先让旧任务完成。回滚同理：完成或明确终止文件任务后切到 `off`。
4. `FILE_WORKER_URL` 在 Compose 中固定为 `http://file-worker:8081`。Worker 的 `WORKER_MODEL_PROXY_URL` 固定指向 gateway 内网地址；worker 仅持有最长 24 小时的任务签名凭证，gateway 代填上游模型密钥。

文件容器使用命名卷 `file-worker-data` 存放每任务目录。默认按 `TASK_RETENTION_DAYS` 保留已结束任务；清理时跳过未结束和正在运行的任务。澄清等待期间保留工作区。宿主审计记录附件和成果哈希、工具事件、投递结果，不保存文件正文。

## 验收

- 在测试群和私聊分别提交 DOCX（表格、图片）、XLSX（多工作表、公式）、PPTX（图表）、文本与扫描 PDF。核对读取答案，要求创建或修改副本，并确认最终附件能重新打开；需视觉检查时确认 Agent 渲染了页面或幻灯片。
- 核对 DWS 发送回执的目标、`robotCode` 与 bot 身份；检查群任务没有改投个人私聊。用未授权用户测试设备授权流程，用模拟超时测试“结果未知后不重发”。
- 钉盘原位更新分别测试确认、拒绝、超时和版本变化。拒绝或超时后不得上传。在线文档不得进入普通文件覆盖流程。
- 同时执行两个文件任务，确认 UID、`CODEX_HOME` 和文件权限隔离；在附件中放入诱导 shell 读取其他任务目录和 gateway 凭证的文本，确认读取失败。测试 App Server 断开后重连同一任务、任务取消和保留期清理。

## 文件格式范围

首批处理 PDF、DOCX、XLSX、PPTX、文本及常见图片。旧版 Office 文件先在工作区用 LibreOffice 转换；转换失败会报告。宏、外部数据连接、SmartArt、动画和复杂版式的保真度不能保证；需要改动此类文件时应明确告知用户。Desktop 的 Windows 私有 `@oai/artifact-tool` 没有复制到 Linux 镜像，Excel 和 PPT 使用 `openpyxl`、`xlsxwriter`、`python-pptx` 与 LibreOffice。

## 按需组合的 HTML/PDF

新分析任务默认简洁聊天；明确要求 PDF 后，在计划登记 `delivery: {format: 'pdf', detail: 'brief'}`（也可 standard/full）。`artifact.render_document` 接收按问题选择和排序的 summary、text、metrics、actions、callout、table、chart 块，由可信 HTML/CSS 和 Chromium 导出。`ops-clean` 只规定字体、颜色、间距与分页，不规定广告章节、国家分支、封面或最低页数。旧 `render_report` 仅兼容历史广告草稿。

宿主从本任务保存的证据解析 `fact_bindings`；表格与图表按来源哈希、行选择器和字段填值。图表只支持来源绑定的 line/bar；需聚合或排序时先计算。缺失保留 null，不替换为零。正文数字观测不能用手抄或建议字段绕过绑定。渲染后保存 HTML 源文件，并从实际 PDF 读取正文、渲染页面 PNG；Agent 检查页面，审核完整内容和证据后才通过 `artifact.submit` 投递。局部修改使用 `revise_document` 与最新 draft_id，旧版或字节被改动的 PDF 无法交付。源文件与预览不自动发送。

为方便运营核验，编译器按事实绑定与表格/图表来源自动生成文档内 `[S1]` 等编号，并附“来源与核验”。来源追溯到保存的实际查询、业务报表、店铺名称与领星 SID、日期、筛选/聚合条件、引用字段及计算口径，不由模型编造。计算结果同时指向其输入来源；Python 只能按代码显式引用的已登记文件关联，并明确不等于已验证的文件读取轨迹。缺失或循环血缘拒绝编译。来源附录不暴露内部证据 UUID、凭据、文件路径或临时下载链接；它只提供核验信息，不规定业务章节或分析顺序。查询分页完整与上游采集完整性必须分别说明，无报表行不能自动解释为零。

本次升级新增固定版本 Playwright 与 Chromium、Linux 依赖及中日德字体，必须完整重建 `Dockerfile.file-worker`；仅使用 `Dockerfile.runtime-update` 不能补齐依赖，其检查会拒绝旧运行时。先构建和验证 worker，再更新 gateway，不能在正在运行的任务中切换运行时。`DOCUMENT_PDF_ENABLED=false` 可暂停新渲染并返回明确错误，不会静默回退旧模板。

浏览器在任务 UID/GID 下运行，开启 Chromium sandbox，禁用页面 JavaScript、网络与外部资源。Compose 保留只读文件系统、任务目录权限与 no-new-privileges，使用 `config/chromium-seccomp.json` 允许沙箱所需的用户命名空间系统调用。该文件源自 Microsoft Playwright `utils/docker/seccomp_profile.json`（2026-10-15 获取，许可证见相邻 LICENSE），额外允许 chroot：Chromium 在自身用户命名空间内使用它，仍须通过内核权限检查；不添加 SYS_ADMIN 或 SYS_CHROOT 容器能力。部署主机必须支持非特权用户命名空间；不支持时渲染报错，不自动关闭沙箱。

渲染并发上限 2，子进程 90 秒超时，内部 80 秒清理；单份最多 40 页、25 MiB，超出需缩减范围或拆分，不静默截断。容器默认 4 GiB / 2 CPU / 512 PID，可用 `FILE_WORKER_MEMORY_LIMIT`、`FILE_WORKER_CPUS`、`FILE_WORKER_PIDS_LIMIT` 调整，`init: true` 回收子进程。

本地构建后可运行 `node scripts/document-pdf-smoke.mjs`，生成合成数据的一页简报和多页长表/图表样例，输出到忽略目录 `output/pdf-smoke`。环境变量 `DOCUMENT_PDF_PYTHON` 指定已安装 PyMuPDF 的 Python；Windows 可显式指定 python.exe。必须检查实际 PDF 的页面图片，不能只检查 HTML 截图。Linux 镜像验收需使用 Compose 同等的 UID、seccomp、只读根目录与资源限制；同时验证拒绝旧哈希文件、失败草稿修正、默认聊天不渲染，以及交付仍回到原会话。

完整构建 worker 后，可在项目根目录运行以下独立验收。脚本在临时目录启动真实 worker，使用合成数据验证 HTTP 鉴权、任务 UID 归属、PDF 导出与读回、页面预览、拒绝原始 HTML 和关闭开关；不调用模型、钉钉或业务系统。验收容器退出后删除。

```powershell
docker compose run --rm --no-deps --entrypoint node --volume "${PWD}/scripts/document-worker-smoke.mjs:/app/scripts/document-worker-smoke.mjs:ro" file-worker scripts/document-worker-smoke.mjs
```

### 运营可读的来源卡片

文档来源根据保存的证据血缘生成，按实际数据提供方命名；已知系统名称翻译不参与路由，未识别来源明确待核实。每项分开展示资料位置、本次筛选、业务计算和核验提醒，计算引用输入来源编号。数据库/API字段、文件路径、凭据及内部证据标识只保留在审计记录。店铺范围与实际有记录的店铺分别说明，缺失记录不计为零。此设计只规范来源展示，不固定报告正文或业务章节。
