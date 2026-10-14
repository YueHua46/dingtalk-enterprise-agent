"""Save the observed task, tool timings, workflow and delivered files for review."""
import json
import pathlib
import subprocess
import sys
import uuid

task_id = str(uuid.UUID(sys.argv[1]))
dest = pathlib.Path(sys.argv[2])
dest.mkdir(parents=True, exist_ok=True)
worker = 'dingtalk-enterprise-agent-file-worker-1'

def run(args):
    return subprocess.run(args, capture_output=True, check=True).stdout

def query(sql):
    raw = run(['docker', 'exec', 'dingtalk-enterprise-agent-postgres-1', 'psql', '-U', 'agent', '-d', 'agent', '-At', '-c', sql])
    return json.loads(raw)

task = query(f"SELECT json_build_object('id',id,'status',status,'created_at',created_at,'started_at',started_at,'finished_at',finished_at,'answer',result_summary,'request',request_payload->>'text') FROM tasks WHERE id='{task_id}'")
workflow = query(f"SELECT state FROM task_workflows WHERE task_id='{task_id}'")
events = query(f"SELECT COALESCE(json_agg(json_build_object('at',created_at,'type',event_type,'payload',payload) ORDER BY created_at),'[]'::json) FROM audit_events WHERE task_id='{task_id}' AND event_type IN ('tool.call_started','tool.call_finished','artifact.review','artifact.submitted','artifact.delivered','workflow.review','workflow.checkpoint_reused','workflow.tool_budget_exhausted','workflow.deadline_exceeded','model.retry_scheduled','task.failed','task.completed')")
for name, value in [('task', task), ('workflow', workflow), ('events', events)]:
    (dest / f'{name}.json').write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
for event in events:
    if event['type'] != 'artifact.submitted':
        continue
    name = event['payload']['name']
    if pathlib.PurePosixPath(name).name != name:
        raise ValueError('unexpected artifact name')
    file_path = f'/work/tasks/{task_id}/output/{name}'
    (dest / name).write_bytes(run(['docker', 'exec', worker, 'cat', file_path]))
    result = subprocess.run(['docker', 'exec', '-i', worker, '/opt/venv/bin/python', '-', file_path],
                            input=pathlib.Path('file-skills/output_text.py').read_bytes(), capture_output=True, check=True)
    extracted = json.loads(result.stdout)
    if extracted['text'] is not None:
        (dest / (name + '.txt')).write_text(extracted['text'], encoding='utf-8')
(dest / 'evidence').mkdir(exist_ok=True)
run(['docker', 'cp', f'{worker}:/work/tasks/{task_id}/evidence/.', str(dest / 'evidence')])
print(json.dumps({'taskId': task_id, 'status': task['status'], 'events': len(events), 'output': str(dest)}, ensure_ascii=False))
