import { readFile, writeFile } from 'node:fs/promises';
import { prepareListingInput } from '../dist/listing-input.js';
import { buildProductFactBook } from '../dist/listing-facts.js';
import { ListingResearchService, loadResearchPolicy } from '../dist/listing-research.js';
import { buildListingContentPlan, loadPlanningPolicy } from '../dist/listing-planning.js';
// Fictional product and market sample; no network, credentials or messages.
const content = await readFile(new URL('../examples/listing/camera-product.txt', import.meta.url), 'utf8');
const input = prepareListingInput({ mode: 'create', productType: 'indoor security camera',
  keywords: ['indoor security camera', '2k camera', '4k camera'],
  materials: [{ id: 'sample', kind: 'conversation', reference: 'sample', content }],
  competitors: { strategy: 'specified', asins: ['B0TEST0001'] } }, {
  request: { requestId: 'fictional-planning-sample', messageId: 'sample', text: content,
    user: { corpId: 'sample', userId: 'sample' }, surface: { type: 'direct', id: 'sample' }, attachments: [] },
  documentSnapshots: {}, listingSnapshots: {},
});
const amazon = { async execute(operation, args) {
  return operation === 'get_product_detail'
    ? { tool: 'amazon.get_product_detail', marketplace: 'US', data: { asin: args.asin, marketplace: 'US', title: 'Indoor security camera', bullets: ['4k camera with color night vision'] } }
    : { tool: 'amazon.get_reviews', marketplace: 'US', asin: args.asin, source: 'review_pages', sample_limit: 'requested_review_pages',
      items: [{ asin: args.asin, marketplace: 'US', review_id: 'fictional-review', title: 'Fictional sample', content: 'Setup was easy. Subscription costs extra. SD card sold separately.', rating: 4, date_text: '', variant: '' }] };
} };
const research = await new ListingResearchService(amazon, await loadResearchPolicy(new URL('../config/listing-research.json', import.meta.url))).research(input);
const plan = buildListingContentPlan(buildProductFactBook(input), research, await loadPlanningPolicy(new URL('../config/listing-planning.json', import.meta.url)));
await writeFile(new URL('../examples/listing/planning-sample.json', import.meta.url), JSON.stringify({ kind: 'fictional_mock_sample', plan }, null, 2));
console.log(JSON.stringify({ status: plan.status, sellingPoints: plan.sellingPoints.length, topics: plan.insights.length }));
