import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const provider = readFileSync("admin-provider.js", "utf8");
const html = readFileSync("admin.html", "utf8");
const css = readFileSync("admin-provider.css", "utf8");
const admin = readFileSync("admin.js", "utf8");

test("provider review displays current perfume identity and price comparison", () => {
  assert.match(html, /id="provider-review-product-details"/);
  assert.match(html, /id="provider-review-price-comparison"/);
  assert.match(provider, /function renderReviewProductDetails\(product\)/);
  assert.match(provider, /detail\.audience/);
  assert.match(provider, /detail\.concentration/);
  assert.match(provider, /detail\.volume_ml/);
  assert.match(provider, /detail\.family/);
  assert.match(provider, /product\.price_usd/);
  assert.match(provider, /product\.price_nio/);
  assert.match(admin, /admin-provider\.js\?v=20261028-sidebar-settings3/);
});

test("review synchronizes both public prices only when both supplier prices are entered", () => {
  assert.match(provider, /const hasBothProviderPrices = priceUSD !== null && priceNIO !== null/);
  assert.match(provider, /from\("products"\)\.update\(\{ price_usd: priceUSD, price_nio: priceNIO \}\)/);
  assert.match(provider, /\.eq\("id", product\.id\)/);
  assert.match(provider, /\.eq\("catalog_type", product\.catalog_type\)/);
  assert.match(provider, /el catálogo no se modificó/);
  assert.match(provider, /coincide con el publicado; no fue necesario modificarlo/);
  assert.match(provider, /jb-catalog-provider-updated/);
});

test("provider review details are responsive and use existing theme tokens", () => {
  assert.match(css, /provider-review-current-card/);
  assert.match(css, /var\(--surface/);
  assert.match(css, /@media\(max-width:480px\)/);
  assert.match(html, /admin-provider\.css\?v=20261028-sidebar-settings3/);
});
