from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote_plus


@dataclass(frozen=True)
class Marketplace:
    code: str
    host: str
    language: str
    postal_code: str

    @property
    def base_url(self) -> str:
        return f"https://{self.host}"


MARKETPLACES: dict[str, Marketplace] = {
    "US": Marketplace("US", "www.amazon.com", "en-US,en;q=0.9", "10001"),
    "CA": Marketplace("CA", "www.amazon.ca", "en-CA,en;q=0.9,fr-CA;q=0.8", "K1A0A0"),
    "JP": Marketplace("JP", "www.amazon.co.jp", "ja-JP,ja;q=0.9,en;q=0.8", "1000001"),
    "UK": Marketplace("UK", "www.amazon.co.uk", "en-GB,en;q=0.9", "SW1A 1AA"),
    "FR": Marketplace("FR", "www.amazon.fr", "fr-FR,fr;q=0.9", "75001"),
    "BE": Marketplace("BE", "www.amazon.com.be", "fr-BE,fr;q=0.9,nl-BE;q=0.8", "1000"),
    "IT": Marketplace("IT", "www.amazon.it", "it-IT,it;q=0.9", "00186"),
    "DE": Marketplace("DE", "www.amazon.de", "de-DE,de;q=0.9,en;q=0.8", "10115"),
    "ES": Marketplace("ES", "www.amazon.es", "es-ES,es;q=0.9", "28001"),
    "IN": Marketplace("IN", "www.amazon.in", "en-IN,en;q=0.9", "110001"),
    "MX": Marketplace("MX", "www.amazon.com.mx", "es-MX,es;q=0.9", "06000"),
    "AU": Marketplace("AU", "www.amazon.com.au", "en-AU,en;q=0.9", "2600"),
}


def get_marketplace(code: str | None) -> Marketplace:
    key = str(code or "US").strip().upper() or "US"
    if key not in MARKETPLACES:
        raise ValueError(f"unsupported_marketplace:{key}")
    return MARKETPLACES[key]


def search_url(marketplace: Marketplace, keyword: str, page: int = 1) -> str:
    normalized = " ".join(str(keyword or "").strip().split())
    return f"{marketplace.base_url}/s/?k={quote_plus(normalized)}&page={max(1, int(page))}"


def product_url(marketplace: Marketplace, asin: str) -> str:
    return f"{marketplace.base_url}/dp/{asin.strip().upper()}"


def reviews_url(marketplace: Marketplace, asin: str, page: int = 1) -> str:
    return (
        f"{marketplace.base_url}/product-reviews/{asin.strip().upper()}/"
        f"?sortBy=recent&reviewerType=all_reviews&pageNumber={max(1, int(page))}"
    )
