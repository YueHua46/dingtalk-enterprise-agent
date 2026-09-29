---
name: amazon-page-research
description: 使用 Amazon 公开页面原子工具查询关键词、ASIN 商品详情与图片、相似商品、促销、评论和自然/SP 排名。适用于商品页面取证与竞品调研。
---

# Amazon 页面调研

本 Skill 只提供取证方法。业务数据按用户授权走 CrossBorderOps；本 Skill 的结果是查询时的 Amazon 页面观察。

## 原子工具

| 工具 | 适用问题 |
| --- | --- |
| `amazon.search_products` | 按关键词找商品，返回自然/广告卡片及图片 URL |
| `amazon.image_search` | 当前任务图片附件以图搜相似商品；仅 US、DE、IT、ES、JP |
| `amazon.get_product_detail` | 用 ASIN 或商品链接查标题、品牌、卖点、价格及 `images` 主图 URL |
| `amazon.get_related_products` | 查商品页上的关联推荐模块 |
| `amazon.get_promotions` | 查商品页当前优惠、Coupon、Deal |
| `amazon.get_reviews` | 采样评论，可筛选低星；若评论页要求登录，会退到商品页可见评论，不能再称为按时间排序的近期评论 |
| `amazon.get_keyword_rank` | ASIN 在关键词下的自然/SP 页码与位置；需配送邮编验证 |

## 组合

- 给出 Amazon 商品链接并要求场景图：先从链接识别站点与 ASIN，调用 `amazon.get_product_detail`。若返回 `mainImageAttachmentId`，可调用 `image.generate` 的 `operation=edit` 并把该 ID 放入 `inputAttachmentIds`。若 `images` 为空或主图下载失败，不要猜测商品外观；请用户补图或说明缺口。
- 关键词调研：先 `search_products`，需要具体候选外观时再 `get_product_detail`；排名问题再调用 `get_keyword_rank`。
- 竞品分析：按相关性选候选 ASIN，再查详情、关联商品、促销和评论。原始页面事实与运营判断分开。

## 范围和失败

普通页面工具支持 US、CA、JP、UK、FR、BE、IT、DE、ES、IN、MX、AU。BE 为 `amazon.com.be`，以图搜索暂不支持 BE。页面可能因验证码、配送地区或页面改版而失败；失败时报告实际错误，不用其他站点同 ASIN 的结果替代 BE 实测。排名未验证配送邮编时不可宣称排名。
