"""Postgres integration check using temporary synthetic tables only."""
from datetime import date
from types import SimpleNamespace
import psycopg2
from psycopg2.extras import RealDictCursor
from config.settings import DATABASE_URL
from services.agent_ads_metrics_service import ads_metrics

def test_labels_preserve_identity_rename_totals_and_scope():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("CREATE TEMP TABLE cbops_ads_campaign_daily_snapshot (id int,sid int,biz_date date,ad_type text,campaign_id text,campaign_name text,snapshot_version int,captured_at timestamp) ON COMMIT DROP")
            cur.execute("INSERT INTO cbops_ads_campaign_daily_snapshot VALUES (1,1,'2026-10-07','SP','c3','Snapshot Name',1,'2026-10-08'),(2,2,'2026-10-07','SP','c3','Wrong store',1,'2026-10-08'),(3,1,'2026-10-07','SB','c3','Wrong family',1,'2026-10-08')")
            cur.execute("CREATE TEMP TABLE cbops_ads_sp_search_term_report_detail (id int,sid int,report_date date,campaign_id text,campaign_name text,ad_group_id text,ad_group_name text,impressions int,clicks int,spend numeric,sales numeric,orders int) ON COMMIT DROP")
            cur.executemany("INSERT INTO cbops_ads_sp_search_term_report_detail VALUES (%s,%s,%s,%s,%s,%s,%s,100,10,%s,100,1)",[
                (1,1,'2026-10-06','c1','Original <Name>','g1','Group [exact]',10),
                (2,1,'2026-10-07','c1','New & Name','g1','Group [exact]',20),
                (3,1,'2026-10-08','c1',' ','g1','Group [exact]',30),
                (4,1,'2026-10-07','c2','New & Name','g2','Other',5),
                (5,2,'2026-10-07','c1','Unauthorized','g1','Other',999),
                (6,1,'2026-10-07','c3',None,'g3',None,1)])
            def fetch(sql,args):
                cur.execute(sql,args)
                return list(cur.fetchall())
            db=SimpleNamespace(ad_reports=SimpleNamespace(_fetch_dicts=fetch))
            r=ads_metrics(db,[1],{'sources':['sp_search_terms'],'dimensions':['ad_group']},date(2026,10,6),date(2026,10,12))
            assert r['total']==3
            assert r['rows'][0]['campaign_name']=='New & Name'
            assert set(r['rows'][0]['campaign_name_variants'])=={'Original <Name>','New & Name'}
            assert r['rows'][0]['ad_group_name']=='Group [exact]'
            assert r['rows'][0]['spend']==60
            assert r['totals_by_store_report'][0]['spend']==66
            assert r['rows'][2]['campaign_name']=='Snapshot Name'
            assert r['rows'][2]['ad_group_name'] is None
    finally:
        conn.rollback()
        conn.close()
