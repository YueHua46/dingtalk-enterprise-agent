from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from .image_search import image_search
from .listing import get_product_detail
from .promotions import get_promotions
from .rank import get_keyword_rank
from .related import get_related_products
from .reviews import get_reviews
from .search import search_products
from .tools import TOOL_CATALOG


def _print(payload: Any) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="amazon-skill", description="Standalone Amazon research tools")
    sub = parser.add_subparsers(dest="command", required=True)

    tools = sub.add_parser("tools", help="List available tool contracts")
    tools.set_defaults(handler=lambda _: {"tools": TOOL_CATALOG})

    search = sub.add_parser("search", help="Search Amazon products by keyword")
    search.add_argument("--keyword", action="append", required=True)
    search.add_argument("--marketplace", default="US")
    search.add_argument("--max-pages", type=int, default=2)
    search.add_argument("--max-results", type=int, default=40)
    search.add_argument("--organic-only", action="store_true")
    search.set_defaults(handler=lambda a: search_products(a.keyword, marketplace=a.marketplace, max_pages=a.max_pages, max_results=a.max_results, include_sponsored=not a.organic_only))

    image = sub.add_parser("image-search", help="Find visually similar Amazon products with StyleSnap")
    image.add_argument("--image", action="append", required=True, help="Local path or image URL; repeat for multiple images")
    image.add_argument("--marketplace", default="US")
    image.add_argument("--max-results", type=int, default=40)
    image.set_defaults(handler=lambda a: image_search(a.image, marketplace=a.marketplace, max_results=a.max_results))

    detail = sub.add_parser("detail", help="Fetch one ASIN listing")
    detail.add_argument("--asin", required=True)
    detail.add_argument("--marketplace", default="US")
    detail.set_defaults(handler=lambda a: get_product_detail(a.asin, marketplace=a.marketplace))

    related = sub.add_parser("related", help="Extract related-product sections")
    related.add_argument("--asin", required=True)
    related.add_argument("--marketplace", default="US")
    related.set_defaults(handler=lambda a: get_related_products(a.asin, marketplace=a.marketplace))

    promos = sub.add_parser("promotions", help="Extract deals, coupons and promotion messages")
    promos.add_argument("--asin", required=True)
    promos.add_argument("--marketplace", default="US")
    promos.set_defaults(handler=lambda a: get_promotions(a.asin, marketplace=a.marketplace))

    reviews = sub.add_parser("reviews", help="Fetch recent review samples")
    reviews.add_argument("--asin", required=True)
    reviews.add_argument("--marketplace", default="US")
    reviews.add_argument("--max-pages", type=int, default=1)
    reviews.add_argument("--min-rating", type=float, default=1.0)
    reviews.add_argument("--max-rating", type=float, default=5.0)
    reviews.set_defaults(handler=lambda a: get_reviews(a.asin, marketplace=a.marketplace, max_pages=a.max_pages, min_rating=a.min_rating, max_rating=a.max_rating))

    rank = sub.add_parser("rank", help="Check organic or sponsored keyword rank")
    rank.add_argument("--asin", required=True)
    rank.add_argument("--keyword", required=True)
    rank.add_argument("--marketplace", default="US")
    rank.add_argument("--type", choices=("organic", "sp", "sponsored"), default="organic")
    rank.add_argument("--max-pages", type=int, default=20)
    rank.set_defaults(handler=lambda a: get_keyword_rank(a.asin, a.keyword, marketplace=a.marketplace, rank_type=a.type, max_pages=a.max_pages))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        _print(args.handler(args))
        return 0
    except Exception as exc:
        _print({"ok": False, "error_type": type(exc).__name__, "error": str(exc)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
