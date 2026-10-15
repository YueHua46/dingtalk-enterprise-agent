// Official MCP schemas reviewed 2026-10-15. Scope policies are explicit, never inferred at runtime.
export const lingxingReadRegistry: Record<string, {displayName: string; description: string; mode: string; scopeKey: string; inputSchema: Record<string, any>}> = {
  "ad_auth_shops": {
    "displayName": "查询广告授权店铺列表",
    "description": "查询广告授权店铺列表,返回所有已授权的广告店铺信息(店铺名称、国家、Profile ID等)",
    "mode": "shops",
    "scopeKey": "sid",
    "inputSchema": {
      "type": "object",
      "properties": {}
    }
  },
  "get_my_sids": {
    "displayName": "查询我的店铺列表",
    "description": "查询当前用户的店铺列表,返回店铺ID(sid)、店铺名称、亚马逊卖家ID(seller_id)、国家等信息。返回的id即为其他接口中的sid(系统店铺ID)",
    "mode": "shops",
    "scopeKey": "id",
    "inputSchema": {
      "type": "object",
      "properties": {}
    }
  },
  "ad_campaign_report": {
    "displayName": "查询广告活动报告",
    "description": "查询广告活动的报告,支持按日期、店铺、状态、竞价策略等多维度筛选和排序",
    "mode": "profiles",
    "scopeKey": "profile_ids",
    "inputSchema": {
      "type": "object",
      "properties": {
        "spends": {
          "description": "花费区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "indirect_roas": {
          "description": "间接ROAS区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "cost_type": {
          "description": "成本类型。枚举: cpc, vcpm",
          "type": "string"
        },
        "ads_type": {
          "description": "广告类型筛选。每项格式为 [广告类型, 可选的SB创意类型]，例如 [[\"sp\"], [\"sb\", \"PRODUCT_COLLECTION\"], [\"sbv\", \"VIDEO\"], [\"sd\"]]",
          "type": "array"
        },
        "bidding_type": {
          "description": "竞价策略。枚举: autoForSales-动态竞价提高和降低, legacyForSales-动态竞价只降低, manual-固定竞价",
          "type": "string"
        },
        "rule_uid": {
          "description": "负责人uid列表",
          "type": "array"
        },
        "sales": {
          "description": "广告销售额区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "ad_units": {
          "description": "广告销量区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "cpa": {
          "description": "CPA区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "cpc": {
          "description": "CPC区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "portfolio_id": {
          "description": "广告组合ID筛选",
          "type": "string"
        },
        "roas": {
          "description": "ROAS区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "state": {
          "description": "广告活动状态，多个用下划线分隔。枚举: enabled-启用, paused-暂停, archived-归档",
          "type": "string"
        },
        "sku": {
          "description": "广告SKU筛选",
          "type": "array"
        },
        "budget_type": {
          "description": "预算类型。枚举: lifetime-终生, daily-每日",
          "type": "string"
        },
        "cvr": {
          "description": "CVR区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "report_date": {
          "description": "报告日期范围，格式: YYYY-MM-DD - YYYY-MM-DD",
          "type": "string"
        },
        "ctr": {
          "description": "CTR区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "site_restrictions": {
          "description": "站点筛选。枚举: AMAZON_BUSINESS-亚马逊企业购, AMAZON_ALL-亚马逊站内外",
          "type": "string"
        },
        "length": {
          "default": 20,
          "description": "分页大小",
          "type": "integer"
        },
        "target_type": {
          "description": "投放类型筛选",
          "type": "array"
        },
        "acos": {
          "description": "ACOS区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "impressions": {
          "description": "曝光区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "unit_price": {
          "description": "广告笔单价区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "search_type": {
          "description": "搜索类型，固定传 campaign_name",
          "type": "string"
        },
        "sort_type": {
          "default": "desc",
          "description": "排序类型。枚举: desc-降序, asc-升序",
          "type": "string",
          "enum": [
            "desc",
            "asc"
          ]
        },
        "direct_acos": {
          "description": "直接ACOS区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "sort_field": {
          "description": "排序字段名称。可选值：impressions-曝光、clicks-点击、ctr-CTR、spends-花费、cpc-CPC、orders-广告订单、cpa-CPA、cvr-CVR、sales-广告销售额、unit_price-广告笔单价、ad_units-广告销量、acos-ACOS、roas-ROAS、direct_acos-直接ACOS、indirect_roas-间接ROAS",
          "type": "string",
          "enum": [
            "impressions",
            "clicks",
            "ctr",
            "spends",
            "cpc",
            "orders",
            "cpa",
            "cvr",
            "sales",
            "unit_price",
            "ad_units",
            "acos",
            "roas",
            "direct_acos",
            "indirect_roas"
          ]
        },
        "ads_state": {
          "description": "广告商品状态筛选。枚举: enabled-启用, paused-暂停",
          "type": "array"
        },
        "targeting_type": {
          "description": "投放方式筛选。枚举: auto-自动, manual-手动",
          "type": "array"
        },
        "name": {
          "description": "广告活动名称搜索",
          "type": "string"
        },
        "clicks": {
          "description": "点击区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "tag_uuid": {
          "description": "广告活动标签 UUID 列表。仅当用户明确要求按广告标签筛选时传入；必须先调用「查询广告活动标签」（toolId: ad_campaign_tag_list，参数 tag_code: Campaign），从返回结果中选择匹配标签的 uuid 字段填入。支持传入多个 UUID。",
          "type": "array"
        },
        "ads_strategy": {
          "description": "广告工具筛选。枚举: RuleEngine-自动规则, StepBudget-递增预算, TimingTactics-分时策略, TimingCustomSet-自定义设置, NotAppliedTool-未使用工具",
          "type": "array"
        },
        "asin": {
          "description": "广告ASIN筛选",
          "type": "string"
        },
        "orders": {
          "description": "广告订单区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "only_over_budget": {
          "default": 0,
          "description": "是否只看超预算，0-否，1-是",
          "type": "integer"
        },
        "page": {
          "default": 1,
          "description": "分页页码",
          "type": "integer"
        },
        "profile_ids": {
          "description": "广告店铺Profile ID列表",
          "type": "array"
        },
        "search_text": {
          "description": "广告活动模糊搜索字段名称",
          "type": "string"
        }
      },
      "required": [
        "report_date",
        "profile_ids",
        "page",
        "length",
        "sort_field",
        "sort_type"
      ]
    }
  },
  "ad_campaign_group_report": {
    "displayName": "查询广告活动下的广告组报告",
    "description": "查询指定广告活动下的广告组报告,支持按日期、店铺、广告类型、广告活动等筛选",
    "mode": "profiles",
    "scopeKey": "profile_ids",
    "inputSchema": {
      "type": "object",
      "properties": {
        "accurate": {
          "description": "搜索方式,0-模糊,1-精确",
          "type": "integer"
        },
        "cost_type": {
          "description": "成本类型",
          "type": "string"
        },
        "length": {
          "default": 20,
          "description": "分页大小",
          "type": "integer"
        },
        "with_ring": {
          "default": 0,
          "description": "是否返回环比数据",
          "type": "integer"
        },
        "sort_type": {
          "default": "desc",
          "description": "排序类型,desc-降序,asc-升序",
          "type": "string",
          "enum": [
            "desc",
            "asc"
          ]
        },
        "serving_status": {
          "description": "服务状态筛选",
          "type": "array"
        },
        "sort_field": {
          "description": "排序字段名称",
          "type": "string"
        },
        "parent_asin": {
          "description": "父ASIN筛选",
          "type": "array"
        },
        "portfolio_id": {
          "description": "广告组合ID列表",
          "type": "array"
        },
        "ads_strategy": {
          "description": "应用工具筛选",
          "type": "string"
        },
        "asin": {
          "description": "ASIN筛选(VC店铺时传)",
          "type": "array"
        },
        "page": {
          "default": 1,
          "description": "分页页码",
          "type": "integer"
        },
        "sponsored_type": {
          "description": "广告类型筛选,如sp/sb/sd",
          "type": "array"
        },
        "state": {
          "description": "有效状态。枚举: enabled-启用, paused-暂停, archived-归档",
          "type": "string"
        },
        "ad_group_id": {
          "description": "广告组ID列表",
          "type": "array"
        },
        "sku": {
          "description": "SKU筛选(SC店铺时传)",
          "type": "array"
        },
        "target_sub_type": {
          "description": "投放类型筛选",
          "type": "array"
        },
        "campaign_id": {
          "description": "广告活动ID列表",
          "type": "array"
        },
        "profile_ids": {
          "description": "广告店铺Profile ID列表",
          "type": "array"
        },
        "cid": {
          "description": "分类ID筛选",
          "type": "array"
        },
        "report_date": {
          "description": "报告日期范围,格式: YYYY-MM-DD - YYYY-MM-DD",
          "type": "string"
        },
        "search_text": {
          "description": "搜索文本",
          "type": "string"
        }
      },
      "required": [
        "report_date",
        "profile_ids",
        "with_ring"
      ]
    }
  },
  "ad_campaign_keyword_report": {
    "displayName": "查询广告活动下的关键词报告",
    "description": "查找指定广告活动下的投放报告(关键词),支持按关键词搜索、匹配方式、聚合方式筛选",
    "mode": "profiles",
    "scopeKey": "profile_ids",
    "inputSchema": {
      "type": "object",
      "properties": {
        "spends": {
          "description": "花费区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "indirect_roas": {
          "description": "间接ROAS区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "accurate": {
          "description": "搜索精确度,0-模糊查询,1-精确比较",
          "type": "integer"
        },
        "group_type": {
          "description": "聚合方式,默认keyword_id,按文本则传keyword_text",
          "type": "string"
        },
        "sales": {
          "description": "广告销售额区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "ad_units": {
          "description": "广告销量区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "cpa": {
          "description": "CPA区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "cpc": {
          "description": "CPC区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "match_type": {
          "description": "匹配方式筛选",
          "type": "array"
        },
        "portfolio_id": {
          "description": "广告组合ID列表",
          "type": "array"
        },
        "roas": {
          "description": "ROAS区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "sponsored_type": {
          "description": "广告类型筛选,如sp/sb/sd",
          "type": "array"
        },
        "ad_group_id": {
          "description": "广告组ID列表",
          "type": "array"
        },
        "campaign_id": {
          "description": "广告活动ID列表",
          "type": "array"
        },
        "cvr": {
          "description": "CVR区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "report_date": {
          "description": "报告日期范围,格式: YYYY-MM-DD - YYYY-MM-DD",
          "type": "string"
        },
        "ctr": {
          "description": "CTR区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "length": {
          "default": 20,
          "description": "分页大小",
          "type": "integer"
        },
        "acos": {
          "description": "ACOS区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "impressions": {
          "description": "曝光区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "unit_price": {
          "description": "广告笔单价区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "with_ring": {
          "default": 0,
          "description": "是否返回环比数据",
          "type": "integer"
        },
        "sort_type": {
          "default": "desc",
          "description": "排序类型,desc-降序,asc-升序",
          "type": "string",
          "enum": [
            "desc",
            "asc"
          ]
        },
        "direct_acos": {
          "description": "直接ACOS区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "sort_field": {
          "description": "排序字段名称",
          "type": "string"
        },
        "clicks": {
          "description": "点击区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "orders": {
          "description": "广告订单区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "page": {
          "default": 1,
          "description": "分页页码",
          "type": "integer"
        },
        "keyword_text": {
          "description": "搜索文本(关键词)",
          "type": "string"
        },
        "profile_ids": {
          "description": "广告店铺Profile ID列表",
          "type": "array"
        }
      },
      "required": [
        "report_date",
        "profile_ids",
        "page",
        "length",
        "sort_field",
        "sort_type"
      ]
    }
  },
  "ad_campaign_search_term_report": {
    "displayName": "查询广告活动下的搜索词报告",
    "description": "查找指定广告活动下的搜索词报告,支持按搜索词、投放类型、广告对象等筛选",
    "mode": "profiles",
    "scopeKey": "profile_ids",
    "inputSchema": {
      "type": "object",
      "properties": {
        "country": {
          "description": "站点国家代码筛选,如US/UK/DE/JP等",
          "type": "array"
        },
        "accurate": {
          "description": "精确度,0-模糊查询,1-精确比较,2-单词搜索",
          "type": "integer"
        },
        "with_translation": {
          "default": 0,
          "description": "是否翻译搜索词,0-不翻译,1-翻译为中文",
          "type": "integer"
        },
        "default_bid": {
          "description": "默认竞价范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "ads_object": {
          "description": "广告对象筛选。枚举: target-商品投放, keyword-关键词投放, auto_target-自动投放",
          "type": "string"
        },
        "target_match_type": {
          "description": "来源匹配方式筛选。枚举: Broad-广泛匹配, Phrase-短语匹配, Exact-精确匹配, keywordGroupSameAs-关键词组, asinSameAs-商品, asinExpandedFrom-商品拓展, asinCategorySameAs-类目, loose-match-宽泛匹配, close-match-紧密匹配, substitutes-同类商品, complements-关联商品",
          "type": "string"
        },
        "group_type": {
          "description": "聚合类型,query-按搜索词文本聚合",
          "type": "string"
        },
        "sales": {
          "description": "广告销售额范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "cpa": {
          "description": "CPA范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "cpc": {
          "description": "CPC范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "portfolio_id": {
          "description": "广告组合ID列表筛选",
          "type": "array"
        },
        "roas": {
          "description": "ROAS范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "sponsored_type": {
          "description": "广告类型筛选,如sp/sb",
          "type": "array"
        },
        "state": {
          "description": "广告状态筛选。枚举: enabled-启用, paused-暂停, archived-归档",
          "type": "string"
        },
        "ad_group_id": {
          "description": "广告组ID筛选",
          "type": "string"
        },
        "sku": {
          "description": "按SKU过滤广告组",
          "type": "string"
        },
        "campaign_id": {
          "description": "广告活动ID筛选",
          "type": "string"
        },
        "budget": {
          "description": "活动预算范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "report_date": {
          "description": "报告日期范围,格式: YYYY-MM-DD - YYYY-MM-DD",
          "type": "string"
        },
        "ctr": {
          "description": "CTR范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "query": {
          "description": "用户搜索词精确筛选(子级列表用)",
          "type": "string"
        },
        "acos": {
          "description": "ACOS范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "search_type": {
          "description": "搜索范围类型。枚举: query-按搜索词, kw-按投放, asin-按ASIN码",
          "type": "string"
        },
        "targeted_type": {
          "description": "操作类型筛选。枚举: targeted-已投放, not_targeted-未投放, negatived-已否定, not_negatived-未否定, not_negatived_and_not_targeted-未进行投放和否定",
          "type": "string"
        },
        "sort_field": {
          "description": "排序字段名(如spends花费、sales广告销售额、orders广告订单等)",
          "type": "string"
        },
        "ads_state": {
          "description": "广告层级状态筛选",
          "type": "string"
        },
        "targeting_type": {
          "description": "来源投放类型筛选。枚举: TARGETING_EXPRESSION_PREDEFINED-自动投放, KEYWORD-关键词投放, TARGETING_EXPRESSION-商品投放",
          "type": "string"
        },
        "parent_asin": {
          "description": "按父ASIN过滤广告组",
          "type": "array"
        },
        "profile_id": {
          "description": "主店铺Profile ID",
          "type": "integer"
        },
        "orders": {
          "description": "广告订单数范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "page": {
          "default": 1,
          "description": "当前页码,从1开始",
          "type": "integer"
        },
        "profile_ids": {
          "description": "广告店铺Profile ID列表",
          "type": "array"
        },
        "cid": {
          "description": "按商品分类ID过滤广告组",
          "type": "array"
        },
        "search_text": {
          "description": "搜索关键词",
          "type": "string"
        },
        "spends": {
          "description": "广告花费范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "ad_units": {
          "description": "广告销量范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "target_state": {
          "description": "来源投放状态筛选,多个用下划线分隔。枚举: enabled-启用, paused-暂停, archived-归档",
          "type": "string"
        },
        "theme": {
          "description": "主题筛选(主题分析用)",
          "type": "string"
        },
        "cvr": {
          "description": "CVR范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "daily_budget": {
          "description": "每日预算范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "length": {
          "default": 25,
          "description": "每页数量,默认25",
          "type": "integer"
        },
        "impressions": {
          "description": "曝光量范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "unit_price": {
          "description": "广告笔单价范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "with_ring": {
          "default": false,
          "description": "是否返回环比变动值",
          "type": "boolean"
        },
        "record_id": {
          "description": "记录ID筛选",
          "type": "string"
        },
        "sort_type": {
          "default": "desc",
          "description": "排序方向,asc-升序,desc-降序",
          "type": "string",
          "enum": [
            "desc",
            "asc"
          ]
        },
        "is_asin_category": {
          "description": "是否ASIN筛选。枚举: IsAsin-ASIN码, NotAsin-非ASIN",
          "type": "string"
        },
        "clicks": {
          "description": "点击量范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "asin": {
          "description": "按ASIN过滤广告组",
          "type": "string"
        },
        "bid": {
          "description": "竞价范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "category": {
          "description": "分类筛选。枚举: HasDeal-有订单, HasClickNoDeal-有点击无订单等",
          "type": "string"
        }
      },
      "required": [
        "report_date",
        "profile_ids"
      ]
    }
  },
  "ad_campaign_product_report": {
    "displayName": "查询广告活动下的广告商品报告",
    "description": "查找指定广告活动下的广告商品报告,支持按状态、创意类型、搜索文本筛选",
    "mode": "profiles",
    "scopeKey": "profile_ids",
    "inputSchema": {
      "type": "object",
      "properties": {
        "spends": {
          "description": "广告花费范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "default_bid": {
          "description": "默认竞价范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "sales": {
          "description": "广告销售额范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "ad_units": {
          "description": "广告销量范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "cpa": {
          "description": "CPA范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "cpc": {
          "description": "CPC范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "creative_type": {
          "description": "创意类型筛选。枚举: VIDEO-视频创意, PRODUCT-商品创意",
          "type": "string"
        },
        "portfolio_id": {
          "description": "广告组合ID列表筛选",
          "type": "array"
        },
        "roas": {
          "description": "ROAS范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "sponsored_type": {
          "description": "广告类型筛选,如sp/sb/sd",
          "type": "array"
        },
        "state": {
          "description": "广告状态筛选,多个用下划线分隔。枚举: enabled-启用, paused-暂停, archived-归档",
          "type": "string"
        },
        "ad_group_id": {
          "description": "广告组ID筛选",
          "type": "string"
        },
        "campaign_id": {
          "description": "广告活动ID筛选",
          "type": "string"
        },
        "cvr": {
          "description": "CVR范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "budget": {
          "description": "活动预算范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "report_date": {
          "description": "报告日期范围,格式: YYYY-MM-DD - YYYY-MM-DD",
          "type": "string"
        },
        "ctr": {
          "description": "CTR范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "daily_budget": {
          "description": "每日预算范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "length": {
          "default": 25,
          "description": "每页数量,默认25",
          "type": "integer"
        },
        "acos": {
          "description": "ACOS范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "impressions": {
          "description": "曝光量范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "unit_price": {
          "description": "广告笔单价范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "with_ring": {
          "default": false,
          "description": "是否返回环比变动值",
          "type": "boolean"
        },
        "record_id": {
          "description": "广告ID筛选",
          "type": "string"
        },
        "sort_type": {
          "default": "desc",
          "description": "排序方向,asc-升序,desc-降序",
          "type": "string",
          "enum": [
            "desc",
            "asc"
          ]
        },
        "serving_status": {
          "description": "服务状态筛选",
          "type": "array"
        },
        "sort_field": {
          "description": "排序字段名(如spends花费、sales广告销售额、orders广告订单等)",
          "type": "string"
        },
        "profile_id": {
          "description": "主店铺Profile ID",
          "type": "integer"
        },
        "clicks": {
          "description": "点击量范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "tag_uuid": {
          "description": "商品标签UUID列表,-1代表筛选无标签的广告",
          "type": "array"
        },
        "ads_strategy": {
          "description": "广告策略筛选。枚举: RULE_ENGINE-规则引擎, TIMING_TACTICS-分时策略, NOT_APPLIED_TOOL-未应用工具",
          "type": "string"
        },
        "orders": {
          "description": "广告订单数范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "page": {
          "default": 1,
          "description": "当前页码,从1开始",
          "type": "integer"
        },
        "bid": {
          "description": "竞价范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "profile_ids": {
          "description": "店铺Profile ID列表(跨店铺查询)",
          "type": "array"
        },
        "search_text": {
          "description": "搜索关键词(ASIN/SKU模糊匹配)",
          "type": "string"
        }
      },
      "required": [
        "report_date",
        "profile_id"
      ]
    }
  },
  "ad_campaign_targeting_report": {
    "displayName": "查询广告活动下的投放报告",
    "description": "查找指定广告活动下的投放报告(自动投放或商品投放),支持按状态、策略、搜索文本筛选",
    "mode": "profiles",
    "scopeKey": "profile_ids",
    "inputSchema": {
      "type": "object",
      "properties": {
        "spends": {
          "description": "广告花费范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "indirect_roas": {
          "description": "间接ROAS范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "accurate": {
          "description": "搜索方式,0-模糊,1-精确",
          "type": "integer"
        },
        "sales": {
          "description": "广告销售额范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "ad_units": {
          "description": "广告销量范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "cpa": {
          "description": "CPA范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "cpc": {
          "description": "CPC范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "limit": {
          "description": "返回数量限制",
          "type": "integer"
        },
        "portfolio_id": {
          "description": "广告组合ID列表筛选",
          "type": "array"
        },
        "roas": {
          "description": "ROAS范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "sponsored_type": {
          "description": "广告类型筛选,如sp/sb/sd",
          "type": "array"
        },
        "state": {
          "description": "广告状态筛选,多个用下划线分隔。枚举: enabled-启用, paused-暂停, archived-归档",
          "type": "string"
        },
        "ad_group_id": {
          "description": "广告组ID列表",
          "type": "array"
        },
        "campaign_id": {
          "description": "广告活动ID列表",
          "type": "array"
        },
        "cvr": {
          "description": "CVR范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "report_date": {
          "description": "报告日期范围,格式: YYYY-MM-DD - YYYY-MM-DD",
          "type": "string"
        },
        "ctr": {
          "description": "CTR范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "length": {
          "default": "25",
          "description": "每页数量,默认25",
          "type": "string"
        },
        "acos": {
          "description": "ACOS范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "impressions": {
          "description": "曝光量范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "unit_price": {
          "description": "广告笔单价范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "with_ring": {
          "default": 0,
          "description": "是否返回环比变动值",
          "type": "number"
        },
        "sort_type": {
          "default": "desc",
          "description": "排序方向,asc-升序,desc-降序",
          "type": "string",
          "enum": [
            "desc",
            "asc"
          ]
        },
        "serving_status": {
          "description": "服务状态筛选",
          "type": "array"
        },
        "direct_acos": {
          "description": "直接ACOS范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "sort_field": {
          "description": "排序字段名(如spends花费、sales广告销售额、orders广告订单等)",
          "type": "string"
        },
        "clicks": {
          "description": "点击量范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "ads_strategy": {
          "description": "广告策略筛选。枚举: RULE_ENGINE-规则引擎, TIMING_TACTICS-分时策略, NOT_APPLIED_TOOL-未应用工具",
          "type": "string"
        },
        "orders": {
          "description": "广告订单数范围筛选 [最小值, 最大值]",
          "type": "array"
        },
        "page": {
          "default": 1,
          "description": "当前页码,从1开始",
          "type": "integer"
        },
        "target_sub_type": {
          "description": "投放类型筛选",
          "type": "array"
        },
        "profile_ids": {
          "description": "店铺Profile ID列表(跨店铺查询)",
          "type": "array"
        },
        "search_text": {
          "description": "搜索关键词(ASIN/SKU模糊匹配)",
          "type": "string"
        }
      },
      "required": [
        "report_date",
        "profile_ids",
        "page",
        "length",
        "sort_field",
        "sort_type",
        "with_ring"
      ]
    }
  },
  "ad_portfolio_report_shop": {
    "displayName": "查询店铺维度广告组合报告",
    "description": "查询广告组合的报告-店铺维度,支持按日期范围、店铺、国家、服务状态筛选",
    "mode": "profiles",
    "scopeKey": "profile_ids",
    "inputSchema": {
      "type": "object",
      "properties": {
        "spends": {
          "description": "花费区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "indirect_roas": {
          "description": "间接ROAS区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "sales": {
          "description": "广告销售额区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "ad_units": {
          "description": "广告销量区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "cpa": {
          "description": "CPA区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "cpc": {
          "description": "CPC区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "portfolio_id": {
          "description": "广告组合ID筛选",
          "type": "string"
        },
        "roas": {
          "description": "ROAS区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "cvr": {
          "description": "CVR区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "report_date": {
          "description": "报告日期范围,格式: YYYY-MM-DD - YYYY-MM-DD",
          "type": "string"
        },
        "ctr": {
          "description": "CTR区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "length": {
          "default": 20,
          "description": "分页大小",
          "type": "integer"
        },
        "acos": {
          "description": "ACOS区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "countries": {
          "description": "国家筛选",
          "type": "array"
        },
        "impressions": {
          "description": "曝光区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "unit_price": {
          "description": "广告笔单价区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "search_type": {
          "description": "模糊搜索类型,目前仅广告活动名称 campaign_name",
          "type": "string"
        },
        "sort_type": {
          "default": "desc",
          "description": "排序类型,desc-降序,asc-升序",
          "type": "string",
          "enum": [
            "desc",
            "asc"
          ]
        },
        "serving_status": {
          "description": "服务状态筛选",
          "type": "array"
        },
        "direct_acos": {
          "description": "直接ACOS区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "sort_field": {
          "description": "排序字段名称",
          "type": "string"
        },
        "clicks": {
          "description": "点击区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "orders": {
          "description": "广告订单区间筛选 [最小值, 最大值]",
          "type": "array"
        },
        "page": {
          "default": 1,
          "description": "分页页码",
          "type": "integer"
        },
        "profile_ids": {
          "description": "广告店铺Profile ID列表",
          "type": "array"
        },
        "search_text": {
          "description": "广告活动模糊搜索字段名称",
          "type": "string"
        }
      },
      "required": [
        "report_date",
        "profile_ids",
        "page",
        "length",
        "sort_field",
        "sort_type"
      ]
    }
  },
  "advertising_ad_analyze_keyword": {
    "displayName": "查询广告关键词分析",
    "description": "广告分析-搜索词分析",
    "mode": "single",
    "scopeKey": "sid",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "end_date": {
          "description": "查询结束日期，格式YYYY-MM-DD",
          "type": "string"
        },
        "msku": {
          "description": "商家SKU列表，与asin二选一必传，最多10个",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "profile_id": {
          "description": "广告Profile ID，与sid二选一必传",
          "type": "integer"
        },
        "limit": {
          "description": "每页返回条数，默认25，最大1000",
          "type": "integer"
        },
        "asin": {
          "description": "Amazon ASIN列表，与msku二选一必传，最多10个",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "page": {
          "description": "页码，从1开始，默认1",
          "type": "integer"
        },
        "sponsored_type": {
          "description": "广告类型筛选。 sp：SP广告 sb：SB广告",
          "type": "string",
          "enum": [
            "sp",
            "sb"
          ]
        },
        "ad_group_id": {
          "description": "广告组ID列表（可选），与ASIN/MSKU反查出的广告组ID取交集",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "campaign_id": {
          "description": "广告活动ID列表（可选），与ASIN/MSKU反查结果取交集",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "sid": {
          "description": "系统内店铺ID，与profileId二选一必传",
          "type": "string"
        },
        "order": {
          "description": "排序规则，最多3个，不传时默认按spends降序。 column: 排序字段名 sort: 排序方向，asc/desc",
          "type": "array",
          "items": {
            "additionalProperties": false,
            "type": "object",
            "properties": {
              "column": {
                "description": "排序字段名。",
                "type": "string"
              },
              "sort": {
                "description": "排序方向：asc 升序；desc 降序。",
                "type": "string"
              }
            }
          }
        },
        "start_date": {
          "description": "查询开始日期，格式YYYY-MM-DD，最大跨度31天",
          "type": "string"
        }
      },
      "required": [
        "end_date",
        "start_date"
      ]
    }
  },
  "advertising_order_analysis_list": {
    "displayName": "查询产品出单时段分析",
    "description": "用于出单时段分析（产品）。",
    "mode": "single",
    "scopeKey": "sid",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "end_date": {
          "description": "结束日期，格式：Y-m-d",
          "type": "string"
        },
        "group_type": {
          "description": "时间维度：hourly 按小时；weekly 按周",
          "type": "string",
          "enum": [
            "hourly",
            "weekly"
          ]
        },
        "sponsored_type": {
          "description": "广告类型：sp；sd",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "sku": {
          "description": "MSKU，最多 10 个",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "sid": {
          "description": "店铺 ID。下游 ClientRequest 必填；OpenAPI 文档中 profile_id 不会被 Builder 传给下游。",
          "type": "string"
        },
        "start_date": {
          "description": "开始日期，格式：Y-m-d",
          "type": "string"
        }
      },
      "required": [
        "sid",
        "sku",
        "start_date",
        "end_date",
        "group_type"
      ]
    }
  },
  "analytics_log_list_v2": {
    "displayName": "查询运营日志",
    "description": "用于查询运营日志(新)。",
    "mode": "sids",
    "scopeKey": "sids",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "end_date": {
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
          "description": "结束时间，格式 yyyy-MM-dd。",
          "type": "string"
        },
        "search_value": {
          "default": [],
          "description": "搜索值列表；无筛选时传空数组，不要传 null。",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "turn_on_summary": {
          "default": false,
          "description": "是否开启汇总。",
          "type": "boolean"
        },
        "offset": {
          "default": 0,
          "description": "分页偏移量，默认 0。",
          "type": "integer",
          "minimum": 0
        },
        "gtag_ids": {
          "default": [],
          "description": "标签 ID 筛选列表；无筛选时传空数组，不要传 null。",
          "type": "array"
        },
        "summary_type": {
          "description": "日志维度。",
          "type": "string",
          "enum": [
            "asin",
            "parent_asin",
            "msku"
          ]
        },
        "sids": {
          "default": [],
          "description": "店铺 ID 列表；无筛选时传空数组，不要传 null。",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "is_dimension_display": {
          "default": false,
          "description": "是否显示维度。",
          "type": "boolean"
        },
        "type_names": {
          "default": [],
          "description": "类型名称筛选列表；无筛选时传空数组，不要传 null。",
          "type": "array"
        },
        "mids": {
          "default": [],
          "description": "国家列表；无筛选时传空数组，不要传 null。",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "page_size": {
          "default": 20,
          "description": "分页长度；当前默认值为 20。",
          "maximum": 1000,
          "type": "integer",
          "minimum": 0
        },
        "start_date": {
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
          "description": "开始时间，格式 yyyy-MM-dd。",
          "type": "string"
        },
        "search_field": {
          "default": "msku",
          "description": "搜索字段。",
          "type": "string",
          "enum": [
            "asin",
            "parent_asin",
            "msku"
          ]
        }
      },
      "required": [
        "start_date",
        "end_date",
        "summary_type",
        "page_size"
      ]
    }
  },
  "analytics_report_adjustment_list": {
    "displayName": "查询 FBA 调整报告",
    "description": "查询亚马逊源报表中的盘存记录，支持按店铺及日期范围筛选，按ASIN、MSKU、FNSKU、标题或交易编号搜索，并支持分页查询。",
    "mode": "sids",
    "scopeKey": "sids",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "sids": {
          "description": "店铺id，多个店铺以英文逗号分隔 ，对应查询亚马逊店铺列表接口对应字段【sid】",
          "type": "string"
        },
        "search_value": {
          "description": "搜索值",
          "type": "string"
        },
        "end_date": {
          "description": "发货日期结束时间【闭区间】，格式Y-m-d【report_date】",
          "type": "string"
        },
        "search_field_time": {
          "default": "report_date",
          "description": "日期筛选字段，默认 report_date。",
          "type": "string"
        },
        "offset": {
          "description": "分页偏移量，默认0",
          "type": "integer"
        },
        "length": {
          "description": "分页长度，默认20，上限10000",
          "type": "integer"
        },
        "search_field": {
          "description": "搜索字段：asin ASIN；sku MSKU；fnsku FNSKU；product_name 标题；transaction_item_id 交易编号。",
          "type": "string"
        },
        "start_date": {
          "description": "发货日期开始时间【闭区间】，格式Y-m-d【report_date】",
          "type": "string"
        }
      },
      "required": [
        "end_date",
        "length",
        "offset",
        "start_date"
      ]
    }
  },
  "analytics_report_reimbursement_list": {
    "displayName": "查询亚马逊赔偿报告",
    "description": "亚马逊赔偿记录",
    "mode": "sids",
    "scopeKey": "sids",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "search_value": {
          "description": "搜索的值 /",
          "type": "string"
        },
        "sids": {
          "description": "店铺ID /",
          "type": "string"
        },
        "search_field_time": {
          "description": "搜索时间类型 /",
          "type": "string"
        },
        "end_date": {
          "description": "结束日期 /",
          "type": "string"
        },
        "sort_type": {
          "description": "排序方式，desc/asc，默认desc /",
          "type": "string"
        },
        "sort_field": {
          "description": "排序字段，默认按照id排序 /",
          "type": "string"
        },
        "length": {
          "description": "每页显示条数，默认15 /",
          "type": "integer"
        },
        "search_field": {
          "description": "搜索的字段 /",
          "type": "string"
        },
        "start_date": {
          "description": "开始日期 /",
          "type": "string"
        }
      }
    }
  },
  "analytics_trend_hour_info": {
    "displayName": "查询 ASIN 360 小时趋势",
    "description": "查询asin360小时数据（查询产品每小时表现趋势数据）",
    "mode": "sids",
    "scopeKey": "sids",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "date_type": {
          "default": "purchase",
          "description": "日期类型，默认 purchase。",
          "type": "string"
        },
        "summary_field": {
          "description": "查询维度： parent_asin asin msku sku spu",
          "type": "string"
        },
        "principal_uids": {
          "default": [],
          "description": "负责人 ID 筛选列表。",
          "type": "array"
        },
        "turn_on_summary": {
          "default": "0",
          "description": "是否开启汇总。",
          "type": "string"
        },
        "order_types": {
          "default": [],
          "description": "订单类型筛选列表。",
          "type": "array"
        },
        "purchase_status": {
          "default": 0,
          "description": "下单状态，默认 0。",
          "type": "integer"
        },
        "date_end": {
          "description": "结束时间，闭区间，格式：Y-m-d",
          "type": "string"
        },
        "same_week_compare": {
          "default": 0,
          "description": "是否按相同星期比较，默认 0。",
          "type": "integer"
        },
        "currency_code": {
          "default": "",
          "description": "币种代码，默认空字符串。",
          "type": "string"
        },
        "summary_field_value": {
          "description": "查询维度值",
          "type": "string"
        },
        "date_summary_type": {
          "default": "0",
          "description": "日期汇总类型，默认 0。",
          "type": "string"
        },
        "sids": {
          "description": "店铺id，多个值使用英文逗号隔开，最大上限为200",
          "type": "string"
        },
        "date_start": {
          "description": "开始时间，闭区间，格式：Y-m-d",
          "type": "string"
        },
        "category_id": {
          "default": "-1",
          "description": "分类 ID 筛选，默认 -1。",
          "type": "string"
        },
        "product_states": {
          "default": [],
          "description": "产品状态筛选列表。",
          "type": "array"
        },
        "developer": {
          "default": [],
          "description": "开发人筛选列表。",
          "type": "array"
        },
        "week_day": {
          "default": -1,
          "description": "星期筛选，默认 -1。",
          "type": "integer"
        },
        "attr_value_ids": {
          "default": [],
          "description": "属性值 ID 筛选列表。",
          "type": "array"
        },
        "listing_tag_id": {
          "default": "-1",
          "description": "Listing 标签 ID 筛选，默认 -1。",
          "type": "string"
        },
        "ad_cost_type": {
          "default": "",
          "description": "广告成本类型，默认空字符串。",
          "type": "string"
        }
      },
      "required": [
        "date_end",
        "date_start",
        "sids",
        "summary_field",
        "summary_field_value"
      ]
    }
  },
  "customer_service_rma_list": {
    "displayName": "查询 RMA 管理列表",
    "description": "用于查询RMA管理。",
    "mode": "sids",
    "scopeKey": "sid",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "sortColumn": {
          "description": "排序字段",
          "type": "string"
        },
        "searchField": {
          "description": "搜索字段：msku、asin、sku",
          "type": "string",
          "enum": [
            "msku",
            "asin",
            "sku"
          ]
        },
        "sortType": {
          "description": "排序方式：asc 升序、desc 降序",
          "type": "string",
          "enum": [
            "asc",
            "desc"
          ]
        },
        "searchTimeFiled": {
          "description": "搜索时间类型：1创建时间(createTime)，2操作时间(operationTime)",
          "type": "string",
          "enum": [
            "createTime",
            "operationTime"
          ]
        },
        "pageSize": {
          "description": "每页数量",
          "type": "integer"
        },
        "startTime": {
          "description": "创建或完成时间（开始），格式 yyyy-MM-dd",
          "type": "string"
        },
        "endTime": {
          "description": "创建或完成时间（结束），格式 yyyy-MM-dd",
          "type": "string"
        },
        "pageNum": {
          "description": "页码，从1开始",
          "type": "integer"
        },
        "searchValue": {
          "description": "搜索值，msku和asin支持多个搜索（数组）",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "sid": {
          "description": "店铺id，支持多选（数组）",
          "type": "array",
          "items": {
            "type": "integer"
          }
        }
      }
    }
  },
  "customer_service_customer_index": {
    "displayName": "查询客户列表",
    "description": "用于查询客户列表（新）。",
    "mode": "sids",
    "scopeKey": "sids",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "end_date": {
          "description": "筛选结束时间",
          "type": "string"
        },
        "search_value": {
          "description": "搜索值",
          "type": "string"
        },
        "sids": {
          "description": "店铺id ，对应[查询亚马逊店铺列表](docs/BasicData/SellerLists)接口对应字段【sid】",
          "type": "string"
        },
        "sort_type": {
          "description": "desc=倒序，asc=升序",
          "type": "string"
        },
        "sort_field": {
          "description": "结果按字段排序",
          "type": "string"
        },
        "offset": {
          "description": "偏移量",
          "type": "number"
        },
        "currency_type": {
          "description": "币种，0=原币种，1=CNY，2=USD",
          "type": "number"
        },
        "length": {
          "description": "分页长度 ，默认20 ，上限200",
          "type": "number"
        },
        "date_field": {
          "description": "时间筛选查询类型，1：首次购买时间 ，2：最近购买时间",
          "type": "string"
        },
        "start_date": {
          "description": "筛选开始时间",
          "type": "string"
        },
        "search_field": {
          "description": "支持搜索的字段 buyer_email、buyer_name",
          "type": "string"
        }
      }
    }
  },
  "customer_performance_notice_list": {
    "displayName": "查询业绩通知列表",
    "description": "业绩通知",
    "mode": "single",
    "scopeKey": "sid",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "end_date": {
          "description": "结束时间 YYYY-MM-DD",
          "type": "string"
        },
        "search_value": {
          "description": "搜索值",
          "type": "string"
        },
        "is_read": {
          "description": "是否已读，-1 全部，0 未读，1 已读",
          "type": "number"
        },
        "mail_tag_ids": {
          "description": "邮件标签 id",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "offset": {
          "description": "偏移量",
          "type": "number"
        },
        "length": {
          "description": "分页长度",
          "type": "number"
        },
        "sid": {
          "description": "店铺id",
          "type": "string"
        },
        "status": {
          "description": "处理状态：0（无），1（待处理），2（已处理），3（无需处理）",
          "type": "array",
          "items": {
            "type": "integer"
          }
        },
        "start_date": {
          "description": "开始时间 YYYY-MM-DD",
          "type": "string"
        },
        "search_field": {
          "description": "搜索字段,subject 邮件主题,content 邮件内容",
          "type": "string"
        }
      },
      "required": [
        "sid"
      ]
    }
  },
  "customer_store_target_detail": {
    "displayName": "查询店铺绩效详情",
    "description": "查询店铺绩效详情",
    "mode": "single",
    "scopeKey": "sid",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "pull_date": {
          "description": "报表更新日期，必填，日期格式：yyyy-MM-dd",
          "type": "string"
        },
        "sid": {
          "description": "店铺ID，必填",
          "type": "string"
        }
      },
      "required": [
        "pull_date",
        "sid"
      ]
    }
  },
  "customer_store_performance_list": {
    "displayName": "查询店铺绩效列表",
    "description": "用于查询店铺绩效列表。",
    "mode": "sids",
    "scopeKey": "sids",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "search_field_time": {
          "description": "搜索时间类型： pull_date 报表获取时间 update_date 更新时间",
          "type": "string"
        },
        "sids": {
          "description": "店铺id，多个使用英文逗号分隔 ，对应[查询亚马逊店铺列表](docs/BasicData/SellerLists)接口对应字段【sid】",
          "type": "string"
        },
        "offset": {
          "description": "分页偏移量，默认0",
          "type": "integer"
        },
        "length": {
          "description": "分页长度，默认20，上限200",
          "type": "integer"
        },
        "order_field": {
          "default": "update_date",
          "description": "排序字段：update_date 更新时间。",
          "type": "string",
          "enum": [
            "update_date"
          ]
        },
        "order_type": {
          "default": "desc",
          "description": "排序方向：desc 降序。",
          "type": "string",
          "enum": [
            "desc"
          ]
        },
        "search_time": {
          "description": "搜索时间，格式：Y-m-d",
          "type": "string"
        },
        "anomaly_indicator": {
          "description": "异常指标： commodity_policy_compliance 商品政策合规性 on_time_delivery 准时交货率 valid_tracking 有效追踪率 pre_fulfillment_cancellation 预配送取消率 late_shipment 迟发率 invoice_defect 发票缺陷率 fba_order_with_defect FBA订单缺陷率 order_with_defect FBM订单缺陷率",
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "order_field",
        "order_type"
      ]
    }
  },
  "customer_voice_buyer_list": {
    "displayName": "查询买家之声列表",
    "description": "用于查询买家之声列表。",
    "mode": "sids",
    "scopeKey": "storeIds",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "searchBlur": {
          "default": true,
          "description": "是否模糊搜索，取值为 true。",
          "type": "boolean",
          "enum": [
            true
          ]
        },
        "sortColumn": {
          "default": "eventDate",
          "description": "排序字段：eventDate 事件日期。",
          "type": "string",
          "enum": [
            "eventDate"
          ]
        },
        "fulfillmentChannel": {
          "description": "配送方式：FBA FBA；MFN FBM",
          "type": "string"
        },
        "searchField": {
          "description": "搜索类型：asin ASIN；msku MSKU；sku SKU",
          "type": "string"
        },
        "sortType": {
          "default": "desc",
          "description": "排序方向：desc 降序。",
          "type": "string",
          "enum": [
            "desc"
          ]
        },
        "pxcHealth": {
          "description": "满意度状况：-1 反馈不足；0 极差；1 不合格；2 一般；3 良好；4 极好",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "pageSize": {
          "default": 20,
          "description": "分页长度，默认 20，上限 200。",
          "maximum": 200,
          "type": "integer"
        },
        "returnBadge": {
          "description": "退货标记，Yes；No；At_Risk",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "pageNum": {
          "default": 1,
          "description": "分页页码，从 1 开始，默认 1。",
          "type": "integer",
          "minimum": 1
        },
        "searchValue": {
          "description": "搜索值",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "storeIds": {
          "description": "店铺id ，对应查询亚马逊店铺列表接口对应字段【sid】",
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "searchBlur",
        "sortColumn",
        "sortType"
      ]
    }
  },
  "erp_listing": {
    "displayName": "查询 Listing 列表",
    "description": "查询Listing列表，支持按MSKU/ASIN/SKU搜索，支持按店铺、状态、配送方式、分类、品牌、国家等筛选",
    "mode": "sids",
    "scopeKey": "sids",
    "inputSchema": {
      "type": "object",
      "properties": {
        "search_value": {
          "description": "搜索字段值，字符串数组；与 search_field 配合使用",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "on_sale_time_start": {
          "description": "开售时间-开始",
          "type": "string"
        },
        "principal_uids": {
          "description": "负责人ID，多个用逗号隔开",
          "type": "string"
        },
        "offset": {
          "default": 0,
          "description": "分页偏移量，起始为0",
          "type": "integer"
        },
        "length": {
          "default": 20,
          "description": "每页长度",
          "type": "integer"
        },
        "open_date_end": {
          "description": "创建时间-结束",
          "type": "string"
        },
        "on_sale_time_end": {
          "description": "开售时间-结束",
          "type": "string"
        },
        "exact_search": {
          "default": "0",
          "description": "是否精确搜索，0-模糊，1-精确",
          "type": "string"
        },
        "sids": {
          "description": "店铺ID，多个用逗号隔开",
          "type": "string"
        },
        "sort_type": {
          "description": "排序类型，desc-倒序，asc-正序",
          "type": "string"
        },
        "uid": {
          "description": "用户ID",
          "type": "string"
        },
        "fulfillment_channel_type": {
          "description": "配送方式，FBA或FBM",
          "type": "string"
        },
        "sort_field": {
          "description": "排序字段，可选值：msku, asin, parent_asin, local_sku, afn_fulfillable_quantity, seller_rank, review_num, open_date_time, status, total_volume, on_sale_time, yesterday_volume, seven_volume, fourteen_volume, thirty_volume 等",
          "type": "string"
        },
        "is_pair": {
          "description": "是否配对",
          "type": "string"
        },
        "open_date_start": {
          "description": "创建时间-开始",
          "type": "string"
        },
        "pvi_ids": {
          "description": "属性值ID，多个英文逗号隔开",
          "type": "string"
        },
        "mids": {
          "description": "国家ID，多个用逗号隔开",
          "type": "string"
        },
        "is_resale": {
          "description": "是否筛选重售商品，1-是，2-否",
          "type": "number"
        },
        "bid": {
          "description": "品牌ID，多个用逗号隔开",
          "type": "string"
        },
        "cid": {
          "description": "分类ID，多个用逗号隔开",
          "type": "string"
        },
        "search_field": {
          "description": "搜索字段，例如 msku-MSKU、brand-亚马逊品牌",
          "type": "string"
        },
        "status": {
          "description": "listing状态，多个用逗号隔开",
          "type": "string"
        }
      },
      "required": [
        "offset",
        "length",
        "pvi_ids"
      ]
    }
  },
  "finance_compare_trade_reconcile": {
    "displayName": "查询交易对账详情",
    "description": "用于获取对账详情。",
    "mode": "single",
    "scopeKey": "sid",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "countryCode": {
          "description": "国家类型",
          "type": "string"
        },
        "accountType": {
          "description": "交易报告类型 枚举值：PayWithAmazon 、All 、COD 、Electronic 、Invoiced 、Standard,可用值:All,COD,Electronic,Invoiced,PayWithAmazon,Standard",
          "type": "string"
        },
        "sid": {
          "description": "店铺id ，对应[查询亚马逊店铺列表](docs/BasicData/SellerLists)接口对应字段【sid】",
          "type": "string"
        },
        "postedDate": {
          "description": "月份",
          "type": "string"
        }
      },
      "required": [
        "sid",
        "postedDate",
        "accountType",
        "countryCode"
      ]
    }
  },
  "finance_list_trade_reconcile": {
    "displayName": "查询交易对账列表",
    "description": "用于获取交易对账列表。",
    "mode": "sids",
    "scopeKey": "sids",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "sids": {
          "description": "店铺id ，对应[查询亚马逊店铺列表](docs/BasicData/SellerLists)接口对应字段【sid】",
          "type": "string"
        },
        "countryCodes": {
          "description": "国家代码",
          "type": "string"
        },
        "month": {
          "description": "月份",
          "type": "string"
        },
        "offset": {
          "description": "偏移量",
          "type": "number"
        },
        "accountType": {
          "description": "币种",
          "type": "string"
        },
        "diffType": {
          "description": "枚举类型,可用值:DIFFERENT,EQUALS",
          "type": "number"
        },
        "length": {
          "description": "页长度",
          "type": "number"
        },
        "reconcileStatus": {
          "description": "对账结果 0未对账 1已对账,可用值:CHECKED,NO_CHECKED",
          "type": "string"
        },
        "currencyCode": {
          "description": "币种",
          "type": "string"
        }
      },
      "required": [
        "sids",
        "countryCodes",
        "accountType",
        "reconcileStatus",
        "diffType",
        "month",
        "offset",
        "length",
        "currencyCode"
      ]
    }
  },
  "finance_order_transcation_list": {
    "displayName": "查询订单维度利润交易明细",
    "description": "用于查询利润报表 - 订单维度transaction视图。",
    "mode": "sids",
    "scopeKey": "sids",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "offset": {
          "default": 0,
          "description": "分页偏移量，默认 0",
          "type": "integer",
          "minimum": 0
        },
        "searchField": {
          "default": "order_id",
          "description": "查询字段，默认 order_id",
          "type": "string",
          "enum": [
            "order_id",
            "seller_sku",
            "asin",
            "parent_asin",
            "local_sku",
            "local_name",
            "description",
            "settlement_id",
            "fid",
            "gmt_modified"
          ]
        },
        "endDate": {
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
          "description": "结束日期，格式 yyyy-MM-dd；与开始日期间隔不超过一年",
          "type": "string"
        },
        "transactionStatus": {
          "description": "交易状态明细；仅 orderStatus 为 DisbursedAndPreSettled 时可传，其他状态请省略",
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "Disbursed",
              "PreSettlement",
              "RegularSettlement",
              "PreSettlementReversal",
              "deferredReversal"
            ]
          }
        },
        "productDeveloperUids": {
          "description": "开发负责人用户 ID；未筛选时请省略，不能传 null",
          "type": "array",
          "items": {
            "type": "integer"
          }
        },
        "accountType": {
          "description": "账单类型；未筛选时请省略，不能传 null",
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "Standard",
              "Invoiced",
              "Electronic",
              "COD",
              "PayWithAmazon"
            ]
          }
        },
        "principalUids": {
          "description": "Listing 负责人用户 ID；未筛选时请省略，不能传 null",
          "type": "array",
          "items": {
            "type": "integer"
          }
        },
        "length": {
          "default": 20,
          "description": "分页长度，默认 20，上限 1000",
          "maximum": 1000,
          "type": "integer",
          "minimum": 1
        },
        "eventSource": {
          "description": "费用类型；未筛选时请省略，不能传 null",
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "A-to-z Guarantee Claim",
              "AdhocDisbursement",
              "Adjustment",
              "AdjustmentEventList",
              "AffordabilityExpense",
              "AffordabilityExpenseReversal",
              "Cancellation",
              "CapacityReservationBilling",
              "Chargeback Refund",
              "ChargebackEventList",
              "Debt",
              "FBA Customer Return Fee",
              "FBA Inventory Fee",
              "Fee Adjustment",
              "GuaranteeClaimEventList",
              "Lightning Deal Fee",
              "Liquidations",
              "Liquidations Adjustments",
              "LoanServicing",
              "NetworkComminglingTransaction",
              "Order",
              "OrderCancellationCharge",
              "Order_Retrocharge",
              "PayWithAmazon",
              "Refund",
              "SAFETReimbursement",
              "Service Fee",
              "ServiceFeeEventList",
              "ShipmentSettleEventList",
              "Shipping Services",
              "TBYB Order Payment",
              "TBYB Trial Shipment",
              "TDSReimbursement",
              "TaxWithholding",
              "Transfer",
              "ValueAddedServiceCharge",
              "other-transaction"
            ]
          }
        },
        "fundTransferStatus": {
          "description": "转账状态；未筛选时请省略，不能传 null",
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "Succeeded",
              "Processing",
              "Failed",
              "Unknown"
            ]
          }
        },
        "orderStatus": {
          "default": "Disbursed",
          "description": "交易状态；Deferred 仅在结束日期为当天时可查询已推迟数据",
          "type": "string",
          "enum": [
            "Deferred",
            "Disbursed",
            "DisbursedAndPreSettled",
            "All"
          ]
        },
        "sids": {
          "description": "店铺 ID；未筛选时请省略，不能传 null",
          "type": "array",
          "items": {
            "type": "integer"
          }
        },
        "searchDateField": {
          "default": "posted_date_locale",
          "description": "时间筛选类型，默认按结算时间筛选",
          "type": "string",
          "enum": [
            "posted_date_locale",
            "fund_transfer_datetime_locale",
            "shipment_datetime_locale",
            "order_datetime_locale",
            "accounting_time",
            "gmt_modified"
          ]
        },
        "settlementStatus": {
          "description": "结算状态；未筛选时请省略，不能传 null",
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "Open",
              "Pending",
              "Closed",
              "Reconciled"
            ]
          }
        },
        "sortType": {
          "default": "desc",
          "description": "排序方式，默认 desc",
          "type": "string",
          "enum": [
            "asc",
            "desc"
          ]
        },
        "mids": {
          "description": "站点 ID；未筛选时请省略，不能传 null",
          "type": "array",
          "items": {
            "type": "integer"
          }
        },
        "sortField": {
          "default": "postedDatetimeLocale",
          "description": "排序字段，默认 postedDatetimeLocale",
          "type": "string"
        },
        "gmtModifiedEndDate": {
          "pattern": "^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$",
          "description": "修改结束时间，格式 yyyy-MM-dd HH:mm:ss；需与修改开始时间同时传或同时省略",
          "type": "string"
        },
        "gmtModifiedStartDate": {
          "pattern": "^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$",
          "description": "修改开始时间，格式 yyyy-MM-dd HH:mm:ss；需与修改结束时间同时传或同时省略",
          "type": "string"
        },
        "fulfillment": {
          "description": "订单类型；未筛选时请省略，不能传 null",
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "FBA",
              "FBM"
            ]
          }
        },
        "currencyCode": {
          "default": "",
          "description": "货币种类；默认原币种",
          "type": "string",
          "enum": [
            "",
            "原币种",
            "CNY",
            "USD",
            "EUR",
            "JPY",
            "AUD",
            "CAD",
            "MXN",
            "GBP",
            "INR",
            "AED",
            "SGD",
            "SAR",
            "BRL",
            "SEK",
            "PLN",
            "TRY",
            "HKD"
          ]
        },
        "searchValue": {
          "description": "查询字段值；未筛选时请省略，不能传 null",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "startDate": {
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
          "description": "开始日期，格式 yyyy-MM-dd",
          "type": "string"
        }
      },
      "required": [
        "startDate",
        "endDate",
        "searchDateField"
      ]
    }
  },
  "finance_page_list_msku": {
    "displayName": "查询 MSKU 维度订单利润",
    "description": "查询MSKU维度订单利润。使用流程：1. 调用 settings_get_statistics_storage_fee_config，读取 data.value 作为 stock_fee_config；2. 调用 settings_get_statistics_refund_config，读取 data.value 作为 purchase_status；3. 将两个值和固定 summary_field=msku 作为本工具参数传入。",
    "mode": "sids",
    "scopeKey": "sids",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "sids": {
          "description": "店铺id，对应查询亚马逊店铺列表接口对应字段sid",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "end_date": {
          "description": "查询时间，双闭区间，格式：Y-m-d 或 Y-m-d H:i:s",
          "type": "string"
        },
        "search_value": {
          "description": "搜索的值",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "summary_field": {
          "default": "msku",
          "description": "利润汇总维度：msku。",
          "type": "string",
          "enum": [
            "msku"
          ]
        },
        "offset": {
          "default": 0,
          "description": "分页偏移量，默认0",
          "type": "integer",
          "minimum": 0
        },
        "stock_fee_config": {
          "default": "0",
          "description": "仓储费计算配置：0 计算；1 不计算。",
          "type": "string"
        },
        "currency_type": {
          "default": "",
          "description": "币种code【默认原币种】, 可选值：原币种,CNY,USD,EUR,JPY,AUD,CAD,MXN,GBP,INR,AED,SGD,SAR,BRL,SEK,PLN,TRY,HKD",
          "type": "string",
          "enum": [
            "",
            "原币种",
            "CNY",
            "USD",
            "EUR",
            "JPY",
            "AUD",
            "CAD",
            "MXN",
            "GBP",
            "INR",
            "AED",
            "SGD",
            "SAR",
            "BRL",
            "SEK",
            "PLN",
            "TRY",
            "HKD"
          ]
        },
        "purchase_status": {
          "default": "0",
          "description": "退款计算的下单状态：0 关闭；1 开启。",
          "type": "string"
        },
        "length": {
          "default": 20,
          "description": "分页长度，默认20，上限5000",
          "maximum": 5000,
          "type": "integer",
          "minimum": 1
        },
        "start_date": {
          "description": "查询时间，双闭区间，格式：Y-m-d 或 Y-m-d H:i:s",
          "type": "string"
        },
        "search_field": {
          "default": "seller_sku",
          "description": "搜索值类型，可选值：seller_sku、asin、local_name、local_sku",
          "type": "string",
          "enum": [
            "seller_sku",
            "asin",
            "local_name",
            "local_sku"
          ]
        }
      },
      "required": [
        "end_date",
        "purchase_status",
        "start_date",
        "stock_fee_config",
        "summary_field"
      ]
    }
  },
  "finance_settlement_profit_list": {
    "displayName": "查询利润报表明细",
    "description": "用于利润报表-明细列表查询。",
    "mode": "sids",
    "scopeKey": "sids",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "orderSearchField": {
          "description": "单据筛选字段： 1=平台订单号 2=平台子单号 3=备货单号 4=业务单号 5=运单号 6=包裹",
          "type": "integer"
        },
        "queryMode": {
          "description": "查询模式： 1=列表 2=明细",
          "type": "integer"
        },
        "searchField": {
          "description": "商品筛选字段： 1=MSKU 2=MSKU ID 3=品名 4=系统SKU",
          "type": "integer"
        },
        "endDate": {
          "description": "结束日期 yyyy-MM-dd",
          "type": "string"
        },
        "developers": {
          "description": "开发人UID列表",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "transactionTypes": {
          "description": "交易类型： order=销售 refund=退款 return=退货 manual=手工 reshipment=补发 manual_add=加购 other=其他",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "pageSize": {
          "description": "每页大小，默认20，最大200",
          "type": "integer"
        },
        "areas": {
          "description": "站点/区域列表",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "sids": {
          "description": "店铺ID列表",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "searchValues": {
          "description": "商品筛选值列表，支持批量搜索",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "hasOriginalOrder": {
          "description": "有无源单，仅汇总维度为订单时生效： 1=有源单 0=无源单 不传则不过滤",
          "type": "integer"
        },
        "sortField": {
          "description": "排序字段",
          "type": "string"
        },
        "currency": {
          "description": "币种，默认为空展示原币种",
          "type": "string"
        },
        "categories": {
          "description": "分类ID列表",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "fulfilmentTypes": {
          "description": "发货类型筛选，仅汇总维度为订单(summaryField=1)时生效： 1=自发货 2=平台发货 3=部分自发货",
          "type": "array",
          "items": {
            "type": "integer"
          }
        },
        "brands": {
          "description": "品牌ID列表",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "summaryType": {
          "description": "时间汇总维度，仅非订单维度(summaryField!=1)时生效： null/0=默认（不按时间聚合） 1=按月 2=按天 3=按周",
          "type": "integer"
        },
        "orderSearchValues": {
          "description": "单据筛选值列表，支持批量搜索",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "countries": {
          "description": "国家列表",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "summaryField": {
          "description": "汇总维度： 1=订单 2=店铺 3=MSKU 4=SKU 5=开发者 6=负责人 11=SPU",
          "type": "string"
        },
        "pageNum": {
          "description": "当前页码，默认1",
          "type": "integer"
        },
        "sortType": {
          "description": "排序类型：asc升序、desc降序",
          "type": "string"
        },
        "platformCodes": {
          "description": "平台代码列表： 10002=Shopify 10003=eBay 10006=Shopee 10008=Walmart 10011=TikTok 10012=MercadoLibre 10021=SHEIN平台模式 10028=SHEIN半托管 10007=Lazada 10024=Temu半托管 10022=Temu全托管 10027=SHEIN代运营",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "dateRangeType": {
          "description": "日期范围类型： 0=结算时间 1=下单时间 默认为0",
          "type": "integer"
        },
        "startDate": {
          "description": "开始日期 yyyy-MM-dd",
          "type": "string"
        }
      },
      "required": [
        "pageNum",
        "pageSize",
        "summaryField"
      ]
    }
  },
  "get_fba_stock_list": {
    "displayName": "查询 FBA 仓库库存",
    "description": "查询FBA仓库库存列表，支持按SKU/品名/SPU/FNSKU搜索，支持按仓库、店铺、配送方式筛选",
    "mode": "sids",
    "scopeKey": "sid",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "search_value": {
          "description": "搜索值",
          "type": "string"
        },
        "asin_principal": {
          "description": "Listing负责人uid，对应[查询ERP用户信息列表](docs/BasicData/AccoutLists)uid字段 多个使用,分隔",
          "type": "string"
        },
        "is_hide_zero_stock": {
          "description": "是否隐藏零库存行: 0 不隐藏零库存行 1 隐藏零库存行",
          "type": "string"
        },
        "offset": {
          "description": "分页偏移量，默认0",
          "type": "integer"
        },
        "senior_search_list": {
          "description": "高级搜索列表，详情见附加说明",
          "type": "string"
        },
        "is_parant_asin_merge": {
          "description": "是否合并父ASIN: 0 不合并父ASIN 1 合并父ASIN",
          "type": "string"
        },
        "length": {
          "description": "分页长度，默认20，仅支持20、50、100、200、500、1000、2000、5000",
          "type": "integer"
        },
        "is_cost_page": {
          "default": 0,
          "description": "成本页面标识，默认 0。",
          "type": "integer"
        },
        "sid": {
          "description": "店铺id（支持多个，使用,分隔）",
          "type": "string"
        },
        "fulfillment_channel_type": {
          "description": "配送方式: FBA FBM",
          "type": "string"
        },
        "attribute": {
          "description": "属性",
          "type": "string"
        },
        "bid": {
          "description": "品牌",
          "type": "string"
        },
        "is_contain_del_ls": {
          "description": "是否显示已删除Listing: 0 不显示已删除Listing 1 显示已删除Listing",
          "type": "string"
        },
        "search_field": {
          "description": "搜索维度: sku product_name seller_sku fnsku asin parent_asin spu spu_name",
          "type": "string"
        },
        "cid": {
          "description": "分类",
          "type": "string"
        },
        "status": {
          "description": "在售状态: 0 停售 1 在售",
          "type": "string"
        },
        "query_fba_storage_quantity_list": {
          "default": false,
          "description": "true 是、false 否；默认false，如果传入true,则出参数据中的欧洲共享仓会将出参字段-fba_storage_quantity_list的值返回",
          "type": "boolean"
        }
      }
    }
  },
  "query_product_performance_asin_lists": {
    "displayName": "查询 ASIN 维度产品表现",
    "description": "查询产品表现ASIN列表，支持按SPU/ASIN/MSKU/SKU搜索，支持按国家、店铺、日期筛选，支持多维度汇总和筛选（品牌、分类、负责人、配送方式、促销、标签等）",
    "mode": "sids",
    "scopeKey": "sids",
    "inputSchema": {
      "type": "object",
      "properties": {
        "end_date": {
          "description": "结束日期，格式yyyy-MM-dd",
          "type": "string"
        },
        "date_type": {
          "default": "purchase",
          "description": "时间筛选类型，purchase-下单时间，settlement-结算时间",
          "type": "string",
          "enum": [
            "purchase",
            "settlement"
          ]
        },
        "date_view_type": {
          "description": "日期维度展示，可选值：day-日, week-周, month-月",
          "type": "string"
        },
        "regions": {
          "default": [],
          "description": "区域列表",
          "type": "array"
        },
        "summary_field": {
          "default": "asin",
          "description": "汇总行维度，可选值：asin, parent_asin, msku, sku, spu",
          "type": "string",
          "enum": [
            "asin",
            "parent_asin",
            "msku",
            "sku",
            "spu"
          ]
        },
        "developers": {
          "default": [],
          "description": "开发人员列表",
          "type": "array"
        },
        "gtag_ids": {
          "default": [],
          "description": "商品标签ID列表",
          "type": "array"
        },
        "purchase_status": {
          "default": 0,
          "description": "采购状态，0-全部",
          "type": "integer"
        },
        "sub_summary_type": {
          "description": "Tab下子汇总行维度，可选值：category, listing_tag, asin, sku",
          "type": "string"
        },
        "first_order_start_time": {
          "description": "首单开始时间",
          "type": "string"
        },
        "first_order_end_time": {
          "description": "首单结束时间",
          "type": "string"
        },
        "currency_code": {
          "default": "CNY",
          "description": "货币，如CNY、USD",
          "type": "string"
        },
        "date_range_type": {
          "default": 0,
          "description": "日期范围类型，0-自定义",
          "type": "integer"
        },
        "date_view_order_type": {
          "description": "分组类型，1-按时间分组，2-按ASIN分组，0-不分组",
          "type": "integer"
        },
        "sids": {
          "default": "",
          "description": "店铺ID，多个用逗号隔开",
          "type": "string"
        },
        "owner_uids": {
          "default": [],
          "description": "负责人UID列表",
          "type": "array"
        },
        "mids": {
          "default": "",
          "description": "国家ID，多个用逗号隔开",
          "type": "string"
        },
        "is_resale": {
          "default": "",
          "description": "是否筛选重售商品",
          "type": "string"
        },
        "product_states": {
          "default": [],
          "description": "产品状态列表",
          "type": "array"
        },
        "summary_field_level2": {
          "default": "",
          "description": "自定义维度第二个下拉框，可选值：country, mid",
          "type": "string"
        },
        "cids": {
          "default": [],
          "description": "分类ID列表",
          "type": "array"
        },
        "summary_field_level1": {
          "default": "asin",
          "description": "自定义维度第一个下拉框，可选值：asin, parent_asin, msku, spu, sku, principal, developer",
          "type": "string"
        },
        "ad_cost_type": {
          "default": "",
          "description": "广告费用类型",
          "type": "string"
        },
        "start_date": {
          "description": "开始日期，格式yyyy-MM-dd",
          "type": "string"
        },
        "delivery_methods": {
          "default": [],
          "description": "配送方式列表，如FBA、FBM",
          "type": "array"
        },
        "search_value": {
          "default": [],
          "description": "搜索值，数组格式",
          "type": "array"
        },
        "is_recently_enum": {
          "default": false,
          "description": "是否仅查询近期数据",
          "type": "boolean"
        },
        "principal_uids": {
          "default": [],
          "description": "负责人UID列表",
          "type": "array"
        },
        "turn_on_summary": {
          "default": 1,
          "description": "是否开启汇总，1-开启 0-不开启，SKU维度请设置为1",
          "type": "integer"
        },
        "offset": {
          "default": 0,
          "description": "分页偏移量，起始为0",
          "type": "integer"
        },
        "parent_key": {
          "description": "需要展开时填入",
          "type": "string"
        },
        "date_sort_type": {
          "description": "时间排序方式，desc-倒序，asc-正序",
          "type": "string"
        },
        "listing_end_cdate": {
          "description": "Listing创建结束时间",
          "type": "string"
        },
        "order_types": {
          "default": [],
          "description": "订单类型列表",
          "type": "array"
        },
        "length": {
          "default": 20,
          "description": "每页长度",
          "type": "integer"
        },
        "auto_tags": {
          "default": [],
          "description": "自动标签列表",
          "type": "array"
        },
        "listing_start_cdate": {
          "description": "Listing创建开始时间",
          "type": "string"
        },
        "sort_type": {
          "default": "desc",
          "description": "排序类型，desc-倒序，asc-正序",
          "type": "string",
          "enum": [
            "desc",
            "asc"
          ]
        },
        "is_grandchild": {
          "description": "展开级别，0-第一级展开，1-第二级展开",
          "type": "integer"
        },
        "promotions": {
          "default": [],
          "description": "促销活动列表",
          "type": "array"
        },
        "extend_search": {
          "default": [],
          "description": "扩展搜索条件",
          "type": "array"
        },
        "sort_field": {
          "default": "volume",
          "description": "排序字段，可选值：volume-销量, sales_amount-销售额, profit-利润, order_num-订单数, msku, asin, parent_asin, local_sku",
          "type": "string"
        },
        "query_order_profit": {
          "default": false,
          "description": "是否查询订单利润",
          "type": "boolean"
        },
        "only_query_today": {
          "default": false,
          "description": "是否仅查询今天数据",
          "type": "boolean"
        },
        "bids": {
          "default": [],
          "description": "品牌ID列表",
          "type": "array"
        },
        "attr_value_ids": {
          "default": [],
          "description": "属性值ID列表",
          "type": "array"
        },
        "search_field": {
          "default": "asin",
          "description": "搜索字段，可选值：spu, spu_name, model, parent_asin, asin, msku, item_name, local_sku, local_name",
          "type": "string",
          "enum": [
            "spu",
            "spu_name",
            "model",
            "parent_asin",
            "asin",
            "msku",
            "item_name",
            "local_sku",
            "local_name"
          ]
        }
      },
      "required": [
        "offset",
        "length"
      ]
    }
  },
  "sales_adjust_price_manual": {
    "displayName": "查询调价队列",
    "description": "用于查询调价队列。",
    "mode": "sids",
    "scopeKey": "sid",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "search_value": {
          "description": "搜索值，msku和asin支持多个搜索，数组",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "start_time": {
          "description": "开始时间",
          "type": "string"
        },
        "time_type": {
          "description": "搜索时间类型：1创建时间 2完成时间",
          "type": "number",
          "enum": [
            1,
            2
          ]
        },
        "offset": {
          "description": "偏移量",
          "type": "number"
        },
        "length": {
          "description": "页长度，上限500",
          "maximum": 500,
          "type": "number"
        },
        "end_time": {
          "description": "结束时间",
          "type": "string"
        },
        "processing_status": {
          "description": "调价状态，支持多选，数组 1待调价 2调价中 3调价成功 4调价失败 5审批中 6已驳回 7已作废",
          "type": "array",
          "items": {
            "type": "integer",
            "enum": [
              1,
              2,
              3,
              4,
              5,
              6,
              7
            ]
          }
        },
        "tab_status": {
          "default": 0,
          "description": "tab状态栏  0全部 1待审批 2调价中 3成功 4失败 5已作废 默认0",
          "type": "number",
          "enum": [
            0,
            1,
            2,
            3,
            4,
            5
          ]
        },
        "sid": {
          "description": "搜索店铺id",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "search_field": {
          "description": "搜索字段：msku，asin",
          "type": "string",
          "enum": [
            "msku",
            "asin"
          ]
        }
      },
      "required": [
        "offset",
        "length"
      ]
    }
  },
  "sales_operate_log_list": {
    "displayName": "查询 Listing 操作日志",
    "description": "用于查询Listing操作日志列表。",
    "mode": "single",
    "scopeKey": "store_id",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "store_id": {
          "description": "店铺id ，对应查询亚马逊店铺列表接口对应字段【sid】",
          "type": "string"
        },
        "operate_type": {
          "description": "操作类型： 1 调价 ； 2 调库存 ； 3 修改标题 ； 4 编辑商品 ； 5 B2B调价",
          "type": "array",
          "items": {
            "type": "integer"
          }
        },
        "msku": {
          "description": "MSKU（卖家在线商品sku）",
          "type": "string"
        },
        "offset": {
          "description": "分页偏移量，默认0",
          "type": "integer"
        },
        "length": {
          "description": "分页长度，默认20",
          "type": "integer"
        },
        "operate_time_start": {
          "description": "开始时间【操作时间】，格式：Y-m-d H:i:s",
          "type": "string"
        },
        "operate_time_end": {
          "description": "结束时间【操作时间】，格式：Y-m-d H:i:s",
          "type": "string"
        },
        "operate_uid": {
          "description": "操作人id列表",
          "type": "array",
          "items": {
            "type": "integer"
          }
        }
      },
      "required": [
        "msku",
        "store_id"
      ]
    }
  },
  "sales_detail_prime_discount": {
    "displayName": "查询商品折扣详情-列表-优惠券",
    "description": "查询商品折扣详情-列表-优惠券",
    "mode": "single",
    "scopeKey": "storeId",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "promotionType": {
          "description": "促销类型",
          "type": "array"
        },
        "sortType": {
          "description": "排序类型 asc desc",
          "type": "string",
          "enum": [
            "asc",
            "desc"
          ]
        },
        "sortField": {
          "description": "排序项（\"cost\", \"drawQuantity\", \"exchangeQuantity\", \"exchangeRate\",\"startTime\",\"salesVolume\",\"salesAmount\",\"startTime\"）",
          "type": "string",
          "enum": [
            "cost",
            "drawQuantity",
            "exchangeQuantity",
            "exchangeRate",
            "startTime",
            "salesVolume",
            "salesAmount"
          ]
        },
        "pageSize": {
          "description": "分页大小",
          "type": "number"
        },
        "startTime": {
          "description": "活动开始时间",
          "type": "string"
        },
        "sellerSku": {
          "description": "在线商品SKU（MSKU）",
          "type": "string"
        },
        "endTime": {
          "description": "活动结束时间",
          "type": "string"
        },
        "storeId": {
          "description": "店铺id",
          "type": "string"
        },
        "pageNum": {
          "description": "分页页码",
          "type": "number"
        },
        "status": {
          "description": "促销状态： 0 其他 1 进行中 2 已过期 3 未开始",
          "type": "array",
          "items": {
            "type": "integer",
            "enum": [
              0,
              1,
              2,
              3
            ]
          }
        }
      },
      "required": [
        "sellerSku",
        "storeId",
        "startTime",
        "endTime",
        "sortField",
        "sortType",
        "pageNum",
        "pageSize"
      ]
    }
  },
  "sales_detail_sec_kill": {
    "displayName": "查询商品秒杀详情",
    "description": "查询商品折扣详情-列表-秒杀。",
    "mode": "single",
    "scopeKey": "storeId",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "promotionType": {
          "description": "促销类型",
          "type": "array"
        },
        "sortType": {
          "description": "排序类型 asc desc",
          "type": "string",
          "enum": [
            "asc",
            "desc"
          ]
        },
        "sortField": {
          "description": "排序项（\"cost\", \"drawQuantity\", \"exchangeQuantity\", \"exchangeRate\",\"startTime\",\"salesVolume\",\"salesAmount\",\"startTime\"）",
          "type": "string",
          "enum": [
            "cost",
            "drawQuantity",
            "exchangeQuantity",
            "exchangeRate",
            "startTime",
            "salesVolume",
            "salesAmount"
          ]
        },
        "pageSize": {
          "description": "分页大小",
          "type": "number"
        },
        "startTime": {
          "description": "活动开始时间",
          "type": "string"
        },
        "sellerSku": {
          "description": "在线商品SKU（MSKU）",
          "type": "string"
        },
        "endTime": {
          "description": "活动结束时间",
          "type": "string"
        },
        "storeId": {
          "description": "店铺id",
          "type": "string"
        },
        "pageNum": {
          "description": "分页页码",
          "type": "number"
        },
        "status": {
          "description": "促销状态",
          "type": "array"
        }
      },
      "required": [
        "sellerSku",
        "storeId",
        "startTime",
        "endTime",
        "sortField",
        "sortType",
        "pageNum",
        "pageSize"
      ]
    }
  },
  "sales_promotional_listing_detail": {
    "displayName": "查询商品管理促销详情",
    "description": "查询商品折扣详情-列表-管理促销。",
    "mode": "single",
    "scopeKey": "storeId",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "promotionType": {
          "description": "促销类型",
          "type": "array"
        },
        "sortType": {
          "description": "排序类型：asc升序，desc降序",
          "type": "string",
          "enum": [
            "asc",
            "desc"
          ]
        },
        "sortField": {
          "description": "排序项：cost、drawQuantity、exchangeQuantity、exchangeRate、startTime、salesVolume、salesAmount",
          "type": "string",
          "enum": [
            "cost",
            "drawQuantity",
            "exchangeQuantity",
            "exchangeRate",
            "startTime",
            "salesVolume",
            "salesAmount"
          ]
        },
        "pageSize": {
          "description": "分页大小",
          "type": "number"
        },
        "startTime": {
          "description": "活动开始时间，格式yyyy-MM-dd",
          "type": "string"
        },
        "sellerSku": {
          "description": "seller_sku(msku)",
          "type": "string"
        },
        "endTime": {
          "description": "活动结束时间，格式yyyy-MM-dd",
          "type": "string"
        },
        "storeId": {
          "description": "店铺id",
          "type": "string"
        },
        "pageNum": {
          "description": "分页页码",
          "type": "number"
        },
        "status": {
          "description": "促销状态",
          "type": "array"
        }
      },
      "required": [
        "sellerSku",
        "storeId",
        "startTime",
        "endTime",
        "sortField",
        "sortType",
        "pageNum",
        "pageSize"
      ]
    }
  },
  "settings_message_seller_list": {
    "displayName": "查询卖家预警消息",
    "description": "查询预警消息列表(卖家维度)",
    "mode": "sids",
    "scopeKey": "sidList",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "modelIdList": {
          "description": "预警模型：1 Listing调价预警；2 FBA费变更预警；3 Listing下架预警；6 FBA费异常预警；7折扣异常预警；18业务指标预警；20折扣叠加预警；21 buybox丢失预警；26父ASIN变更预警",
          "type": "array",
          "items": {
            "description": "预警模型：1 Listing调价预警；2 FBA费变更预警；3 Listing下架预警；6 FBA费异常预警；7折扣异常预警；18业务指标预警；20折扣叠加预警；21 buybox丢失预警；26父ASIN变更预警。允许值：1、2、3、6、7、18、20、21、26。",
            "type": "integer",
            "enum": [
              1,
              2,
              3,
              6,
              7,
              18,
              20,
              21,
              26
            ]
          }
        },
        "current": {
          "default": 1,
          "description": "当前页码，默认1",
          "type": "integer"
        },
        "sidList": {
          "description": "店铺id数组，查询亚马逊店铺列表接口返回的sid",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "size": {
          "default": 50,
          "description": "分页长度，默认50，上限200",
          "maximum": 200,
          "type": "integer"
        },
        "ruleName": {
          "description": "规则名称搜索值",
          "type": "string"
        },
        "showStatus": {
          "description": "处理状态：0待处理；1全部",
          "type": "integer",
          "enum": [
            0,
            1
          ]
        },
        "startTime": {
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
          "description": "开始日期【提醒时间】，闭区间，格式Y-m-d，时间间隔最长不超过90天",
          "type": "string"
        },
        "selectType": {
          "default": 0,
          "description": "预警类型，固定传0：商品预警",
          "type": "integer",
          "enum": [
            0
          ]
        },
        "asin": {
          "description": "ASIN搜索值",
          "type": "string"
        },
        "endTime": {
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
          "description": "结束日期【提醒时间】，闭区间，格式Y-m-d，时间间隔最长不超过90天",
          "type": "string"
        },
        "sellerSku": {
          "description": "MSKU搜索值",
          "type": "string"
        }
      },
      "required": [
        "showStatus",
        "startTime",
        "endTime",
        "selectType"
      ]
    }
  },
  "platform_v2_page_list": {
    "displayName": "查询销量统计列表",
    "description": "用于查询销量统计列表v2。",
    "mode": "sids",
    "scopeKey": "sids",
    "inputSchema": {
      "additionalProperties": false,
      "type": "object",
      "properties": {
        "sids": {
          "description": "店铺id，多个使用英文逗号分隔。如果id属于亚马逊店铺id，则对应查询亚马逊店铺列表接口对应字段【sid】 ；如果id属于多平台店铺id，则对应查询多平台店铺信息接口对应字段【store_id】",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "searchType": {
          "default": 3,
          "description": "搜索查询类型，默认 3。",
          "type": "integer",
          "enum": [
            3
          ]
        },
        "dataType": {
          "description": "统计数据维度：1 ASIN ；2 父体 ；3 MSKU ；4 SKU ；5 SPU ；6 店铺",
          "type": "string",
          "enum": [
            "1",
            "2",
            "3",
            "4",
            "5",
            "6"
          ]
        },
        "start": {
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
          "description": "开始日期【下单时间】，格式：Y-m-d，时间间隔最长不超过90天",
          "type": "string"
        },
        "dateUnit": {
          "description": "统计时间指标：1-年，2-月，3-周，4-日。",
          "type": "string",
          "enum": [
            "1",
            "2",
            "3",
            "4"
          ]
        },
        "pageSize": {
          "description": "分页大小，默认20",
          "type": "integer"
        },
        "end": {
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
          "description": "结束日期【下单时间】，格式：Y-m-d，时间间隔最长不超过90天",
          "type": "string"
        },
        "resultType": {
          "description": "汇总类型：1-销量，2-订单量，3-销售额。",
          "type": "string",
          "enum": [
            "1",
            "2",
            "3"
          ]
        },
        "pageNum": {
          "description": "分页页码，默认1",
          "type": "integer",
          "minimum": 1
        },
        "currencyCode": {
          "default": "",
          "description": "币种代码，空字符串表示原币种。",
          "type": "string",
          "enum": [
            ""
          ]
        }
      },
      "required": [
        "currencyCode",
        "dataType",
        "dateUnit",
        "end",
        "resultType",
        "searchType",
        "start"
      ]
    }
  }
};
