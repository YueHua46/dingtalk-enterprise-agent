/** Real model -> dynamic tool routing smoke. Requires the configured model account. */
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CodexClient } from '../dist/codex-client.js';
import { loadConfig } from '../dist/config.js';
import { AmazonTool } from '../dist/amazon-tool.js';
import { GuideTool } from '../dist/guide-tool.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test', FILE_WORKER_MODE: 'off', DINGTALK_ROBOT_CODE: process.env.DINGTALK_ROBOT_CODE || 'smoke-robot', CODEX_WORKDIR: process.env.CODEX_WORKDIR || process.cwd(), SKILLS_DIR: process.env.SKILLS_DIR || resolve('skills') });
const imagePath = process.env.AMAZON_E2E_IMAGE;
const image = imagePath ? { id: 'fixture-image', name: 'product.jpg', sourceType: 'image', contentType: 'image/jpeg', localPath: resolve(imagePath), size: (await stat(imagePath)).size } : undefined;
const allCases = [
  ['search_products', '在 Amazon 比利时站搜索 wireless camera，给我前五个商品。'],
  ['search_products', '帮我找 BE 站 security camera 的自然搜索候选，按页面顺序列出。'],
  ['image_search', '用我上传的图片，在 Amazon 德国站找五个外观相近的商品。', true],
  ['image_search', '这张图在 Amazon 美国站有哪些相似款？先用以图搜品工具。', true],
  ['get_product_detail', '查询 BE 站 ASIN B0CWNV3689 的标题和主图。'],
  ['get_product_detail', '解析 https://www.amazon.com.be/dp/B0CWNV3689 的商品详情，尤其图片。'],
  ['get_related_products', 'B0CWNV3689 在比利时站商品页推荐了哪些关联商品？'],
  ['get_related_products', '看看 https://www.amazon.com.be/dp/B0CWNV3689 页面里顾客还看了什么商品。'],
  ['get_promotions', '比利时站 B0CWNV3689 现在有没有 Coupon 或 Deal？'],
  ['get_promotions', '解析这个链接目前显示的优惠文案：https://www.amazon.com.be/dp/B0CWNV3689'],
  ['get_reviews', '采样 BE 站 B0CWNV3689 页面可见的买家评论，说明样本来源。'],
  ['get_reviews', '这款比利时商品的 4 到 5 星评价说了什么：https://www.amazon.com.be/dp/B0CWNV3689'],
  ['get_keyword_rank', '查美国站 ASIN B0DHLQT3CG 对 security camera 的自然排名。'],
  ['get_keyword_rank', 'B0DHLQT3CG 在 Amazon US 的 security camera 搜索结果有没有 SP 广告位？']
];
const only = process.env.AMAZON_E2E_TOOL;
const cases = only ? allCases.filter(([name]) => name === only) : allCases;
const client = new CodexClient(config);
const amazon = new AmazonTool();
const guide = new GuideTool(config);
const results = [];
try {
  for (const [expected, question, useImage] of cases) {
    const calls = [];
    try {
      const thread = await client.startThread({ corpId: 'smoke', userId: 'amazon-e2e' });
      const prompt = `使用 amazon-page-research Skill 和其 Amazon 原子工具回答。只调用最直接的 Amazon 工具；工具返回不可用时如实说明，不要重试其他 Amazon 工具。${useImage ? '本任务图片附件 ID 是 fixture-image，调用 image_search 时传入 inputAttachmentIds: ["fixture-image"]。' : ''}问题：${question}`;
      const result = await client.turn(thread, prompt, undefined, async (request) => {
        if (request.method !== 'item/tool/call') return { contentItems: [{ type: 'inputText', text: 'unavailable' }], success: false };
        const { namespace, tool, arguments: args } = request.params;
        if (namespace === 'reference' && tool === 'read_guide') {
          try { const guideResult = await guide.execute(args); return { contentItems: [{ type: 'inputText', text: guideResult.text }], success: true }; }
          catch (error) { return { contentItems: [{ type: 'inputText', text: String(error) }], success: false }; }
        }
        if (namespace === 'amazon') {
          try {
            const value = await amazon.execute(tool, args, image ? [image] : []);
            calls.push({ tool, status: value?.status ?? 'returned', inputAttachmentIds: args?.inputAttachmentIds });
            return { contentItems: [{ type: 'inputText', text: JSON.stringify(value) }], success: value?.status !== 'unavailable' };
          } catch (error) {
            calls.push({ tool, error: error instanceof Error ? error.message : String(error), inputAttachmentIds: args?.inputAttachmentIds });
            return { contentItems: [{ type: 'inputText', text: calls.at(-1).error }], success: false };
          }
        }
        return { contentItems: [{ type: 'inputText', text: 'This isolated smoke permits only amazon and reference tools.' }], success: false };
      }, useImage && image ? [image] : []);
      const ok = calls.some((call) => call.tool === expected && !call.error && call.status !== 'unavailable');
      results.push({ expected, question, ok, calls, answerChars: result.text.length });
    } catch (error) {
      results.push({ expected, question, ok: false, calls, error: error instanceof Error ? error.message.slice(0, 250) : String(error) });
      console.log(JSON.stringify(results.at(-1)));
      if (/no available accounts|\b503\b|rate.limit/i.test(String(error))) break;
      continue;
    }
    console.log(JSON.stringify(results.at(-1)));
  }
} finally { await client.stop(); }
console.log(JSON.stringify({ completed: results.length, passed: results.filter((item) => item.ok).length, planned: cases.length }));
if (results.length !== cases.length || results.some((item) => !item.ok)) process.exitCode = 1;
