# Listing 模块 3：规则配置与加载

新增配置 `config/listing-rules.us-en.json`，以及 `parseListingRules`、`loadListingRules`、`resolveListingRules`。仅加载和校验配置，文案检查器在模块 7 实现。本模块不调用模型、不访问网络、不执行配置中的文本。

## 配置内容

每条规则包含 ID、平台/内部来源、字段、严重程度、生效日期（未知可为 null）、来源标题与链接、发布日（未知可为 null）、查阅日、核实状态和说明。已核实记录必须给出核实人和日期，程序不能自动把“查到来源”改成“已核实”。

候选平台规则包括标题长度、特殊字符、重复词、搜索词字节限制、五点退款保证表达及特殊内容核查。所有平台规则仍为 pending（待核实）。本次官方公告和历史培训材料支持候选规则，但尚未确认具体摄像头类目在当前日期的完整规则：

- 标题公告：https://sellercentral.amazon.com/seller-forums/discussions/t/b2b15728-0d43-453e-974f-59eb63f73059
- 五点公告：https://sellercentral.amazon.com/seller-forums/discussions/t/65f8e647-977d-49ac-9036-2049b96720b2
- 搜索词培训材料：https://m.media-amazon.com/images/G/28/AS/AGS/SU/CN_GS_Listing_Optimization_1.1_General_Guidance_EN.pdf

标题候选为包含空格、不超过 200 个 Unicode 码点；搜索词候选为包含空格、UTF-8 字节少于 250。计数方式是本项目实现口径，平台细节仍待核实。品牌字符例外和重复词例外放在配置。候选禁词和例外词表不是官方完整词表。

内部策略单独记录：交付 5 条五点；每条 500 字符、描述 2000 字符仅是待核实的草稿预算，advisory，不冒充平台硬限制。五点特殊内容范围未确认，保留 manual_check 提示，不声称自动检查通过。

## 产品类型与加载

正式 productTypes 为空，不编造摄像头 Amazon product type 或上限。未指定类型、自然语言“摄像头”或未知类型均加载通用规则，返回 general_only 和明确缺口。以后获得真实类目依据可配置精确 ID；不做模糊匹配。

类型覆盖只能替换同 ID、同字段、同来源类型、同检查类型的基础规则；禁止未知覆盖和重复覆盖。类型本身和每条规则分别记录核实状态；product_type_verified 仅表示类型记录已核实，不代表所有规则已核实或所有文案合规。manual_check 仍需在交付中展示。

宿主调用 `loadListingRules(path)`，路径来自可信部署配置，不接受模型或评论指定；读取失败、JSON 错误或 schema 错误直接报错，不静默回退。加载不请求来源 URL。`resolveListingRules(config, { marketplace: 'US', language: 'en', productType })` 返回规则副本、版本、SHA-256、覆盖范围与 notices。指纹绑定整份配置与所选类型，支持后续版本追溯。

日期校验拒绝不存在的日期、发布晚于查阅、核实早于查阅、记录晚于配置更新以及尚未生效的规则。本版不支持预先发布定时生效规则；需在生效后更新配置。未知生效日可为 null，并在说明中保留不确定性。

不在此模块增加审批、模型调用、联网更新或部署配置改动。现有配置不会自动修改规则或核实状态。

## 验收

运行 `npm test -- tests/listing-rules.test.ts` 和 `npm run build`。测试覆盖来源与日期、字节/字符和比较边界、内部/平台规则分离、精确类型覆盖、pending 通知、配置版本变化、无效覆盖、缺失文件、伪造来源和未知可执行字段。

类型覆盖测试使用虚构 TEST_CAMERA，不作为正式摄像头规则。模块 4 将接入竞品与关键词调研，模块 7 才验证实际文案。
