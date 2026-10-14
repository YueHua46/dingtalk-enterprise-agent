import {describe,it,expect} from 'vitest';
import {applyGeminiOutputBudget} from '../src/model-output-budget.js';
import {loadConfig} from './test-config.js';

const model='gemini-3.8-flash-high';
describe('configured Gemini Responses output budget',()=>{
  it('fills only an absent cap while preserving thinking, tool definitions, and history',()=>{
    const body={model,reasoning:{effort:'high'},tools:[{type:'function',name:'tool',parameters:{type:'object'}}],input:[{role:'user',content:'question'}]};
    const original=structuredClone(body);
    expect(applyGeminiOutputBudget(body,model,64000)).toBe(true);
    expect(body).toEqual({...original,max_output_tokens:64000});
  });
  it.each([1,8192,65536,0,null,-1,'invalid'])('never overwrites caller cap %s',cap=>{
    const body={model,max_output_tokens:cap};expect(applyGeminiOutputBudget(body,model,32768)).toBe(false);
    expect(body.max_output_tokens).toBe(cap);
  });
  it('leaves other models, disabled defaults, and explicit legacy caps untouched',()=>{
    for(const [body,configured,budget] of [[{model:'gpt-5.6-sol'},'gpt-5.6-sol',32768],[{model:'gemini-other'},model,32768],
      [{model},model,0],[{model,max_tokens:400},model,32768]] as const) {
      const before=structuredClone(body);expect(applyGeminiOutputBudget(body,configured,budget)).toBe(false);expect(body).toEqual(before);
    }
  });
  it('defaults to 32768 and validates an operator-configurable 0..64000 bound',()=>{
    expect(loadConfig({DINGTALK_ROBOT_CODE:'bot'}).GEMINI_RESPONSES_DEFAULT_MAX_OUTPUT_TOKENS).toBe(32768);
    for(const cap of ['0','64000']) expect(loadConfig({DINGTALK_ROBOT_CODE:'bot',GEMINI_RESPONSES_DEFAULT_MAX_OUTPUT_TOKENS:cap}).GEMINI_RESPONSES_DEFAULT_MAX_OUTPUT_TOKENS).toBe(Number(cap));
    expect(()=>loadConfig({DINGTALK_ROBOT_CODE:'bot',GEMINI_RESPONSES_DEFAULT_MAX_OUTPUT_TOKENS:'64001'})).toThrow();
  });
});
