/** Structural diagnostics only: never retain prompt text, arbitrary keys,
 * tool names/arguments, schema contents, URLs, credentials, or model output. */
export function modelRequestDiagnostics(body: Record<string,unknown>, expectedModel?: string) {
  const object = (value:unknown):Record<string,unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
  const chars = (value:unknown) => value === undefined ? 0 : JSON.stringify(value)?.length ?? 0;
  const limit = (value:unknown) => value === undefined ? 'absent' : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 'invalid';
  const known = (value:unknown, values:string[]) => value === undefined ? 'absent' : typeof value === 'string' && values.includes(value) ? value : 'other';
  const input=Array.isArray(body.input)?body.input:[];
  const tools=Array.isArray(body.tools)?body.tools:[];
  const inputTypes:Record<string,number>={};
  const toolTypes:Record<string,number>={};
  for(const value of input) {
    const item=object(value);
    const type=known(item.type ?? (typeof item.role === 'string'?'message':undefined),
      ['message','function_call','function_call_output','reasoning','item_reference','additional_tools','tool_search_call','tool_search_output','custom_tool_call','custom_tool_call_output']);
    inputTypes[type]=(inputTypes[type]??0)+1;
  }
  for(const value of tools) {
    const type=known(object(value).type,['function','namespace','web_search','web_search_preview','custom','tool_search','computer','computer_use_preview','file_search','code_interpreter','image_generation','mcp','shell','apply_patch']);
    toolTypes[type]=(toolTypes[type]??0)+1;
  }
  const reasoning=object(body.reasoning);
  return {
    modelMatchesConfigured:typeof body.model==='string' && body.model===expectedModel,
    maxOutputTokens:limit(body.max_output_tokens),maxTokens:limit(body.max_tokens),
    reasoningEffort:known(reasoning.effort,['none','minimal','low','medium','high','xhigh','max','ultra']),
    reasoningSummary:known(reasoning.summary,['auto','concise','detailed']),
    stream:body.stream===true,inputItems:input.length,inputChars:chars(body.input),
    instructionChars:typeof body.instructions==='string'?body.instructions.length:0,
    toolCount:tools.length,toolChars:chars(body.tools),inputTypes,toolTypes,
  };
}
