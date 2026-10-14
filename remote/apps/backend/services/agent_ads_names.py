"""Resolve display labels only, after the caller has computed employee scope.

No report acquisition, persistence, budget changes or account-wide output.
Names are current observations; they do not prove historical configuration.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from time import monotonic
from threading import Lock

_cache = {}
_lock = Lock()


def enrich_campaign_names(data, sids, client_factory=None):
    from services.lingxing_ad_sync_service import get_lingxing_client, extract_list, _lingxing_ok
    factory = client_factory or get_lingxing_client
    rows = data.get('rows', [])
    allowed = set(sids)
    if any(row.get('sid') not in allowed for row in rows):
        raise PermissionError('name resolution outside employee scope')
    needs = {}
    for row in rows:
        family = 'SB' if row['report'] == 'sb_search_terms' else 'SP'
        if row.get('campaign_id') and not row.get('campaign_name'):
            needs.setdefault((row['sid'], family, 'campaign'), set()).add(str(row['campaign_id']))
        if row.get('campaign_id') and row.get('ad_group_id') and not row.get('ad_group_name'):
            needs.setdefault((row['sid'], family, 'ad_group'), set()).add((str(row['campaign_id']), str(row['ad_group_id'])))

    def resolve(entry):
        key, wanted = entry
        with _lock:
            cached = _cache.get(key) if client_factory is None else None
        if cached and monotonic() - cached[0] < 300 and (cached[2] or wanted.issubset(cached[1])):
            return key, cached[1], None
        found = {}
        observed = datetime.now(timezone.utc).isoformat()
        try:
            client = factory()
            if key[2] == 'campaign':
                call = client.get_sb_campaigns if key[1] == 'SB' else client.get_sp_campaigns
            else:
                endpoint = '/pb/openapi/newad/hsaAdGroups' if key[1] == 'SB' else '/pb/openapi/newad/spAdGroups'
                def call(**kwargs):
                    return client.call_post_api(endpoint, body=kwargs, headers={'X-API-VERSION': '2'})
            token, seen = None, set()
            complete = False
            for page in range(10):
                response = call(sid=key[0], offset=page * 100, length=100, **({'next_token': token} if token else {}))
                if not _lingxing_ok(response):
                    raise RuntimeError('provider_error')
                items = extract_list(response)
                for item in items:
                    identity = str(item.get('campaign_id') or item.get('campaignId') or item.get('id') or '')
                    if key[2] == 'ad_group':
                        group_id = str(item.get('ad_group_id') or '')
                        identity = (identity, group_id) if identity and group_id else None
                    name = item.get('name') or item.get(key[2] + '_name')
                    if identity and isinstance(name, str) and name.strip():
                        found[identity] = {'name': name, 'observed_at': observed}
                body = response.get('data')
                token = response.get('next_token') or (body.get('next_token') if isinstance(body, dict) else None)
                if not token and len(items) < 100:
                    complete = True
                    break
                if wanted.issubset(found):
                    break
                if token in seen:
                    break
                if token:
                    seen.add(token)
            if client_factory is None:
                with _lock:
                    if len(_cache) >= 128:
                        _cache.pop(next(iter(_cache)))
                    _cache[key] = (monotonic(), found, complete)
            return key, found, None if complete or wanted.issubset(found) else 'incomplete_name_lookup'
        except Exception as error:
            # Exceptions may contain provider request credentials. Return only
            # the class; successful matched labels remain useful observations.
            return key, found, type(error).__name__

    failures = []
    if needs:
        with ThreadPoolExecutor(max_workers=min(4, len(needs))) as pool:
            for key, names, error in pool.map(resolve, needs.items()):
                if error:
                    failures.append({'sid': key[0], 'ad_type': key[1], 'entity': key[2], 'reason': error})
                for row in rows:
                    family = 'SB' if row['report'] == 'sb_search_terms' else 'SP'
                    identity = str(row.get('campaign_id')) if key[2] == 'campaign' else (str(row.get('campaign_id')), str(row.get('ad_group_id')))
                    label = names.get(identity)
                    field = key[2] + '_name'
                    if (row['sid'], family) == key[:2] and not row.get(field) and label:
                        row[field] = label['name']
                        row[field + '_source'] = {'dataset': 'lingxing_' + key[2] + '_catalog', 'observed_at': label['observed_at'], 'ad_type': family, 'temporal_basis': 'current_name_not_historical_configuration'}
    data['name_resolution'] = {'campaign_names_missing': sum(bool(r.get('campaign_id')) and not bool(r.get('campaign_name')) for r in rows),
        'ad_group_names_missing': sum(bool(r.get('ad_group_id')) and not bool(r.get('ad_group_name')) for r in rows), 'failures': failures,
        'semantics': 'Original names only; missing names stay unknown. Live catalog names are observed now, not proof of past configuration.'}
    return data
