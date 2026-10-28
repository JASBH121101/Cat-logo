import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync("tecnologia/index.html", "utf8");
const css = readFileSync("technology-visual-refresh.css", "utf8");
const app = readFileSync("app.js", "utf8");

test("technology page loads the gallery fix after legacy style sheets", () => {
  const styles = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+>/g)].map(match => match[0]);
  assert.ok(styles.length > 0, "page should declare stylesheets");
  assert.match(styles.at(-1), /technology-visual-refresh\.css\?v=20261028-section-copy1/);
  assert.match(html, /app\.js\?v=20261028-section-copy1/);
  assert.match(html, /id="quality-price-section"/);
  assert.match(app, /quality_price: "💎 CALIDAD-PRECIO"/);
  assert.doesNotMatch(app, /const PRODUCT_TAG_ICONS/);
  assert.doesNotMatch(css, /Center the four curated product labels/);
  assert.match(html, /section-tag-badge--exclusive/);
  assert.match(html, /section-tag-badge--performance/);
  assert.match(html, /section-tag-badge--quality-price/);
  assert.match(html, /section-tag-badge--gaming/);
  assert.match(html, /Se consideran exclusivos por su marca, materiales de construcción/);
  assert.match(html, /Modelos capaces de competir con la gama alta/);
  assert.match(html, /Modelos que destacan por el equilibrio entre su precio/);
  assert.match(html, /Los monstruos del gaming: equipos con procesadores potentes/);
  assert.match(css, /section-accessible-title/);
  assert.match(css, /section-tag-badge > svg/);
  assert.match(app, /product-card-tag-exclusive/);
  assert.ok(app.includes('"product-card-tag-" + tag'));
  assert.doesNotMatch(app, /product-card-color-slot/);
  assert.doesNotMatch(app, /<div class="product-category">\$\{escapeHtml\(\[product\.category/);
  assert.doesNotMatch(html, /RECIBÍ TU PEDIDO|shipping-section|Entregas y envíos/);
  assert.match(app, /renderLegacyColorOptions\(product, requestedColorName\)/);
  assert.match(css, /JB TECH · section-specific card palettes and compact product information/);
  assert.doesNotMatch(app, /recommended: "RECOMENDADO"/);
  assert.match(html, /data-category="Consolas"[^>]*>Consolas<\/button>/);
  assert.match(app, /"Consolas"/);
  assert.match(app, /\["Consolas", \["consola", "consolas", "console", "consoles"/);
});

test("keeps the product-detail header, back arrow, and theme toggle visible while the body is locked", () => {
  assert.match(css, /body\.technology-catalog\.product-detail-active \.site-header\s*\{[\s\S]*?position:\s*fixed\s*!important/);
  assert.match(css, /product-detail-active \.site-header[\s\S]*?z-index:\s*1200\s*!important/);
});

test("detail gallery styles target the real product-detail-page DOM", () => {
  assert.match(css, /body\.technology-catalog\.product-detail-active #product-detail-page #dialog-image/);
  assert.match(css, /body\.technology-catalog\.product-detail-active #product-detail-page:not\(\.hidden\) \.dialog-layout/);
});

test("single-image products do not reserve a row for absent thumbnails or empty arrow rails", () => {
  assert.match(css, /#dialog-image:not\(:has\(\.dialog-gallery-thumbs\)\)\s*\{\s*grid-template-rows:minmax\(0,1fr\)/);
  assert.match(css, /\.dialog-gallery-main:not\(:has\(\.dialog-gallery-nav\)\)\s*\{\s*grid-template-columns:minmax\(0,1fr\)/);
});

test("gallery images fit within the frame without cropping and respond on mobile", () => {
  assert.match(css, /\.dialog-main-image\s*\{[\s\S]*?object-fit:contain !important/);
  assert.match(css, /@media \(max-width:760px\)\s*\{[\s\S]*?product-detail-active #product-detail-page #dialog-image/);
  assert.match(css, /html\[data-theme="dark"\][\s\S]*?dialog-main-image\s*\{\s*mix-blend-mode:normal !important/);
});

test("failed images get a fallback and thumbnail selection keeps accessible alt text current", () => {
  assert.match(app, /Gallery resilience: broken full-size images/);
  assert.match(app, /dialog-image-load-error/);
  assert.match(app, /mainImage\.alt = photoLabel/);
  assert.match(app, /thumbnail\.hidden = true/);
});

test("legacy products and variants share one full image gallery renderer", () => {
  assert.match(app, /function renderProductGallery\(product, images, caption = ""\)/);
  assert.match(app, /dialogImage\.innerHTML = renderProductGallery\(product, chosenImages, configuration\)/);
  assert.match(app, /renderProductGallery\(product, initialImages\)/);
  assert.match(app, /fallbackColorImages/);
});


test("hero CTAs are removed while the useful trust notes and catalog links remain", () => {
  const perfume = readFileSync("perfumeria/index.html", "utf8");
  assert.doesNotMatch(html, /Explorar equipos/);
  assert.doesNotMatch(perfume, /Explorar perfumería/);
  assert.match(html, /Consultas directas por WhatsApp/);
  assert.match(html, /Opciones de pago sujetas a confirmación/);
  assert.match(perfume, /AROMAS CON IDENTIDAD/);
  assert.match(perfume, /href="#coleccion"/);
});

test("perfume hero caption gradient stays subtle and title remains readable", () => {
  const perfumeHtml = readFileSync("perfumeria/index.html", "utf8");
  const perfumeCss = readFileSync("perfumeria.css", "utf8");
  assert.match(perfumeHtml, /perfumeria\.css\?v=20261027-audit-cascade1/);
  assert.match(perfumeCss, /Softer editorial caption gradient/);
  assert.match(perfumeCss, /rgba\(32,24,14,\.24\)/);
  assert.match(perfumeCss, /\.perfume-carousel-title\s*\{\s*color:#342a1d !important/);
});
