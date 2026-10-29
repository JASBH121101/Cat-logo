import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const perfume = readFileSync(new URL("../perfumeria.js", import.meta.url), "utf8");
const techCss = readFileSync(new URL("../technology-visual-refresh.css", import.meta.url), "utf8");
const perfumeCss = readFileSync(new URL("../perfumeria.css", import.meta.url), "utf8");
const techHtml = readFileSync(new URL("../tecnologia/index.html", import.meta.url), "utf8");
const perfumeHtml = readFileSync(new URL("../perfumeria/index.html", import.meta.url), "utf8");

test("technology product detail turns commercial copy into safe paragraphs and bullet lists", () => {
  assert.match(app, /function renderCommercialDescription\(value, fallbackText\)/);
  assert.match(app, /source\.split\(\/\\n\+\//);
  assert.match(app, /class="commercial-copy-list"/);
  assert.match(app, /renderCommercialDescription\(product\.description, "Consultá disponibilidad y características\."/);
  assert.match(techCss, /\.commercial-copy-blocks/);
  assert.match(techCss, /\.commercial-copy-list/);
});

test("perfumery product detail uses the same organized commercial copy treatment", () => {
  assert.match(perfume, /function renderCommercialDescription\(value, fallbackText\)/);
  assert.match(perfume, /renderCommercialDescription\(product\.description, "Consultá por las notas y características de esta fragancia\."/);
  assert.match(perfumeCss, /\.perfume-page \.commercial-copy-blocks/);
  assert.match(perfumeCss, /\.perfume-page \.commercial-copy-list/);
});

test("all technology card sections share the compact information layout", () => {
  assert.match(techCss, /JB TECH · final readability pass for every product card and product detail/);
  assert.match(techCss, /body\.technology-catalog \.product-card-content\s*\{/);
  assert.match(techCss, /body\.technology-catalog \.product-view-button[\s\S]*?min-height:\s*33px/);
  assert.match(techCss, /@media \(max-width: 760px\)[\s\S]*?body\.technology-catalog \.product-card h3/);
  assert.match(techCss, /product-card-tag-exclusive/);
  assert.match(techCss, /product-card-tag-high_performance/);
  assert.match(techCss, /product-card-tag-top_gaming/);
  assert.match(techCss, /product-card-tag-quality_price/);
});

test("perfumery cards and product detail use a compact mobile rhythm and refreshed cache key", () => {
  assert.match(perfumeCss, /JB PARFUMS · cleaner compact cards and better-scannable commercial descriptions/);
  assert.match(perfumeCss, /\.perfume-page \.perfume-product-card h3\s*\{/);
  assert.match(perfumeCss, /\.perfume-page \.perfume-dialog-main-image\s*\{/);
  assert.match(perfumeCss, /@media \(max-width: 640px\)[\s\S]*?\.perfume-product-card-content/);
  assert.match(techHtml, /technology-visual-refresh\.css\?v=20261029-desktop-wide-audit3/);
  assert.match(perfumeHtml, /perfumeria\.css\?v=20261029-a11y-contrast3/);
});
