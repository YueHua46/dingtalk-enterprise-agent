"""Independently recompute collected ad queries; never execute model calculations."""
import json
import pathlib
import sys
from collections import defaultdict
from decimal import Decimal

root = pathlib.Path(sys.argv[1])
dest = pathlib.Path(sys.argv[2])
metrics = ('spend', 'sales', 'orders', 'clicks', 'impressions')


def summarize(rows):
    for row in rows:
        if any(row.get(k) is None for k in metrics):
            raise ValueError('Primary metric missing; cannot treat it as zero')
    sums = {k: sum((Decimal(str(r[k])) for r in rows), Decimal(0)) for k in metrics}
    for name, numerator, denominator, scale in (
        ('acos_pct', 'spend', 'sales', 100), ('cpc', 'spend', 'clicks', 1),
        ('cvr_pct', 'orders', 'clicks', 100), ('cpa', 'spend', 'orders', 1),
    ):
        sums[name] = sums[numerator] / sums[denominator] * scale if sums[denominator] else None
    return {k: str(v) if v is not None else None for k, v in sums.items()}


result = {'basis': 'Recomputed directly from saved primary query rows using Decimal; no model calculations or rounded ratios.', 'queries': [], 'detail_reconciliations': []}
queries = []
for file in sorted(root.glob('*crossborderops.ads.metrics.json')):
    value = json.loads(file.read_text(encoding='utf-8'))
    data = value.get('data', {})
    rows = data.get('rows', [])
    grouped = defaultdict(list)
    for row in rows:
        grouped[(str(row.get('sid')), str(row.get('campaign_id')))].append(row)
    summary = {
        'file': file.name, 'source': value.get('evidence', {}).get('source'),
        'period': data.get('period'), 'filters': data.get('filters'),
        'coverage': data.get('coverage'), 'rows': len(rows),
        'totals': summarize(rows),
        'campaigns': [{'sid': sid, 'campaign_id': cid, 'name': group[0].get('campaign_name'), **summarize(group)} for (sid, cid), group in grouped.items()],
        'customer_search_term_rows': sum(bool(r.get('customer_search_term')) for r in rows),
    }
    result['queries'].append(summary)
    queries.append((data, grouped, file.name))

for data, grouped, name in queries:
    if not data.get('filters', {}).get('campaign_ids'):
        continue
    for other, aggregate, aggregate_name in queries:
        if other.get('period') != data.get('period') or other.get('filters', {}).get('campaign_ids'):
            continue
        for key, rows in grouped.items():
            if key not in aggregate:
                continue
            detail, total = summarize(rows), summarize(aggregate[key])
            result['detail_reconciliations'].append({
                'detail': name, 'aggregate': aggregate_name, 'sid': key[0], 'campaign_id': key[1],
                'matches': {k: detail[k] == total[k] for k in metrics},
            })

dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'queries': len(queries), 'reconciliations': len(result['detail_reconciliations']),
                  'all_reconcile': all(all(x['matches'].values()) for x in result['detail_reconciliations']),
                  'output': str(dest)}, ensure_ascii=False))
