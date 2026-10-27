import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const js = readFileSync(new URL("../perfumeria.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../perfumeria.css", import.meta.url), "utf8");

test("perfume cards show only compact essentials and keep the public in the detail sheet", () => {
  const start = js.indexOf("function renderCard(product)");
  const end = js.indexOf("\nfunction ", start + 10);
  assert.ok(start >= 0 && end > start, "renderCard has a clear boundary");
  const card = js.slice(start, end);
  assert.doesNotMatch(card, /familyLabel|detail\.audience|detail\.scent_family|perfume-card-brand|perfume-card-scent/);
  assert.match(card, /productMeta/);
  assert.match(card, /formatUSD\(product\.price_usd\)/);
  assert.match(card, /formatNIO\(product\.price_nio\)/);
  assert.match(card, />Ver producto </);
  assert.match(js, /audienceDisplay\(detail\.audience\)/);
  assert.match(js, /\[\s*hombre:\s*"Varón",\s*mujer:\s*"Mujer",\s*unisex:\s*"Unisex"\s*\]/);
});

test("perfume cards align action buttons to one baseline and use identical dimensions", () => {
  assert.match(css, /\.perfume-page \.perfume-product-card \.product-actions\s*\{[^}]*margin-top:\s*auto/s);
  assert.match(css, /\.perfume-page \.perfume-product-card \.perfume-view-button\s*\{[^}]*width:\s*100%[^}]*height:\s*40px/s);
  assert.match(css, /@media \(max-width:\s*640px\)\s*\{[^}]*\.perfume-page \.perfume-product-card \.perfume-view-button\s*\{[^}]*height:\s*36px/s);
  assert.match(css, /-webkit-line-clamp:\s*2/);
});
