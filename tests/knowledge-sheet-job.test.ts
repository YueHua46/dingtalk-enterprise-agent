import {describe,it,expect,vi} from 'vitest';
import {sheetExportResult,sheetExportDiagnostic,sheetExportProtocol} from '../src/knowledge-sheet-job.js';
import {asCliCommandError} from '../src/dws-broker.js';
describe('official sheet export protocol',()=>{
 it('unwraps official submit result and rejects business failures',()=>{
  expect(sheetExportResult({success:true,result:{jobId:'xlsx_123'}}).jobId).toBe('xlsx_123');
  expect(()=>sheetExportResult({success:false,error:{code:'ExportFailed'}})).toThrow('SERVER_ERROR');
 });
 it('retains bounded server identifiers from actual CLI embedded business diagnostics',()=>{
  const e=asCliCommandError([{text:JSON.stringify({error:{category:'api',code:1,reason:'business_error',message:'[MCP_TOOL_ERROR] '+JSON.stringify({error:{code:'invalidRequest.typeIllegal'},requestId:'req-123',secret:'never-export'})}})}]);
  expect(sheetExportDiagnostic(e)).toMatchObject({code:'invalidRequest.typeIllegal',requestId:'req-123',reason:'business_error'});
  expect(JSON.stringify(sheetExportDiagnostic(e))).not.toContain('never-export');
 });
 it('binds both commands to the same employee and never uses export to query',async()=>{
  const runCommand=vi.fn(async()=>({result:{jobId:'xlsx_123',status:'PROCESSING'}}));
  const user={corpId:'corp',userId:'employee'};
  const p=sheetExportProtocol({runCommand} as any,user,'node','unused',100,true);
  await p.submit();await p.query('xlsx_123');
  expect(runCommand.mock.calls.map(c=>(c as any[])[1])).toEqual([
   ['sheet','+knowledge-export-submit','--node','node'],['sheet','+knowledge-export-get','--job-id','xlsx_123']]);
  expect(runCommand.mock.calls.every(c=>(c as any[])[0]===user)).toBe(true);
 });
 it('rejects non-official payload URLs before requesting a file',async()=>{
  const p=sheetExportProtocol({} as any,{corpId:'corp',userId:'employee'},'node','unused',100,false);
  await expect(p.download('http://example.com/file')).rejects.toThrow('URL_INVALID');
 });
});
