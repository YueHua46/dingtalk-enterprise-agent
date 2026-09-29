from __future__ import annotations

from typing import Any

TOOL_CATALOG: tuple[dict[str, Any], ...] = (
    {
        "id": "amazon.search_products",
        "description": "Search Amazon SERPs by keyword and return product candidates with organic/sponsored classification.",
        "inputs": {"keywords": "string[]", "marketplace": "US/JP/DE/...", "max_pages": "int", "max_results": "int"},
    },
    {
        "id": "amazon.image_search",
        "description": "Upload local/remote images to Amazon StyleSnap and return visually similar ASIN candidates.",
        "inputs": {"image_sources": "string[]", "marketplace": "US/DE/IT/ES/JP", "max_results": "int"},
    },
    {
        "id": "amazon.get_product_detail",
        "description": "Fetch and parse one Amazon /dp/{ASIN} listing.",
        "inputs": {"asin": "string", "marketplace": "US/JP/DE/..."},
    },
    {
        "id": "amazon.get_related_products",
        "description": "Extract reusable related-product sections from an ASIN detail page.",
        "inputs": {"asin": "string", "marketplace": "US/JP/DE/..."},
    },
    {
        "id": "amazon.get_promotions",
        "description": "Extract deal badges, coupon text, and other promotion messages from an ASIN detail page.",
        "inputs": {"asin": "string", "marketplace": "US/JP/DE/..."},
    },
    {
        "id": "amazon.get_reviews",
        "description": "Fetch recent review samples and optionally restrict the rating range.",
        "inputs": {"asin": "string", "marketplace": "US/JP/DE/...", "max_pages": "int", "min_rating": "number", "max_rating": "number"},
    },
    {
        "id": "amazon.get_keyword_rank",
        "description": "Find one ASIN's organic or sponsored page-position for one keyword after postal-code normalization.",
        "inputs": {"asin": "string", "keyword": "string", "marketplace": "US/JP/DE/...", "rank_type": "organic|sp", "max_pages": "int"},
    },
)
