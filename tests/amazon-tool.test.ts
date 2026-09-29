import { describe, expect, it } from 'vitest';
import { AmazonTool, amazonDynamicTools } from '../src/amazon-tool.js';

describe('Amazon tool boundary', () => {
  const tool = new AmazonTool({ python: 'unused' });

  it('registers all seven atomic capabilities', () => {
    expect(amazonDynamicTools[0]?.tools.map((item) => item.name)).toEqual([
      'search_products', 'image_search', 'get_product_detail', 'get_related_products',
      'get_promotions', 'get_reviews', 'get_keyword_rank'
    ]);
    expect(amazonDynamicTools[0]?.tools.every((item) => item.inputSchema.required.includes('marketplace'))).toBe(true);
  });

  it('rejects a product URL from another marketplace', async () => {
    await expect(tool.execute('get_product_detail', {
      asin: 'https://www.amazon.com/dp/B0CWNV3689', marketplace: 'BE'
    })).rejects.toThrow('AMAZON_PRODUCT_URL_MARKETPLACE_MISMATCH');
  });

  it('only permits current-task image attachment IDs and supported StyleSnap marketplaces', async () => {
    await expect(tool.execute('image_search', {
      inputAttachmentIds: ['other-task-image'], marketplace: 'DE'
    }, [])).rejects.toThrow('AMAZON_IMAGE_ATTACHMENT_UNAVAILABLE');
    await expect(tool.execute('image_search', {
      inputAttachmentIds: ['current-image'], marketplace: 'BE'
    }, [])).rejects.toThrow('AMAZON_STYLESNAP_MARKETPLACE_UNSUPPORTED');
  });

  it('rejects inverted review rating bounds', async () => {
    await expect(tool.execute('get_reviews', {
      asin: 'B0CWNV3689', marketplace: 'BE', minRating: 5, maxRating: 1
    })).rejects.toThrow('AMAZON_RATING_RANGE_INVALID');
  });
});
