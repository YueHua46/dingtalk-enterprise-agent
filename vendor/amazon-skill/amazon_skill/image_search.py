from __future__ import annotations

import mimetypes
import re
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from .http import AmazonSession
from .marketplaces import get_marketplace

SUPPORTED_STYLESNAP_MARKETPLACES = frozenset({"US", "DE", "IT", "ES", "JP"})


def _extract_token(html: str) -> str:
    soup = BeautifulSoup(html or "", "html.parser")
    node = soup.select_one('input[name="stylesnap"]')
    token = str(node.get("value") or "").strip() if node else ""
    if token:
        return token
    for pattern in (
        r'<input[^>]+name=["\']stylesnap["\'][^>]+value=["\']([^"\']+)',
        r'<input[^>]+value=["\']([^"\']+)["\'][^>]+name=["\']stylesnap["\']',
    ):
        match = re.search(pattern, html or "", re.I)
        if match:
            return match.group(1).strip()
    return ""


def _image_bytes(session: AmazonSession, source: str) -> tuple[bytes, str, str]:
    if source.startswith(("http://", "https://")):
        response = session.client.get(source, headers={"Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"})
        response.raise_for_status()
        filename = Path(urlparse(source).path).name or "upload.jpg"
        content_type = response.headers.get("content-type", "").split(";")[0].strip()
        return response.content, filename, content_type or mimetypes.guess_type(filename)[0] or "image/jpeg"
    path = Path(source).expanduser()
    if not path.is_file():
        raise FileNotFoundError(f"image_not_found:{source}")
    return path.read_bytes(), path.name, mimetypes.guess_type(path.name)[0] or "image/jpeg"


def _parse_items(payload: dict[str, Any], *, marketplace: str) -> list[dict[str, Any]]:
    search_results = [item for item in payload.get("searchResults") or [] if isinstance(item, dict)]
    scores: dict[str, float] = {}
    metadata: dict[str, dict[str, Any]] = {}
    ordered: list[str] = []

    def add(value: Any) -> None:
        asin = str(value or "").strip().upper()
        if re.fullmatch(r"[A-Z0-9]{10}", asin) and asin not in ordered:
            ordered.append(asin)

    for result in search_results:
        for child in result.get("subContent") or []:
            if isinstance(child, dict):
                asin = str(child.get("content") or "").strip().upper()
                add(asin)
                try:
                    scores.setdefault(asin, float((child.get("properties") or {}).get("score")))
                except (TypeError, ValueError):
                    pass
        for asin in result.get("bbxAsinList") or []:
            add(asin)
        for item in result.get("bbxAsinMetadataList") or []:
            if isinstance(item, dict):
                asin = str(item.get("asin") or "").strip().upper()
                if asin:
                    metadata[asin] = item
                    add(asin)

    mp = get_marketplace(marketplace)
    out: list[dict[str, Any]] = []
    for asin in ordered:
        meta = metadata.get(asin) or {}
        rating = meta.get("averageOverallRating")
        reviews = meta.get("totalReviewCount")
        out.append({
            "asin": asin,
            "title": str(meta.get("title") or ""),
            "brand": str(meta.get("byLine") or ""),
            "price_text": str(meta.get("price") or ""),
            "rating": float(rating) if isinstance(rating, (int, float)) else None,
            "review_count": int(reviews) if isinstance(reviews, int) else None,
            "image_url": str(meta.get("imageUrl") or ""),
            "url": f"{mp.base_url}/dp/{asin}",
            "image_score": scores.get(asin),
        })
    return out


def image_search(
    image_sources: str | Iterable[str],
    *,
    marketplace: str = "US",
    max_results: int = 40,
) -> dict[str, Any]:
    mp = get_marketplace(marketplace)
    if mp.code not in SUPPORTED_STYLESNAP_MARKETPLACES:
        raise ValueError(f"stylesnap_unsupported_marketplace:{mp.code}")
    sources = [image_sources] if isinstance(image_sources, str) else list(image_sources)
    sources = [str(source).strip() for source in sources if str(source).strip()]
    limit = max(1, min(int(max_results), 120))
    seen: set[str] = set()
    items: list[dict[str, Any]] = []
    with AmazonSession(mp.code) as session:
        token_response = session.get(f"{mp.base_url}/shopthelook", referer=mp.base_url)
        token = _extract_token(token_response.text)
        if not token:
            raise RuntimeError("stylesnap_token_not_found")
        for source in sources:
            image_data, filename, content_type = _image_bytes(session, source)
            response = session.client.post(
                f"{mp.base_url}/stylesnap/upload",
                params={"stylesnapToken": token},
                files={filename: ("blob", image_data, content_type)},
                headers={
                    "Accept": "application/json, text/plain, */*",
                    "Accept-Language": mp.language,
                    "Origin": mp.base_url,
                    "Referer": f"{mp.base_url}/shopthelook",
                },
            )
            response.raise_for_status()
            for item in _parse_items(response.json(), marketplace=mp.code):
                if item["asin"] in seen:
                    continue
                seen.add(item["asin"])
                items.append(item)
                if len(items) >= limit:
                    break
            if len(items) >= limit:
                break
    return {"tool": "amazon.image_search", "marketplace": mp.code, "sources": sources, "count": len(items), "items": items}
