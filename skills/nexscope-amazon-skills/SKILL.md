---
name: nexscope-amazon-skills
description: |
  Comprehensive Amazon seller toolkit — 53 specialized sub-skills covering the
  full seller lifecycle: product research, keyword mining, listing optimization,
  FBA fee calculation, PPC campaign management, competitor monitoring, pricing
  strategy, brand building, and international expansion. Supports 12 Amazon
  marketplaces (US/UK/DE/FR/IT/ES/JP/CA/AU/IN/MX/BR). No API keys required.
  Route to the right sub-skill based on the seller's current task.

  Provenance: https://github.com/nexscope-ai/Amazon-Skills (53 individual
  SKILL.md files by nexscope-ai, MIT license).
---

# Amazon Seller Toolkit by Nexscope

A unified entry point for 53 Amazon seller sub-skills. Identify the seller's
task, route to the right sub-skill, and deliver actionable output.

## When to use this skill

Use when the user has any Amazon selling question: product viability, keyword
research, listing copy, FBA fees, advertising, competitor tracking, pricing,
brand protection, inventory, compliance, or international expansion.

## Required inputs

- **Task description** — what the seller wants to accomplish (e.g. "audit my
  listing for keyword gaps", "calculate FBA fees for my product", "build a PPC
  campaign structure")
- **Supporting material** (optional) — product details, ASINs, keyword lists,
  search term reports, competitor URLs, or Seller Central exports

## Routing table

Match the user's intent to the correct sub-skill domain. When the task spans
multiple domains, start with the most upstream one (research before listing,
listing before ads).

### Product Research and Keywords

| Sub-skill | Route when | Source |
|-----------|-----------|--------|
| amazon-keyword-research | Keyword mining, autocomplete extraction, opportunity scoring | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-keyword-research/SKILL.md) |
| amazon-trending-products | Trending products, rising categories, BSR movers | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-trending-products/SKILL.md) |
| amazon-product-research | Product viability, demand/competition/profit assessment | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-product-research/SKILL.md) |
| amazon-niche-finder | Niche discovery, underserved segments, entry barriers | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-niche-finder/SKILL.md) |
| amazon-seller-analytics | Competitor storefront analysis, revenue estimation | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-seller-analytics/SKILL.md) |

### Competitor Analysis

| Sub-skill | Route when | Source |
|-----------|-----------|--------|
| amazon-competitor-analysis | Full-spectrum competitor comparison — listings, pricing, reviews, ads | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-competitor-analysis/SKILL.md) |
| amazon-competitor-monitoring | Ongoing competitor tracking — price changes, inventory, new launches | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-competitor-monitoring/SKILL.md) |
| amazon-brand-analytics | Brand Analytics interpretation — SFR, Market Basket, Item Comparison | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-brand-analytics/SKILL.md) |
| amazon-review-analyzer | Review sentiment, complaints, feature requests, competitive insights | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-review-analyzer/SKILL.md) |

### Pricing and Profitability

| Sub-skill | Route when | Source |
|-----------|-----------|--------|
| amazon-fba-calculator | FBA fee breakdown — referral, fulfillment, storage, net margin | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-fba-calculator/SKILL.md) |
| tariff-calculator-amazon | Import duties, landed costs, VAT/GST for international sourcing | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/tariff-calculator-amazon/SKILL.md) |
| amazon-profit-analyzer | Revenue waterfall, hidden fees, ACoS impact, return costs | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-profit-analyzer/SKILL.md) |
| amazon-repricing-strategy | Dynamic repricing, Buy Box optimization, margin protection | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-repricing-strategy/SKILL.md) |
| amazon-buy-box | Buy Box eligibility, competitive pricing, FBA vs FBM impact | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-buy-box/SKILL.md) |
| amazon-deal-finder | Deal planning — Lightning, Best Deals, Coupons, Prime Exclusive | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-deal-finder/SKILL.md) |
| amazon-shipping-calculator | FBA/FBM shipping costs, dimensional weight, storage, removal fees | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-shipping-calculator/SKILL.md) |

### Advertising

| Sub-skill | Route when | Source |
|-----------|-----------|--------|
| amazon-ppc-campaign | PPC campaign structure, ACoS targets, keyword grouping, bid strategy | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-ppc-campaign/SKILL.md) |
| amazon-advertising-strategy | Full ad strategy — SP + SB + SD, budget allocation, funnel design | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-advertising-strategy/SKILL.md) |
| amazon-negative-keywords | Negative keyword audit, search term waste reduction, savings estimation | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-negative-keywords/SKILL.md) |
| amazon-display-ads | Sponsored Display — audience targeting, retargeting, creative optimization | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-display-ads/SKILL.md) |
| amazon-dayparting-strategy | Ad scheduling by time-of-day and day-of-week for bid optimization | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-dayparting-strategy/SKILL.md) |

### Listing Optimization

