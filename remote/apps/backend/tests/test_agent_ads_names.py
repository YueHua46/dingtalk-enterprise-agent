from services.agent_ads_names import enrich_campaign_names


def test_scoped_catalog_names_preserve_original_strings_and_never_cross_stores():
    calls = []
    class Client:
        def get_sp_campaigns(self, **args):
            calls.append(args)
            return {'code': 0, 'data': {'list': [{'id': 'same', 'name': f"原名 <&> 店铺{args['sid']}"}]}}
    rows = [{'sid': sid, 'report': 'sp_search_terms', 'campaign_id': 'same', 'ad_group_id': 'g', 'spend': sid * 10} for sid in [1,2]]
    result = enrich_campaign_names({'rows': rows}, [1,2], Client)
    assert [r['campaign_name'] for r in result['rows']] == ['原名 <&> 店铺1','原名 <&> 店铺2']
    assert [r['spend'] for r in result['rows']] == [10,20]
    assert {c['sid'] for c in calls} == {1,2}
    assert result['name_resolution']['ad_group_names_missing'] == 2
    try:
        enrich_campaign_names({'rows': rows}, [1], Client)
        assert False
    except PermissionError:
        pass


def test_catalog_failure_does_not_invent_names_or_leak_provider_error():
    class Client:
        def get_sp_campaigns(self, **args):
            raise RuntimeError('secret provider URL must not be exposed')
    result = enrich_campaign_names({'rows': [{'sid':1,'report':'sp_search_terms','campaign_id':'c'}]}, [1], Client)
    assert 'campaign_name' not in result['rows'][0]
    assert result['name_resolution']['failures'] == [{'sid':1,'ad_type':'SP','entity':'campaign','reason':'RuntimeError'}]


def test_group_name_requires_matching_parent_and_follows_top_level_cursor():
    calls=[]
    class Client:
        def call_post_api(self, endpoint, body, headers):
            calls.append(body)
            assert endpoint == '/pb/openapi/newad/spAdGroups'
            assert headers == {'X-API-VERSION':'2'}
            if 'next_token' not in body:
                return {'code':0,'next_token':'next','data':[{'campaign_id':'wrong','ad_group_id':'g','name':'Wrong parent'}]}
            return {'code':0,'data':[{'campaign_id':'c','ad_group_id':'g','name':'Exact group [原名]'}]}
    data={'rows':[{'sid':1,'report':'sp_search_terms','campaign_id':'c','campaign_name':'Known','ad_group_id':'g'}]}
    result=enrich_campaign_names(data,[1],Client)
    assert result['rows'][0]['ad_group_name']=='Exact group [原名]'
    assert calls[1]['next_token']=='next'
