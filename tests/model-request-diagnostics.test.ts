import {describe,it,expect} from 'vitest';
import {modelRequestDiagnostics,modelTransportDiagnostics} from '../src/model-request-diagnostics.js';
import {adaptModelRequest} from '../src/model-tool-proxy.js';

describe('model request structural diagnostics',()=>{
  it('records nested transport causes without messages, stacks or arbitrary codes',()=>{
    const cause=Object.assign(new Error('https://secret.example/token'),{code:'UND_ERR_SOCKET'});
    const error=new TypeError('private model output',{cause});
    expect(modelTransportDiagnostics(error)).toEqual({transportCauses:[{name:'TypeError'},{name:'Error',code:'UND_ERR_SOCKET'}]});
    const secret={name:'secret',code:'SECRET_TOKEN',message:'private',cause:null as unknown};
    secret.cause=secret;
    expect(modelTransportDiagnostics(secret)).toEqual({transportCauses:[{name:'other'}]});
    expect(JSON.stringify(modelTransportDiagnostics(error))).not.toContain('secret');
  });
  it('distinguishes omitted output limits from an explicit cap and preserves them through compatibility adaptation',()=>{
    const original={model:'gemini-3.8-flash-high',stream:true,max_output_tokens:32768,reasoning:{effort:'high',summary:'auto'},
      input:[{role:'user',content:'private question'},{type:'function_call_output',output:'private result'}],
      tools:[{type:'namespace',name:'private_namespace',tools:[{type:'function',name:'private_tool',description:'private schema'}]}]};
    const adapted=adaptModelRequest(original).body;
    const summary=modelRequestDiagnostics(adapted,original.model);
    expect(summary).toMatchObject({modelMatchesConfigured:true,maxOutputTokens:32768,maxTokens:'absent',reasoningEffort:'high',
      reasoningSummary:'auto',stream:true,inputItems:2,toolCount:1,inputTypes:{message:1,function_call_output:1},toolTypes:{function:1}});
    expect(summary.inputChars).toBe(JSON.stringify(original.input).length);
    expect(summary.toolChars).toBe(JSON.stringify(adapted.tools).length);
    expect(modelRequestDiagnostics({}).maxOutputTokens).toBe('absent');
  });
  it('does not log arbitrary model strings, keys, tool names, arguments, or prompt data',()=>{
    const secret='secret-credential-or-business-content';
    const body={model:secret,instructions:secret,max_output_tokens:secret,max_tokens:-1,reasoning:{effort:secret,summary:secret},
      input:[{type:secret,content:secret,arguments:secret,[secret]:secret}],tools:[{type:secret,name:secret,parameters:secret}]};
    const summary=modelRequestDiagnostics(body,'gemini-3.8-flash-high');
    expect(summary).toMatchObject({modelMatchesConfigured:false,maxOutputTokens:'invalid',maxTokens:'invalid',reasoningEffort:'other',
      reasoningSummary:'other',inputTypes:{other:1},toolTypes:{other:1}});
    expect(JSON.stringify(summary)).not.toContain(secret);
  });
});
