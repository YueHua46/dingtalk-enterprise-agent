from __future__ import annotations

import unittest

from amazon_skill.listing import parse_product_detail
from amazon_skill.marketplaces import get_marketplace, product_url
from amazon_skill.money import parse_price
from amazon_skill.promotions import parse_promotions
from amazon_skill.related import parse_related_products
from amazon_skill.reviews import parse_reviews
from amazon_skill.search import parse_search_asins, parse_search_results

SEARCH_HTML = '''<html><body><div id="s-main-slot"><div data-component-type="s-search-result" data-asin="B000000001"><h2><a href="/dp/B000000001"><span>Organic Camera</span></a></h2><span class="a-price"><span class="a-offscreen">$39.99</span></span><span class="a-icon-alt">4.5 out of 5 stars</span><span class="s-underline-text">1,234</span></div><div data-component-type="s-search-result" data-asin="B000000002" class="AdHolder"><h2><a href="/sspa/click"><span>Sponsored Camera</span></a></h2></div></div></body></html>'''
DETAIL_HTML = '''<html><body><span id="productTitle">Test Camera</span><a id="bylineInfo">Visit the ACME Store</a><div id="corePrice_feature_div"><span class="a-offscreen">$49.99</span></div><span id="acrPopover"><span class="a-icon-alt">4.4 out of 5 stars</span></span><span id="acrCustomerReviewText">2,345 ratings</span><div id="feature-bullets"><li><span class="a-list-item">1080p video</span></li></div><div id="availability">In Stock</div><img id="landingImage" src="https://example.com/a.jpg" /></body></html>'''
REVIEW_HTML = '''<html><body><div data-hook="review" id="R1"><span class="a-profile-name">Alice</span><i data-hook="review-star-rating"><span class="a-icon-alt">2.0 out of 5 stars</span></i><a data-hook="review-title">Not great</a><span data-hook="review-date">Reviewed on August 1, 2026</span><span data-hook="avp-badge">Verified Purchase</span><span data-hook="review-body">Battery was weak.</span><span data-hook="helpful-vote-statement">3 people found this helpful</span></div></body></html>'''
RELATED_HTML = '''<html><body><div id="sims-simsContainer_feature_div_01"><ol><li class="a-carousel-card" data-asin="B000000003"><a href="/dp/B000000003"><img alt="Related Camera" src="https://example.com/r.jpg" /></a><span class="a-price"><span class="a-offscreen">$29.99</span></span><span class="a-icon-alt">4.3 out of 5 stars</span><span class="a-size-small">321</span></li></ol></div></body></html>'''
PROMO_HTML = '''<html><body><div id="dealBadgeSupportContent"><span>Limited time deal</span></div><div id="promoPriceBlockMessage">Save 10% with coupon</div></body></html>'''


class ParserTests(unittest.TestCase):
    def test_search_classification(self) -> None:
        parsed = parse_search_asins(SEARCH_HTML)
        self.assertEqual(parsed["organic"], ["B000000001"])
        self.assertEqual(parsed["sponsored"], ["B000000002"])
        items = parse_search_results(SEARCH_HTML, keyword="camera", marketplace="US", page=1)
        self.assertEqual(items[0]["organic_rank"], 1)
        self.assertEqual(items[0]["price"], 39.99)

    def test_product_detail(self) -> None:
        item = parse_product_detail(DETAIL_HTML, asin="B000000001", marketplace="US")
        self.assertEqual(item["title"], "Test Camera")
        self.assertEqual(item["price"], 49.99)
        self.assertEqual(item["review_count"], 2345)
        self.assertEqual(item["images"], ["https://example.com/a.jpg"])

    def test_be_marketplace_detail(self) -> None:
        market = get_marketplace("BE")
        self.assertEqual(product_url(market, "B0CWNV3689"), "https://www.amazon.com.be/dp/B0CWNV3689")
        item = parse_product_detail(DETAIL_HTML, asin="B0CWNV3689", marketplace="BE")
        self.assertEqual(item["images"], ["https://example.com/a.jpg"])

    def test_european_and_us_price_formats(self) -> None:
        self.assertEqual(parse_price("279,95€"), 279.95)
        self.assertEqual(parse_price("1.299,95 €"), 1299.95)
        self.assertEqual(parse_price("$1,299.95"), 1299.95)
        self.assertEqual(parse_price("$1,299"), 1299.0)

    def test_reviews(self) -> None:
        items = parse_reviews(REVIEW_HTML, asin="B000000001", marketplace="US")
        self.assertEqual(items[0]["rating"], 2.0)
        self.assertEqual(items[0]["helpful_count"], 3)
        self.assertTrue(items[0]["verified_purchase"])

    def test_related(self) -> None:
        items = parse_related_products(RELATED_HTML, marketplace="US", page_asin="B000000001")
        self.assertEqual(items[0]["asin"], "B000000003")
        self.assertEqual(items[0]["price"], 29.99)

    def test_promotions(self) -> None:
        data = parse_promotions(PROMO_HTML, marketplace="US")
        self.assertIn("Limited time deal", data["deal_badges"])
        self.assertIn("Save 10% with coupon", data["coupon_promotions"])


if __name__ == "__main__":
    unittest.main()
