from __future__ import annotations

import re
from typing import Any
from urllib.parse import unquote, urljoin

from bs4 import BeautifulSoup

from .http import AmazonSession
from .listing import ASIN_RE
from .marketplaces import get_marketplace, product_url
from .money import parse_price

SECTIONS = (
    ("sims-productBundle_feature_div_0", "frequently_bought_together"),
    ("sims-productBundle_feature_div_01", "frequently_bought_together"),
    ("sims-simsContainer_feature_div_0", "customers_also_viewed"),
    ("sims-simsContainer_feature_div_01", "deals_on_related_products"),
    ("sims-simsContainer_feature_div_11", "four_stars_and_above"),
)


def _text(node: Any) -> str:
    return " ".join(node.get_text(" ", strip=True).split()) if node else ""


def _asin(node: Any) -> str:
    for candidate in (node, *node.select("[data-asin], [data-csa-c-item-id]")):
        value = str(candidate.get("data-asin") or "").strip().upper()
        if ASIN_RE.fullmatch(value):
            return value
        csa = str(candidate.get("data-csa-c-item-id") or "")
        match = re.search(r"amzn1\.asin\.([A-Z0-9]{10})", csa, re.I)
        if match:
            return match.group(1).upper()
    for link in node.select("a[href]"):
        href = unquote(str(link.get("href") or ""))
        match = re.search(r"/(?:dp|gp/product)/([A-Z0-9]{10})", href, re.I)
        if match:
            return match.group(1).upper()
        match = re.search(r"[?&]pd_rd_i=([A-Z0-9]{10})", href, re.I)
        if match:
            return match.group(1).upper()
    return ""


def _float(text: str) -> float | None:
    match = re.search(r"(\d+(?:[.,]\d+)?)", text or "")
    return float(match.group(1).replace(",", ".")) if match else None


def _int(text: str) -> int | None:
    token = re.sub(r"[^\d]", "", text or "")
    return int(token) if token else None


def parse_related_products(html: str, *, marketplace: str = "US", page_asin: str = "") -> list[dict[str, Any]]:
    soup = BeautifulSoup(html or "", "html.parser")
    mp = get_marketplace(marketplace)
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for div_id, section_key in SECTIONS:
        root = soup.select_one(f"#{div_id}")
        if root is None:
            continue
        cards = root.select("li.a-carousel-card") or root.select("[data-csa-c-item-type='asin']") or root.select("[data-asin]")
        for position, card in enumerate(cards, start=1):
            asin = _asin(card)
            if not asin or asin == page_asin or (section_key, asin) in seen:
                continue
            seen.add((section_key, asin))
            title_node = card.select_one('[class*="line-clamp"], .p13n-sc-truncate, img[alt]')
            title = _text(title_node) or (str(title_node.get("alt") or "").strip() if title_node else "")
            link = card.select_one('a[href*="/dp/"], a[href*="/gp/product/"]')
            href = str(link.get("href") or "") if link else ""
            image = card.select_one("img")
            out.append({
                "section": section_key,
                "position": position,
                "asin": asin,
                "title": title,
                "price": parse_price(_text(card.select_one(".a-price .a-offscreen"))),
                "rating": _float(_text(card.select_one(".a-icon-alt"))),
                "review_count": _int(_text(card.select_one(".a-size-small"))),
                "image_url": str(image.get("src") or image.get("data-src") or "") if image else "",
                "url": urljoin(mp.base_url, href) if href else f"{mp.base_url}/dp/{asin}",
            })
    return out


def get_related_products(asin: str, *, marketplace: str = "US") -> dict[str, Any]:
    normalized = str(asin or "").strip().upper()
    if not ASIN_RE.fullmatch(normalized):
        raise ValueError("invalid_asin")
    mp = get_marketplace(marketplace)
    with AmazonSession(mp.code) as session:
        response = session.get(product_url(mp, normalized), referer=mp.base_url)
    items = parse_related_products(response.text, marketplace=mp.code, page_asin=normalized)
    return {"tool": "amazon.get_related_products", "marketplace": mp.code, "asin": normalized, "count": len(items), "items": items}
