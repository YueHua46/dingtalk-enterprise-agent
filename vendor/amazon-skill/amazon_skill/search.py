from __future__ import annotations

import re
import time
from typing import Any, Iterable

from bs4 import BeautifulSoup

from .http import AmazonSession
from .marketplaces import get_marketplace, search_url
from .money import parse_price

ASIN_RE = re.compile(r"^[A-Z0-9]{10}$")
SEARCH_CARD_SELECTOR = 'div[data-component-type="s-search-result"], [role="listitem"].s-result-item'


def _text(node: Any) -> str:
    return node.get_text(" ", strip=True) if node else ""


def _number(text: str) -> float | None:
    match = re.search(r"(\d+(?:[.,]\d+)?)", text or "")
    return float(match.group(1).replace(",", ".")) if match else None


def _integer(text: str) -> int | None:
    token = re.sub(r"[^\d]", "", text or "")
    return int(token) if token else None


def _card_asin(card: Any) -> str:
    asin = str(card.get("data-asin") or "").strip().upper()
    if ASIN_RE.fullmatch(asin):
        return asin
    for node in (card, *card.find_all(recursive=False)):
        value = str(node.get("data-csa-c-item-id") or "").strip()
        match = re.fullmatch(r"amzn1\.asin\.([A-Z0-9]{10})", value, re.I)
        if match:
            return match.group(1).upper()
    return ""


def is_sponsored_card(card: Any) -> bool:
    classes = card.get("class") or []
    if isinstance(classes, str):
        classes = classes.split()
    component = str(card.get("data-component-type") or "").lower()
    return bool(
        "sponsored" in component
        or "AdHolder" in classes
        or card.select_one(
            ".puis-sponsored-label-text, .puis-sponsored-label, "
            '[cel_widget_id*="sp-sponsored"], [data-component-type*="sponsored"], '
            'a[href*="/sspa/click"], a[href*="sponsored-ads.amazon."][href*="/clk/"]'
        )
    )


def enumerate_search_cards(html: str) -> list[tuple[Any, str]]:
    soup = BeautifulSoup(html or "", "html.parser")
    main = soup.select_one("#s-main-slot") or soup.select_one(".s-main-slot")
    if main is None:
        return []
    out: list[tuple[Any, str]] = []
    seen: set[str] = set()
    for card in main.select(SEARCH_CARD_SELECTOR):
        asin = _card_asin(card)
        if asin and asin not in seen:
            seen.add(asin)
            out.append((card, asin))
    return out


def parse_search_asins(html: str) -> dict[str, list[str]]:
    organic: list[str] = []
    sponsored: list[str] = []
    for card, asin in enumerate_search_cards(html):
        (sponsored if is_sponsored_card(card) else organic).append(asin)
    return {"organic": organic, "sponsored": sponsored}


def parse_search_results(html: str, *, keyword: str, marketplace: str, page: int) -> list[dict[str, Any]]:
    base = get_marketplace(marketplace).base_url
    items: list[dict[str, Any]] = []
    organic_seen = 0
    for position, (card, asin) in enumerate(enumerate_search_cards(html), start=1):
        sponsored = is_sponsored_card(card)
        if not sponsored:
            organic_seen += 1
        title = ""
        for selector in ("h2 a span", "h2 span", "span.a-text-normal"):
            title = _text(card.select_one(selector))
            if title:
                break
        link = card.select_one("h2 a, a.a-link-normal")
        href = str(link.get("href") or "") if link else ""
        image = card.select_one("img.s-image")
        items.append({
            "asin": asin,
            "title": title,
            "price": parse_price(_text(card.select_one(".a-price .a-offscreen"))),
            "rating": _number(_text(card.select_one("span.a-icon-alt"))),
            "review_count": _integer(_text(card.select_one("span.s-underline-text, span.a-size-base.s-underline-text"))),
            "image_url": str(image.get("src") or "") if image else "",
            "url": href if href.startswith("http") else f"{base}{href}" if href else f"{base}/dp/{asin}",
            "source_keyword": keyword,
            "page": page,
            "position": position,
            "organic_rank": None if sponsored else organic_seen,
            "is_sponsored": sponsored,
            "coupon": _text(card.select_one("span.s-coupon-highlight-color, .s-coupon-unclipped, .s-coupon-clipped")),
            "badge": _text(card.select_one(".a-badge-text, .puis-status-badge-container")),
        })
    return items


def search_products(
    keywords: str | Iterable[str],
    *,
    marketplace: str = "US",
    max_pages: int = 2,
    max_results: int = 40,
    include_sponsored: bool = True,
) -> dict[str, Any]:
    mp = get_marketplace(marketplace)
    clean = [keywords] if isinstance(keywords, str) else list(keywords)
    clean = [" ".join(str(k).split()) for k in clean if str(k).strip()]
    pages = max(1, min(int(max_pages), 10))
    limit = max(1, min(int(max_results), 500))
    items: list[dict[str, Any]] = []
    with AmazonSession(mp.code) as session:
        for keyword in clean:
            for page in range(1, pages + 1):
                response = session.get(search_url(mp, keyword, page), referer=mp.base_url)
                parsed = parse_search_results(response.text, keyword=keyword, marketplace=mp.code, page=page)
                if not include_sponsored:
                    parsed = [item for item in parsed if not item["is_sponsored"]]
                items.extend(parsed)
                if len(items) >= limit:
                    items = items[:limit]
                    break
                if not parsed:
                    break
                if page < pages:
                    time.sleep(session.page_delay)
            if len(items) >= limit:
                break
    return {"tool": "amazon.search_products", "marketplace": mp.code, "keywords": clean, "count": len(items), "items": items}
