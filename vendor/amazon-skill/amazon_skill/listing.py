from __future__ import annotations

import re
from typing import Any

from bs4 import BeautifulSoup

from .http import AmazonSession
from .marketplaces import get_marketplace, product_url
from .money import parse_price

ASIN_RE = re.compile(r"^[A-Z0-9]{10}$")


def _text(node: Any) -> str:
    return " ".join(node.get_text(" ", strip=True).split()) if node else ""


def _float(text: str) -> float | None:
    match = re.search(r"(\d+(?:[.,]\d+)?)", text or "")
    return float(match.group(1).replace(",", ".")) if match else None


def _int(text: str) -> int | None:
    token = re.sub(r"[^\d]", "", text or "")
    return int(token) if token else None


def parse_product_detail(html: str, *, asin: str, marketplace: str) -> dict[str, Any]:
    soup = BeautifulSoup(html or "", "html.parser")
    title = _text(soup.select_one("#productTitle"))
    if not title:
        raise ValueError("product_title_not_found")
    price_text = _text(soup.select_one("#corePrice_feature_div .a-offscreen, .a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice"))
    rating_text = _text(soup.select_one("#acrPopover .a-icon-alt, [data-hook='rating-out-of-text']"))
    review_text = _text(soup.select_one("#acrCustomerReviewText, [data-hook='total-review-count']"))
    bullets = [
        _text(node)
        for node in soup.select("#feature-bullets li span.a-list-item")
        if _text(node)
    ]
    images: list[str] = []
    landing = soup.select_one("#landingImage, #imgBlkFront")
    if landing:
        for attr in ("data-old-hires", "src"):
            value = str(landing.get(attr) or "").strip()
            if value and value not in images:
                images.append(value)
    for match in re.findall(r'"hiRes"\s*:\s*"(https:[^"\\]+)', html or ""):
        if match not in images:
            images.append(match)
        if len(images) >= 20:
            break
    brand = _text(soup.select_one("#bylineInfo"))
    brand = re.sub(r"^(?:Visit the|Brand:)\s*", "", brand, flags=re.I).strip()
    availability = _text(soup.select_one("#availability, #outOfStock"))
    coupon = _text(soup.select_one("#couponText, .couponBadge, .promoPriceBlockMessage"))
    bsr = _text(soup.select_one("#SalesRank, .zgSalesRankGroup"))
    aplus = _text(soup.select_one("#aplus_feature_div, #aplus"))
    return {
        "asin": asin,
        "marketplace": marketplace,
        "title": title,
        "brand": brand,
        "price": parse_price(price_text),
        "price_text": price_text,
        "rating": _float(rating_text),
        "review_count": _int(review_text),
        "bullets": bullets,
        "availability": availability,
        "coupon": coupon,
        "bsr_text": bsr,
        "images": images,
        "a_plus_text": aplus[:12000],
    }


def get_product_detail(asin: str, *, marketplace: str = "US") -> dict[str, Any]:
    normalized = str(asin or "").strip().upper()
    if not ASIN_RE.fullmatch(normalized):
        raise ValueError("invalid_asin")
    mp = get_marketplace(marketplace)
    with AmazonSession(mp.code) as session:
        response = session.get(product_url(mp, normalized), referer=mp.base_url)
    return {"tool": "amazon.get_product_detail", "marketplace": mp.code, "data": parse_product_detail(response.text, asin=normalized, marketplace=mp.code)}
