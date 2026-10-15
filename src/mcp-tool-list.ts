export const nativeReadOnlyMcpTools = {
  lingxing: ['help', 'search'],
  sif: [
    'market_get_keyword_history', 'market_get_keyword_root_trend', 'ads_get_campaign_structure',
    'ads_get_asin_campaign_contribution_overview', 'ads_get_ad_group_keyword_breakdown', 'ops_get_asin_traffic_trend',
    'market_estimate_profit_threshold', 'ads_get_ad_group_traffic_trend', 'sif_catalog',
    'market_get_keyword_root_competitors', 'ops_get_asin_sales_trend', 'ads_get_asin_ad_historical_feature_profile',
    'ads_get_asin_ad_structure', 'market_get_keyword_competition', 'ads_get_asin_ad_feature_profile',
    'analyze_traffic_anomaly', 'market_screen_keyword_opportunities', 'ops_get_listing_traffic_overview',
    'ads_get_campaign_traffic_trend', 'market_get_keyword_demand', 'ads_get_asin_ad_traffic_trend',
    'market_get_asin_aba_footprint', 'ads_get_asin_ad_window_feature_profile', 'ops_get_asin_sales_list',
    'ads_get_campaign_contribution_breakdown', 'market_discover_competitors', 'market_assess_keyword_promotion',
    'ops_get_asin_traffic_trend_detail', 'market_get_asin_keyword_signals', 'ping', 'market_get_asin_profile',
    'ops_get_listing_keyword_distribution', 'ops_get_listing_traffic_structure', 'ads_get_asin_campaign_changes'
  ]
} as const;

export { LINGXING_SCOPED_READ_TOOLS } from './lingxing-scoped-read.js';
