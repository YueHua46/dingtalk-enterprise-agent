/** Live public-Amazon smoke matrix. Each primitive is exercised with two user phrasings. */
import { AmazonTool } from '../dist/amazon-tool.js';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const python = process.env.AMAZON_SKILL_PYTHON || '/opt/amazon-venv/bin/python';
const cwd = process.env.AMAZON_SKILL_DIR || '/opt/amazon-skill';
const imagePath = process.env.AMAZON_E2E_IMAGE;
const image = imagePath ? { id: 'fixture-image', name: 'product.jpg', sourceType: 'image', contentType: 'image/jpeg', localPath: resolve(imagePath), size: (await stat(imagePath)).size } : undefined;
const tool = new AmazonTool({ python, cwd, timeoutMs: 90_000 });
const asin = 'B0CWNV3689';
const url = `https://www.amazon.com.be/dp/${asin}`;
const cases = [
  ['关键词搜索', 'BE 站搜 wireless camera 有哪些商品？', 'search_products', { keywords: ['wireless camera'], marketplace: 'BE', maxPages: 1, maxResults: 5 }],
  ['关键词搜索', '找比利时站 security camera 的自然搜索候选', 'search_products', { keywords: ['security camera'], marketplace: 'BE', maxPages: 1, maxResults: 5, organicOnly: true }],
  ['以图搜品', '用我上传的产品图找相似款', 'image_search', { inputAttachmentIds: ['fixture-image'], marketplace: 'DE', maxResults: 5 }],
  ['以图搜品', '这张照片在 Amazon US 有哪些类似产品？', 'image_search', { inputAttachmentIds: ['fixture-image'], marketplace: 'US', maxResults: 5 }],
  ['ASIN详情', '看看这个 ASIN 的标题和主图', 'get_product_detail', { asin, marketplace: 'BE' }],
  ['ASIN详情', '解析这个比利时商品链接的图片', 'get_product_detail', { asin: url, marketplace: 'BE' }],
  ['关联商品', '这款商品页面推荐了哪些关联商品？', 'get_related_products', { asin, marketplace: 'BE' }],
  ['关联商品', '链接的 Frequently Bought Together 有什么？', 'get_related_products', { asin: url, marketplace: 'BE' }],
  ['促销', '这个 ASIN 当前有 Coupon 吗？', 'get_promotions', { asin, marketplace: 'BE' }],
  ['促销', '解析这个链接的 Deal 和折扣文案', 'get_promotions', { asin: url, marketplace: 'BE' }],
  ['评论', '采样这款商品页面可见的买家评价', 'get_reviews', { asin, marketplace: 'BE', maxPages: 1 }],
  ['评论', '看看这条链接的 4 到 5 星买家怎么说', 'get_reviews', { asin: url, marketplace: 'BE', maxPages: 1, minRating: 4, maxRating: 5 }],
  ['关键词排名', '查某款 US 商品在 security camera 的自然位', 'get_keyword_rank', { asin: 'B0DHLQT3CG', keyword: 'security camera', marketplace: 'US', rankType: 'organic', maxPages: 1 }],
  ['关键词排名', '它在 security camera 下的 SP 广告位？', 'get_keyword_rank', { asin: 'https://www.amazon.com/dp/B0DHLQT3CG', keyword: 'security camera', marketplace: 'US', rankType: 'sp', maxPages: 1 }]
];
const results = [];
for (const [family, question, operation, args] of cases) {
  try {
    const result = await tool.execute(operation, args, image ? [image] : []);
    const data = result?.data ?? result;
    const valid = result?.status !== 'unavailable' && result?.tool === `amazon.${operation}`;
    results.push({ family, question, operation, ok: valid, count: result?.count ?? data?.length ?? data?.images?.length, status: result?.status ?? 'returned', error: result?.error_code });
  } catch (error) {
    results.push({ family, question, operation, ok: false, error: error instanceof Error ? error.message.slice(0, 250) : String(error) });
  }
  console.log(JSON.stringify(results.at(-1)));
}
console.log(JSON.stringify({ total: results.length, passed: results.filter((row) => row.ok).length, failed: results.filter((row) => !row.ok).length }));
if (results.some((row) => !row.ok)) process.exitCode = 1;
