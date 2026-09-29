from __future__ import annotations

from typing import Any

from bs4 import BeautifulSoup

from .http import AmazonSession
from .listing import ASIN_RE
from .marketplaces import get_marketplace, product_url

DEAL_SELECTORS = (
    "#dealBadge_feature_div .dealBadgeTextColor",
    "#dealBadge_feature_div .a-size-small.a-text-bold",
    "#dealBadgeSupportContent",
    ".dealBadgeTextColor",
    "#dealsAccordionRow .a-color-success",
    "#dealProgressBar_feature_div",
    "[data-a-badge-type='deal']",
)
OTHER_PROMO_SELECTORS = (
    "[id^='greenBadgepctch']",
    "#promoPriceBlockMessage_feature_div",
    "#promoPriceBlockMessage",
    ".promoPriceBlockMessage",
    "#promotions_feature_div .a-color-success",
    "#specialOffers_feature_div .a-color-success",
)
COUPON_MARKERS = ("coupon", "voucher", "gutschein", "cupón", "buono sconto", "クーポン", "优惠券", "優惠券")


def _normalize(text: str) -> str:
    return " ".join((text or "").split())


def _dedupe(texts: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in texts:
        text = _normalize(raw)
        key = text.casefold()
        if len(text) < 2 or len(text) > 400 or key in seen:
            continue
        if key in {"details", "see more", "learn more", "terms"}:
            continue
        seen.add(key)
        out.append(text)
    return out


def parse_promotions(html: str, *, marketplace: str = "US") -> dict[str, Any]:
    soup = BeautifulSoup(html or "", "html.parser")
    deals = _dedupe([node.get_text(" ", strip=True) for selector in DEAL_SELECTORS for node in soup.select(selector)])
    promos = _dedupe([node.get_text(" ", strip=True) for selector in OTHER_PROMO_SELECTORS for node in soup.select(selector)])
    coupons = [text for text in promos if any(marker in text.casefold() for marker in COUPON_MARKERS)]
    others = [text for text in promos if text not in coupons]
    return {"marketplace": get_marketplace(marketplace).code, "deal_badges": deals, "coupon_promotions": coupons, "other_promotions": others}


def get_promotions(asin: str, *, marketplace: str = "US") -> dict[str, Any]:
    normalized = str(asin or "").strip().upper()
    if not ASIN_RE.fullmatch(normalized):
        raise ValueError("invalid_asin")
    mp = get_marketplace(marketplace)
    with AmazonSession(mp.code) as session:
        response = session.get(product_url(mp, normalized), referer=mp.base_url)
    return {"tool": "amazon.get_promotions", "asin": normalized, **parse_promotions(response.text, marketplace=mp.code)}
