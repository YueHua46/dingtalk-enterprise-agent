from __future__ import annotations

import re
import time
from typing import Any

from bs4 import BeautifulSoup

from .http import AmazonBlockedError, AmazonSession
from .listing import ASIN_RE
from .marketplaces import get_marketplace, product_url, reviews_url

STAR_RE = re.compile(r"(\d+(?:[.,]\d+)?)")


def _text(node: Any) -> str:
    return " ".join(node.get_text(" ", strip=True).split()) if node else ""


def _star(text: str) -> float | None:
    match = STAR_RE.search(text or "")
    if not match:
        return None
    value = float(match.group(1).replace(",", "."))
    return value if 0 < value <= 5 else None


def _helpful(text: str) -> int:
    raw = (text or "").lower()
    if "one person" in raw:
        return 1
    match = re.search(r"([\d,\.\s]+)\s+people", raw)
    return int(re.sub(r"\D", "", match.group(1))) if match and re.sub(r"\D", "", match.group(1)) else 0


def parse_reviews(html: str, *, asin: str, marketplace: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html or "", "html.parser")
    out: list[dict[str, Any]] = []
    for node in soup.select("[data-hook='review']"):
        review_id = str(node.get("id") or "").strip()
        rating_text = _text(node.select_one("[data-hook='review-star-rating'] .a-icon-alt, [data-hook='cmps-review-star-rating'] .a-icon-alt, .review-rating .a-icon-alt"))
        title = _text(node.select_one("[data-hook='review-title']"))
        title = re.sub(r"^\s*\d+(?:[.,]\d+)?\s+.*?\s{2,}", "", title).strip() or title
        image_urls = [str(img.get("src") or "") for img in node.select("[data-hook='review-image-tile'] img") if img.get("src")]
        out.append({
            "review_id": review_id,
            "asin": asin,
            "marketplace": marketplace,
            "author": _text(node.select_one(".a-profile-name, [data-hook='genome-widget']")),
            "rating": _star(rating_text or title),
            "title": title,
            "date_text": _text(node.select_one("[data-hook='review-date']")),
            "variant": _text(node.select_one("[data-hook='format-strip']")),
            "verified_purchase": bool(_text(node.select_one("[data-hook='avp-badge']"))),
            "vine": bool(_text(node.select_one("[data-hook='vine-badge']"))),
            "content": _text(node.select_one("[data-hook='review-body']")),
            "helpful_count": _helpful(_text(node.select_one("[data-hook='helpful-vote-statement']"))),
            "image_urls": image_urls,
        })
    return out


def get_reviews(
    asin: str,
    *,
    marketplace: str = "US",
    max_pages: int = 1,
    min_rating: float = 1.0,
    max_rating: float = 5.0,
) -> dict[str, Any]:
    normalized = str(asin or "").strip().upper()
    if not ASIN_RE.fullmatch(normalized):
        raise ValueError("invalid_asin")
    mp = get_marketplace(marketplace)
    pages = max(1, min(int(max_pages), 5))
    reviews: list[dict[str, Any]] = []
    source = "review_pages"
    with AmazonSession(mp.code) as session:
        for page in range(1, pages + 1):
            try:
                response = session.get(reviews_url(mp, normalized, page), referer=product_url(mp, normalized))
            except AmazonBlockedError as error:
                if page != 1 or str(error) != "amazon_signin_required":
                    raise
                response = session.get(product_url(mp, normalized), referer=mp.base_url)
                source = "product_detail_visible_reviews"
            parsed = parse_reviews(response.text, asin=normalized, marketplace=mp.code)
            if not parsed:
                break
            reviews.extend(
                item for item in parsed
                if item["rating"] is not None and float(min_rating) <= item["rating"] <= float(max_rating)
            )
            if source == "product_detail_visible_reviews":
                break
            if page < pages:
                time.sleep(session.page_delay)
    stars: dict[str, int] = {}
    for item in reviews:
        key = str(item["rating"])
        stars[key] = stars.get(key, 0) + 1
    return {
        "tool": "amazon.get_reviews",
        "marketplace": mp.code,
        "asin": normalized,
        "filters": {"min_rating": min_rating, "max_rating": max_rating},
        "source": source,
        "sample_limit": "visible_product_page_only" if source == "product_detail_visible_reviews" else "requested_review_pages",
        "count": len(reviews),
        "rating_counts": stars,
        "items": reviews,
    }
