/** The Sub2API Responses bridge inserts an 8192-token cap when omitted.
 * Apply this application's Gemini default only to its configured model;
 * preserve every caller-supplied limit, including values upstream may reject. */
export function applyGeminiOutputBudget(body:Record<string,unknown>, configuredModel:string, defaultTokens:number): boolean {
  if (!Number.isSafeInteger(defaultTokens) || defaultTokens <= 0 || defaultTokens > 64000
    || !configuredModel.startsWith('gemini-') || body.model !== configuredModel
    || Object.hasOwn(body,'max_output_tokens') || Object.hasOwn(body,'max_tokens')) return false;
  body.max_output_tokens=defaultTokens;
  return true;
}
