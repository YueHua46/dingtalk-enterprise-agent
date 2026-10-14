# 广告分析数据字典

## 最小广告字段

`date`, `marketplace`, `currency`, `store_id`, `asin`, `sku`, `campaign_id`, `campaign_name`, `ad_group_id`, `target_id`, `targeting`, `match_type`, `search_term`, `placement`, `impressions`, `clicks`, `spend`, `orders`, `ad_sales`, `total_sales`, `budget`, `bid`, `add_to_cart`, `status`。

缺失字段为“未知”，不得使用同名但不同口径的字段替代。广告归因窗口、时区、币种和数据截至时间必须随证据记录。

## CrossBorderOps 路由

广告分析优先使用 `daily.availability`、`daily.product`、`ads.sp_search_terms`、`ads.sb_search_terms`、`ads.placements` 和 `ads.summary`。`daily.product` 必须带单个 ASIN，时间窗不超过 30 天；不要把 `daily.metrics` 作为广告分析的必经数据集。服务端返回的 `scope`、`coverage`、`data_as_of` 和 `queried_at` 是分析证据的一部分。

## 利润字段

`selling_price`, `actual_price`, `discount`, `unit_cost`, `inbound_cost`, `fba_fee`, `referral_fee`, `vat_or_tax`, `refund_rate`, `other_cost`, `target_profit`。这些字段不在来源中时，不能输出真实利润、保本 ACoS 或可承受 CPC。

## 数据质量

把数据分为完整、部分完整、缺失和临时占位零值。`coverage.business_rows < expected_rows`、广告字段缺失、授权范围不完整或数据截至日不足时，报告必须说明影响。

