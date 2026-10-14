import asyncio,json,types,importlib.util,time,sqlite3
import httpx
async def run():
 c=json.load(open("/AstrBot/data/cmd_config.json",encoding="utf-8-sig"))
 cfg=next(p for p in c["provider_sources"] if p["id"]=="anthropic")
 model="gemini-3.8-flash-high"
 key=cfg["key"][0] if isinstance(cfg["key"],list) else cfg["key"]
 base=cfg["api_base"].rstrip("/")
 spec=importlib.util.spec_from_file_location("native_search","/AstrBot/data/plugins/astrbot_plugin_gemini_native_search/main.py")
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 provider=types.SimpleNamespace(provider_config=cfg,get_model=lambda:model,get_current_key=lambda:key)
 search={"name":"gemini_web_search","description":"Search current public web information using native Gemini grounding","input_schema":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}}
 old={"name":"aiimg_task_status","description":"Query durable image task facts without starting provider work.","input_schema":{"type":"object","properties":{"task_id":{"type":"string"},"include_prompts":{"type":"boolean"},"offset":{"type":"integer"},"limit":{"type":"integer"}}}}
 headers={"x-api-key":key,"anthropic-version":"2023-06-01","content-type":"application/json"}
 question="我的世界基岩版最新版本现在是什么"
 db=sqlite3.connect("/AstrBot/data/data_v4.db")
 persona=db.execute("select system_prompt from personas where persona_id=?",("喵妹",)).fetchone()[0]
 extras={}
 event=types.SimpleNamespace(unified_msg_origin="validation-public-question",get_message_str=lambda:question,get_extra=lambda k:extras.get(k),set_extra=lambda k,v:extras.update({k:v}))
 context=types.SimpleNamespace()
 async def active(origin):return provider
 context.get_using_provider_async=active
 plugin=object.__new__(mod.GeminiNativeSearch);plugin.context=context
 tools=[search,old]
 req=types.SimpleNamespace(prompt=question,system_prompt=persona,func_tool=tools)
 started=time.monotonic()
 await plugin.ground_current_public_facts(event,req)
 evidence=json.loads(req.prompt.split("<current_public_web_evidence>")[1].split("</current_public_web_evidence>")[0])
 payload={"model":model,"max_tokens":65536,"stream":False,"system":req.system_prompt,"tools":tools,"messages":[{"role":"user","content":req.prompt}]}
 async with httpx.AsyncClient(timeout=150) as client:
  r=await client.post(base+"/v1/messages",headers=headers,json=payload)
  data=r.json()
  answer="\n".join(x.get("text","") for x in data.get("content",[]) if x.get("type")=="text")
  report={"http":r.status_code,"stop_reason":data.get("stop_reason"),"source_count":len(evidence.get("sources",[])),"source_urls":[x.get("url") for x in evidence.get("sources",[])],"grounding_status":extras.get("gemini_current_fact_grounding_status"),"persona_prefix_preserved":req.system_prompt.startswith(persona),"tools_preserved":req.func_tool is tools,"tool_choice_forced":False,"answer":answer,"duration_seconds":round(time.monotonic()-started,2),"scope":"Actual deployed pre-request hook + actual provider and saved persona; does not exercise QQ delivery or other plugin hooks"}
  open("/AstrBot/data/plugins/astrbot_plugin_gemini_native_search/current-fact-verification.json","w").write(json.dumps(report,ensure_ascii=False,indent=2))
  print(json.dumps(report,ensure_ascii=False),flush=True)
asyncio.run(run())