| Sub-skill | Route when | Source |
|-----------|-----------|--------|
| amazon-listing-optimization | Build listings from scratch or audit/rewrite existing ones, 8-dimension scoring | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-listing-optimization/SKILL.md) |
| amazon-a-plus-content | A+ Content layout, persuasive copy, comparison charts, image briefs | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-a-plus-content/SKILL.md) |
| amazon-backend-keywords | Backend search term optimization — 250-byte limit, deduplication | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-backend-keywords/SKILL.md) |
| amazon-search-optimization | A9/A10 algorithm factors, indexing strategy, rank improvement | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-search-optimization/SKILL.md) |
| amazon-listing-images | Product image planning — shot lists, infographics, lifestyle, mobile | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-listing-images/SKILL.md) |
| amazon-enhanced-brand-content | Enhanced Brand Content strategy and module selection | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-enhanced-brand-content/SKILL.md) |

### Analytics and Monitoring

| Sub-skill | Route when | Source |
|-----------|-----------|--------|
| amazon-sales-estimator | Monthly sales estimation from BSR, ASIN, or keyword | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-sales-estimator/SKILL.md) |
| amazon-rank-tracker | Keyword rank tracking, change diagnosis, improvement actions | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-rank-tracker/SKILL.md) |
| amazon-keyword-tracker | Keyword position monitoring, SERP changes, competitor movement | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-keyword-tracker/SKILL.md) |
| amazon-price-tracker | Competitor price monitoring, Buy Box history, promotion detection | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-price-tracker/SKILL.md) |
| amazon-product-photography | Photography planning — shot lists, infographics, optimization | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-product-photography/SKILL.md) |

### Brand and Compliance

| Sub-skill | Route when | Source |
|-----------|-----------|--------|
| amazon-brand-registry | Brand Registry enrollment, eligibility, benefits, protection tools | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-brand-registry/SKILL.md) |
| amazon-brand-tailored-promotions | Brand Tailored Promotions — audience segments, offer types, ROI | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-brand-tailored-promotions/SKILL.md) |
| amazon-storefront-design | Amazon Storefront page layout, navigation, branding | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-storefront-design/SKILL.md) |
| amazon-product-compliance | Product compliance — certifications, safety, labeling requirements | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-product-compliance/SKILL.md) |
| amazon-category-ungating | Category/brand ungating — requirements, application, documentation | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-category-ungating/SKILL.md) |
| amazon-suspension-appeal | Account suspension appeals — root cause, POA writing, reinstatement | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-suspension-appeal/SKILL.md) |
| amazon-vine-program | Vine enrollment, ROI calculation, review strategy | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-vine-program/SKILL.md) |
| amazon-review-strategy | Review solicitation, early review programs, policy compliance | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-review-strategy/SKILL.md) |
| amazon-return-reduction | Return rate analysis, root causes, reduction tactics | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-return-reduction/SKILL.md) |

### Inventory and Fulfillment

| Sub-skill | Route when | Source |
|-----------|-----------|--------|
| amazon-inventory-management | Restock timing, safety stock, IPI score, stranded inventory | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-inventory-management/SKILL.md) |
| amazon-fba-prep | FBA prep — labeling, packaging, shipment planning, rejection prevention | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-fba-prep/SKILL.md) |
| amazon-subscribe-save | Subscribe & Save enrollment, pricing, retention strategy | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-subscribe-save/SKILL.md) |

### Sourcing and Expansion

| Sub-skill | Route when | Source |
|-----------|-----------|--------|
| amazon-private-label | Private label product development — sourcing, branding, differentiation | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-private-label/SKILL.md) |
| amazon-wholesale-sourcing | Wholesale sourcing — supplier evaluation, negotiation, margin analysis | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-wholesale-sourcing/SKILL.md) |
| amazon-product-bundling | Product bundle strategy — complementary items, pricing, listing | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-product-bundling/SKILL.md) |
| amazon-variation-strategy | Variation listing strategy — parent-child setup, color/size optimization | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-variation-strategy/SKILL.md) |
| amazon-global-selling | International expansion — EU, UK, Japan, regulatory, logistics | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-global-selling/SKILL.md) |
| amazon-international-listings | International listing localization and translation | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-international-listings/SKILL.md) |
| amazon-seasonal-planning | Seasonal calendar — Prime Day, Black Friday, Q4 prep, inventory timing | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-seasonal-planning/SKILL.md) |
| amazon-coupon-strategy | Coupon planning — types, targeting, stacking rules, ROI | [source](https://raw.githubusercontent.com/nexscope-ai/Amazon-Skills/main/amazon-coupon-strategy/SKILL.md) |

## Output contract

For each task, deliver:

1. **Routed sub-skill** — which sub-skill was used
2. **Analysis/result** — the sub-skill's output (keyword report, fee breakdown,
   listing copy, campaign structure, etc.)
3. **Next steps** — 2-3 concrete follow-up actions the seller should take,
   referencing other sub-skills when relevant

## Provenance

- Source repository: https://github.com/nexscope-ai/Amazon-Skills
- Discovery URL: https://github.com/nexscope-ai/Amazon-Skills
- Organization: nexscope-ai (indie AI e-commerce tools)
- License: MIT
- Sub-skill count: 53
- Marketplaces: US, UK, DE, FR, IT, ES, JP, CA, AU, IN, MX, BR
