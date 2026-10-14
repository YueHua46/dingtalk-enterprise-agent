#!/usr/bin/env python3
"""Deterministic advertising metric calculations for analysis.python.

Input is a JSON object or array of rows. Each row may contain impressions,
clicks, spend, orders, ad_sales and total_sales. Missing or zero denominators
produce null instead of fabricated values.
"""
from __future__ import annotations

import json
import math
import sys
from typing import Any


def number(row: dict[str, Any], *names: str) -> float | None:
    for name in names:
        value = row.get(name)
        if value is None or value == "":
            continue
        try:
            result = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(result):
            return result
    return None


def ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator in (None, 0):
        return None
    return numerator / denominator


def metrics(row: dict[str, Any]) -> dict[str, Any]:
    impressions = number(row, "impressions", "impression")
    clicks = number(row, "clicks")
    spend = number(row, "spend", "ad_spend")
    orders = number(row, "orders", "ad_orders")
    ad_sales = number(row, "ad_sales", "sales")
    total_sales = number(row, "total_sales", "revenue")
    return {
        **row,
        "ctr": ratio(clicks, impressions),
        "cpc": ratio(spend, clicks),
        "cvr": ratio(orders, clicks),
        "cpa": ratio(spend, orders),
        "acos": ratio(spend, ad_sales),
        "roas": ratio(ad_sales, spend),
        "tacos": ratio(spend, total_sales),
    }


def main() -> int:
    payload = json.load(sys.stdin)
    rows = payload if isinstance(payload, list) else payload.get("rows", [payload])
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise SystemExit("input must be an object or array of row objects")
    result = [metrics(row) for row in rows]
    json.dump({"rows": result}, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
