from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from dotenv import load_dotenv

from .marketplaces import Marketplace, get_marketplace, search_url

load_dotenv()

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
)


class AmazonError(RuntimeError):
    pass


class AmazonBlockedError(AmazonError):
    pass


class AmazonRequestError(AmazonError):
    pass


def _env(name: str, market: str) -> str:
    return (os.getenv(f"{name}_{market}") or os.getenv(name) or "").strip()


def load_cookie_file(path: str | Path) -> dict[str, str]:
    file = Path(path).expanduser()
    if not file.is_file():
        raise AmazonRequestError(f"cookie_file_not_found:{file}")
    text = file.read_text(encoding="utf-8", errors="ignore").strip()
    if not text:
        return {}
    if text.startswith("{") or text.startswith("["):
        payload = json.loads(text)
        if isinstance(payload, dict):
            return {str(k): str(v) for k, v in payload.items() if str(k)}
        if isinstance(payload, list):
            return {
                str(item.get("name")): str(item.get("value", ""))
                for item in payload
                if isinstance(item, dict) and item.get("name")
            }
        raise AmazonRequestError("unsupported_cookie_json")
    cookies: dict[str, str] = {}
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 7:
            cookies[parts[5]] = parts[6]
    if not cookies:
        raise AmazonRequestError("unsupported_cookie_file")
    return cookies


def detect_challenge(html: str) -> bool:
    body = html or ""
    if re.search(
        r"validateCaptcha|Robot Check|Enter the characters you see below|"
        r"bm-verify|/_sec/verify\?provider=interstitial|AkamaiGHost",
        body,
        re.I,
    ):
        return True
    soup = BeautifulSoup(body, "html.parser")
    return soup.select_one("#captchacharacters, img[src*='captcha' i]") is not None


def delivery_matches_postal(delivery: str, postal_code: str) -> bool:
    norm = lambda value: re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    wanted = norm(postal_code)
    return bool(wanted and wanted[:5] in norm(delivery))


class AmazonSession:
    def __init__(self, marketplace: str = "US", *, require_cookies: bool = False) -> None:
        self.marketplace: Marketplace = get_marketplace(marketplace)
        market = self.marketplace.code
        cookie_path = _env("AMAZON_COOKIE_FILE", market)
        cookies = load_cookie_file(cookie_path) if cookie_path else {}
        if require_cookies and not cookies:
            raise AmazonRequestError(
                f"cookie_unavailable:{market}; set AMAZON_COOKIE_FILE_{market} or AMAZON_COOKIE_FILE"
            )
        timeout = float(os.getenv("AMAZON_TIMEOUT_SEC") or 30)
        proxy = _env("AMAZON_PROXY", market) or None
        kwargs: dict[str, Any] = {
            "timeout": httpx.Timeout(timeout),
            "follow_redirects": True,
            "http2": True,
            "cookies": cookies,
            "headers": {
                "User-Agent": os.getenv("AMAZON_USER_AGENT") or DEFAULT_USER_AGENT,
                "Accept-Language": self.marketplace.language,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
            },
        }
        if proxy:
            kwargs["proxy"] = proxy
        self.client = httpx.Client(**kwargs)
        self.retries = max(0, int(os.getenv("AMAZON_HTTP_RETRIES") or 2))
        self.page_delay = max(0.0, float(os.getenv("AMAZON_PAGE_DELAY_SEC") or 1.0))

    def __enter__(self) -> "AmazonSession":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        self.client.close()

    def get(self, url: str, *, referer: str | None = None) -> httpx.Response:
        headers = {"Referer": referer} if referer else None
        last: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                response = self.client.get(url, headers=headers)
                if response.status_code == 429 or response.status_code >= 500:
                    if attempt < self.retries:
                        time.sleep(1.5 + attempt * 2)
                        continue
                if response.status_code >= 400:
                    raise AmazonRequestError(f"http_{response.status_code}:{url}")
                final_path = urlparse(str(response.url)).path.lower()
                if final_path.startswith(("/ap/signin", "/ap/cvf")):
                    raise AmazonBlockedError("amazon_signin_required")
                if detect_challenge(response.text):
                    raise AmazonBlockedError("amazon_challenge_detected")
                return response
            except AmazonError:
                raise
            except httpx.RequestError as exc:
                last = exc
                if attempt < self.retries:
                    time.sleep(1.5 + attempt * 2)
                    continue
        raise AmazonRequestError(f"request_failed:{last}")

    def apply_postal(self, first_keyword: str = "a") -> bool:
        mp = self.marketplace
        home = f"{mp.base_url}/"
        try:
            self.get(home)
            warm = search_url(mp, "a", 1)
            self.get(warm, referer=home)
            endpoint = f"{mp.base_url}/portal-migration/hz/glow/address-change?actionSource=glow"
            payload = {
                "locationType": "LOCATION_INPUT",
                "storeContext": "sporting-goods",
                "deviceType": "web",
                "pageType": "Detail",
                "actionSource": "glow",
                "almBrandId": "undefined",
                "zipCode": mp.postal_code,
            }
            response = self.client.post(
                endpoint,
                data=payload,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "*/*",
                    "Referer": warm,
                    "Accept-Language": mp.language,
                },
            )
            if response.status_code >= 400:
                return False
            try:
                data = response.json()
            except ValueError:
                return False
            ok = bool(data.get("successful") or data.get("isValidAddress"))
            if ok and first_keyword.strip():
                self.get(search_url(mp, first_keyword, 1), referer=home)
            return ok
        except AmazonError:
            return False
