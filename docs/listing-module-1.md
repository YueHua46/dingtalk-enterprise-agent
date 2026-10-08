# Listing 模块 1：对话输入与任务定义

本模块仅建立输入边界，不开放生成工具，不抓取页面、不调用模型，也不发送文件。后续模块将接入宿主。没有审核人、审批字段或固定产品资料目录。

## 输入如何进入

运营仍使用自然语言，例如“优化美国站 ASIN B0…，参考这两个竞品，产品参数见附件”。后续对话适配器将其整理为 `listingInputSchema`；本模块不通过关键词猜测任务、不把任意文字自动认定为参数。

支持 create（新品）和 optimize（已有 ASIN）。默认 US/en，其他站点、语言在首版拒绝。新品不传本品 ASIN；优化必须传 ASIN。产品资料可来自当前消息、当前任务附件或已按当前用户权限读取的文档。竞品支持 auto、specified、mixed；后两者需要明确 ASIN，不能把本品当竞品。

`prepareListingInput(raw, context)` 由宿主提供当前身份、原会话、附件和已读取文档/页面快照。模型输入不包含身份覆盖参数、文件路径或审批参数。材料必须绑定真实宿主来源，正文必须能在来源快照中找到。

## 输出与处理

| 状态 | 含义 | 下一步 |
| --- | --- | --- |
| needs_clarification | 新品没有产品信息，或同属性声明冲突 | 在原会话补问，不能静默选择 |
| needs_sources | 附件尚未读取，或优化任务尚未读取原文 | 后续模块调用只读工具 |
| ready_limited | 只有已读取本品页面 | 保守改写，显示“页面来源、未经独立核实” |
| ready | 输入资料已绑定，无已识别冲突 | 进入模块 2 的事实整理，不代表资料充分或文案合规 |

显式 statements 通过 sourceId、excerpt 绑定原文。只比较相同属性的规范化文本；不同文本提示待核实，不做单位换算、不判断数值等价，也不验证所有自由文本语义。完整事实标准化属于模块 2。`ready` 不等于允许跳过事实检查或导出检查。

当前消息可提供全部或部分产品描述；附件名称任意。已读取文档权限由宿主现有工具裁决，本模块仅消费当前任务快照，不自行访问文档。不把其他会话原文自动引入当前任务。

## 样例与验收

`examples/listing/input-examples.json` 提供新品文字、ASIN-only 优化、附件与混合竞品三种结构。ASIN 为虚构测试值；引用 ID 是占位示例，调用准备函数时须用真实当前任务来源替换。缺少页面或附件正文的样例应返回 needs_sources。

运行 `npm test -- tests/listing-input.test.ts` 与 `npm run build`。测试覆盖来源伪造、任务外附件、冲突、缺失、站点范围、身份绑定、竞品策略和不可信文本作为数据保留。这里只证明输入函数没有执行副作用，不宣称完整生成阶段注入防护已完成。

模块 2 的事实整理见 `docs/listing-module-2.md`，模块 3 的规则配置见 `docs/listing-module-3.md`，模块 4 的调研与验收见 `docs/listing-module-4.md`，模块 5 的规划见 `docs/listing-module-5.md`，模块 6 的生成见 `docs/listing-module-6.md`，模块 7 的校验见 `docs/listing-module-7.md`，模块 8 的修订见 `docs/listing-module-8.md`，模块 9 的文件交付见 `docs/listing-module-9.md`。模块 10 尚未实现，`npm run eval:listing` 将在模块 10 添加。
