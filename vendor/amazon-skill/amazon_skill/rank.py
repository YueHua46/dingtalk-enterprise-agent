from __future__ import annotations

import time
from typing import Any

from bs4 import BeautifulSoup

from .http import AmazonSession, delivery_matches_postal
from .listing import ASIN_RE
from .marketplaces import get_marketplace, search_url
from .search import parse_search_asins


def _delivery_text(html: str) -> str:
    soup = BeautifulSoup(html or "", "html.parser")
    return " ".join(node.get_text(" ", strip=True) for node in soup.select("#glow-ingress-line1, #glow-ingress-line2"))


def _pagination_done(html: str, page: int) -> bool:
    soup = BeautifulSoup(html or "", "html.parser")
    strip = soup.select_one(".s-pagination-strip")
    if strip is None:
        return False
    next_node = strip.select_one(".s-pagination-next")
    classes = set(next_node.get("class") or []) if next_node else set()
    return bool(next_node and ("s-pagination-disabled" in classes or str(next_node.get("aria-disabled") or "").lower() == "true"))


def get_keyword_rank(
    asin: str,
    keyword: str,
    *,
    marketplace: str = "US",
    rank_type: str = "organic",
    max_pages: int = 20,
) -> dict[str, Any]:
    target = str(asin or "").strip().upper()
    if not ASIN_RE.fullmatch(target):
        raise ValueError("invalid_asin")
    query = " ".join(str(keyword or "").split())
    if not query:
        raise ValueError("keyword_required")
    kind = "sponsored" if str(rank_type).lower() in {"sp", "sponsored"} else "organic"
    mp = get_marketplace(marketplace)
    pages = max(1, min(int(max_pages), 20))
    evidence: list[dict[str, Any]] = []
    # A fresh session may establish a verifiable delivery location even when
    # no persisted cookie file exists. Never return a rank unless page one
    # confirms the requested marketplace postal code.
    with AmazonSession(mp.code) as session:
        if not session.apply_postal(query):
            return {
                "tool": "amazon.get_keyword_rank",
                "marketplace": mp.code,
                "asin": target,
                "keyword": query,
                "rank_type": kind,
                "status": "unavailable",
                "error_code": "glow_failed",
                "error": "delivery postal-code setup failed",
            }
        time.sleep(min(2.0, session.page_delay))
        for page in range(1, pages + 1):
            response = session.get(search_url(mp, query, page), referer=mp.base_url)
            parsed = parse_search_asins(response.text)
            delivery = _delivery_text(response.text)
            evidence.append({
                "page": page,
                "organic_count": len(parsed["organic"]),
                "sponsored_count": len(parsed["sponsored"]),
                "delivery": delivery[:160],
            })
            if page == 1 and not delivery_matches_postal(delivery, mp.postal_code):
                return {
                    "tool": "amazon.get_keyword_rank",
                    "marketplace": mp.code,
                    "asin": target,
                    "keyword": query,
                    "rank_type": kind,
                    "status": "unavailable",
                    "error_code": "delivery_unverified",
                    "error": f"search page did not confirm postal code {mp.postal_code}",
                    "evidence": evidence,
                }
            ordered = parsed[kind]
            if target in ordered:
                position = ordered.index(target) + 1
                return {
                    "tool": "amazon.get_keyword_rank",
                    "marketplace": mp.code,
                    "asin": target,
                    "keyword": query,
                    "rank_type": kind,
                    "status": "ranked",
                    "rank_page": page,
                    "rank_position": position,
                    "rank_display": f"{page}-{position}",
                    "pages_scanned": page,
                    "evidence": evidence,
                }
            if _pagination_done(response.text, page):
                break
            if page < pages:
                time.sleep(session.page_delay)
    return {
        "tool": "amazon.get_keyword_rank",
        "marketplace": mp.code,
        "asin": target,
        "keyword": query,
        "rank_type": kind,
        "status": "not_found",
        "pages_scanned": len(evidence),
        "evidence": evidence,
    }
