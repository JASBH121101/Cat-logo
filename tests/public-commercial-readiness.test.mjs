import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const assistant = readFileSync(new URL("../ai-assistant.js", import.meta.url), "utf8");
const assistantCss = readFileSync(new URL("../ai-assistant.css", import.meta.url), "utf8");
const techHtml = readFileSync(new URL("../tecnologia/index.html", import.meta.url), "utf8");
const perfumeHtml = readFileSync(new URL("../perfumeria/index.html", import.meta.url), "utf8");
const homeHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("all JB TECH product grids use the same detail and broken-image handlers", () => {
  assert.match(app, /querySelectorAll\("#product-grid, #featured-grid, #high-performance-grid, #quality-price-grid, #top-gaming-grid"\)/);
  assert.match(app, /data-product-image/);
  assert.match(techHtml, /id="high-performance-grid"/);
  assert.match(techHtml, /id="quality-price-grid"/);
  assert.match(techHtml, /id="top-gaming-grid"/);
});

test("category filters match normalized public categories and announce selected state accessibly", () => {
  assert.match(app, /const normalizedCategory = canonicalCatalogCategory\(product\);[\s\S]*?normalizedCategory\.toLocaleLowerCase\("es"\)/);
  assert.match(app, /button\.setAttribute\("aria-pressed", String\(isSelected\)\)/);
  const categoryButtons = [...techHtml.matchAll(/<button[^>]*data-category="[^"]+"[^>]*>/g)].map(m => m[0]);
  assert.ok(categoryButtons.length > 1);
  for (const button of categoryButtons) assert.match(button, /aria-pressed="(?:true|false)"/);
});

test("the technology WhatsApp action follows actual variant/product availability", () => {
  assert.match(app, /function buildProductWhatsAppMessage\(product, variant = null, fallbackColor = null\)[\s\S]*?quisiera consultar cómo pedir este producto[\s\S]*?quisiera consultar si habrá reposición de este producto/);
  assert.match(app, /id="dialog-buy-label"/);
  assert.match(app, /buyLabel\.textContent = availability === "order"[\s\S]*?Consultar por pedido[\s\S]*?Consultar disponibilidad[\s\S]*?Quiero comprar este producto/);
  assert.match(app, /updateProductContactLinks\(product, null, requestedColor\)/);
});

test("AI recommendation cards disclose stock and format numeric-string prices", () => {
  assert.match(assistant, /function availabilityPresentation\(value\)/);
  assert.match(assistant, /jb-ai-product-availability/);
  assert.match(assistant, /Por pedido/);
  assert.match(assistant, /Agotado/);
  assert.match(assistant, /const priceUsd = product\.price_usd === null[\s\S]*?Number\(product\.price_usd\)/);
  assert.match(assistant, /const priceNio = product\.price_nio === null[\s\S]*?Number\(product\.price_nio\)/);
  assert.match(assistantCss, /\.jb-ai-product-availability--order/);
  assert.match(assistantCss, /\.jb-ai-product-availability--unavailable/);
  assert.match(assistantCss, /\.jb-ai-product-availability--available/);
  assert.match(techHtml, /ai-assistant\.js\?v=20261028-public-customer-flows2/);
  assert.match(perfumeHtml, /ai-assistant\.js\?v=20261028-public-customer-flows2/);
  assert.match(homeHtml, /ai-assistant\.js\?v=20261028-public-customer-flows2/);
});
