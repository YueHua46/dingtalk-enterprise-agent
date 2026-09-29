from __future__ import annotations

import re


def parse_price(text: str) -> float | None:
    """Parse common Amazon price formats, including comma decimals in Europe."""
    match = re.search(r"\d[\d.,\s\u00a0]*", text or "")
    if not match:
        return None
    token = re.sub(r"\s", "", match.group(0)).rstrip(".,")
    separators = [index for index, char in enumerate(token) if char in ",."]
    if not separators:
        return float(token)
    last = separators[-1]
    fractional_digits = len(token) - last - 1
    decimal = token[last] if fractional_digits in (1, 2) else None
    if decimal:
        whole = re.sub(r"[,.]", "", token[:last])
        fraction = token[last + 1 :]
        return float(f"{whole}.{fraction}")
    return float(re.sub(r"[,.]", "", token))
