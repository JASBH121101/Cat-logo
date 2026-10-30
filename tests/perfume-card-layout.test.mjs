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
  const audienceStart = js.indexOf("function audienceDisplay(value)");
  const audienceEnd = js.indexOf("\n}", audienceStart) + 2;
  assert.ok(audienceStart >= 0 && audienceEnd > audienceStart, "audience display helper exists");
  const audienceHelper = js.slice(audienceStart, audienceEnd);
  assert.match(audienceHelper, /hombre:\s*"Varón"/);
  assert.match(audienceHelper, /mujer:\s*"Mujer"/);
  assert.match(audienceHelper, /unisex:\s*"Unisex"/);
});

test("perfume cards align action buttons to one baseline and use identical dimensions", () => {
  assert.match(css, /body\.perfume-page \.perfume-product-card \.product-actions\s*\{[^}]*margin-top:\s*auto/s);
  assert.match(css, /\.perfume-page \.perfume-product-card \.perfume-view-button\s*\{[^}]*width:\s*100%[^}]*height:\s*40px/s);
  assert.match(css, /@media \(max-width:\s*640px\)[\s\S]{0,350}\.perfume-page \.perfume-product-card \.perfume-view-button[\s\S]{0,180}height:\s*36px/);
  assert.match(css, /body\.perfume-page \.perfume-product-card h3\s*\{[^}]*min-height:\s*2\.7em/s);
  assert.match(css, /-webkit-line-clamp:\s*2/);
});

test("perfume prices keep the luxury serif but use stronger, clearer numerals on mobile and desktop", () => {
  assert.match(css, /body\.perfume-page \.perfume-product-card \.perfume-product-price\s*\{[^}]*font-family:\s*"Playfair Display"[^}]*font-size:\s*clamp\(25px,\s*1\.8vw,\s*29px\)[^}]*font-weight:\s*700/s);
  assert.match(css, /font-variant-numeric:\s*lining-nums tabular-nums/);
  assert.match(css, /body\.perfume-page \.perfume-product-card \.perfume-product-price-secondary\s*\{[^}]*font-size:\s*13px[^}]*font-weight:\s*600/s);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?body\.perfume-page \.perfume-product-card \.perfume-product-price\s*\{[^}]*font-size:\s*clamp\(24px,\s*6\.1vw,\s*28px\)[^}]*font-weight:\s*700/s);
  assert.match(css, /body\.perfume-page \.perfume-product-card \.perfume-product-meta\s*\{[^}]*font-size:\s*10px/s);
});
