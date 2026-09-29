---
name: amazon-skill
description: Use Amazon marketplace crawling primitives for product search, visual competitor search, ASIN detail research, related-product evidence, promotions, recent reviews, and organic/SP keyword rank checks. Prefer these tools when the user asks for Amazon competitor research or marketplace evidence rather than business-database data.
---

# Amazon Skill

Use this skill to collect reusable Amazon marketplace evidence. It intentionally does not know about internal databases, stores, users, dashboards, task queues, daily reports, or company SOPs.

## Setup

From the repository root:

```bash
pip install -e .
```

Optional environment variables are documented in `.env.example`.

For stable rank checks, configure a cookie file with `AMAZON_COOKIE_FILE` or `AMAZON_COOKIE_FILE_<MARKETPLACE>`. A fresh session is also attempted, but rank is returned only if the delivery postal code is verified. Never expose cookie contents or proxy credentials in responses.

## Tools

### amazon.search_products

Use for keyword-based competitor discovery and SERP evidence.

```bash
amazon-skill search --keyword "security camera" --marketplace US --max-pages 2 --max-results 40
```

Important fields: `asin`, `title`, `price`, `rating`, `review_count`, `source_keyword`, `page`, `position`, `organic_rank`, `is_sponsored`.

### amazon.image_search

Use when the user supplies a product image and wants visually similar Amazon products. Verified StyleSnap markets in this project: US, DE, IT, ES, JP.

```bash
amazon-skill image-search --image ./target.jpg --marketplace US --max-results 40
```

`--image` accepts a local file path or image URL and may be repeated.

### amazon.get_product_detail

Use when an ASIN is known and listing-level evidence is required.

```bash
amazon-skill detail --asin B0XXXXXXXX --marketplace US
```

### amazon.get_related_products

Use to inspect related-product modules such as frequently bought together, related deals, and four-stars-and-above sections.

```bash
amazon-skill related --asin B0XXXXXXXX --marketplace US
```

Treat these modules as page observations; Amazon can vary them by session, location, and experiment.

### amazon.get_promotions

Use when coupon/deal/promotion evidence matters.

```bash
amazon-skill promotions --asin B0XXXXXXXX --marketplace US
```

### amazon.get_reviews

Use for voice-of-customer research and recent negative-feedback samples.

```bash
amazon-skill reviews --asin B0XXXXXXXX --marketplace US --max-pages 2 --max-rating 3
```

Do not treat a small scraped sample as the complete review corpus.

### amazon.get_keyword_rank

Use when the user asks where one ASIN appears for one keyword. Supports `organic` and `sp`/`sponsored`.

```bash
amazon-skill rank --asin B0XXXXXXXX --keyword "security camera" --marketplace US --type organic --max-pages 10
```

Rank is `page-position`, where position is within the organic or sponsored sequence on that page. Rank collection applies the marketplace standard delivery postal code and verifies it on page 1. If verification fails, do not invent a rank.

## Recommended competitor-research sequence

1. Run `amazon.search_products` for relevant keywords.
2. If an image is available, also run `amazon.image_search` and merge candidate ASINs.
3. Select candidates by product relevance, not rating/review count alone.
4. Run `amazon.get_product_detail` for the target and selected candidates.
5. Use `amazon.get_related_products` to discover Amazon's own adjacency signals when useful.
6. Use `amazon.get_promotions` for price/promotion context.
7. Use `amazon.get_reviews` for customer-problem evidence.
8. Use `amazon.get_keyword_rank` only for explicit keyword-position questions.
9. Synthesize conclusions outside these tools and keep raw evidence separate from recommendations.

## Marketplace support

Core page tools include metadata for US, CA, JP, UK, FR, BE, IT, DE, ES, IN, MX, and AU. BE page extraction is supported but remains subject to Amazon's live challenge and page variations. StyleSnap is currently restricted to US, DE, IT, ES, and JP because those are the markets verified in the extracted implementation.

## Failure handling

If a command reports a challenge/CAPTCHA, HTTP failure, parse failure, or delivery verification failure:

- report the failure clearly;
- do not fabricate missing data;
- retry only when reasonable;
- do not attempt to solve or bypass CAPTCHAs automatically.

## Output contract

CLI commands print JSON. Successful calls include `tool`, `marketplace`, and tool-specific data. CLI failures use `ok: false`, an error type, and a message.
