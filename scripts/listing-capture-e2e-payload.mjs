// Read-only evidence capture for an explicitly authorized, known Listing session.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {buildListingExport} from '../dist/listing-export.js';
const [sessionId,output='output/listing/e2e/expected-payload.json']=process.argv.slice(2);
if(!/^[a-f0-9-]{36}$/.test(sessionId??''))throw new Error('Known session UUID required');
const sql=`SELECT json_build_object('versions',(SELECT json_agg(payload_text::json ORDER BY ordinal DESC) FROM listing_revision_versions v WHERE v.request_id=s.session_id AND v.corp_id=s.corp_id AND v.user_id=s.user_id AND v.surface_type=s.surface_type AND v.surface_id=s.surface_id),'session',s.payload_text::json)::text FROM listing_tool_sessions s WHERE session_id='${sessionId}';`;
const data=JSON.parse(execFileSync('docker',['compose','exec','-T','postgres','psql','-U','agent','-d','agent','-At','-c',sql],{encoding:'utf8',maxBuffer:8_000_000}));
const [version,previous]=data.versions??[];
data.research=data.session?.research;
if(!version)throw new Error('No saved generation');
const payload=buildListingExport(version.scope,version,version.context,{...(previous?{previous}:{}),...(data.research?{research:data.research}:{})});
await mkdir('output/listing/e2e',{recursive:true});
await writeFile(output,JSON.stringify(payload,null,2));
const result={sessionId,versionId:version.id,ordinal:version.ordinal,model:version.generationReceipt?.metadata.model,
  promptVersion:version.generationReceipt?.metadata.promptVersion,ruleVersion:version.context.rules.version,
  validation:version.validation.status,metrics:version.validation.metrics,researchStatus:data.research?.status,
  difference:version.difference,expectedPayload:output};
await writeFile(output.replace(/\.json$/,'.evidence.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
