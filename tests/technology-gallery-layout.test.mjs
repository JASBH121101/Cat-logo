import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";

const html = readFileSync("tecnologia/index.html", "utf8");
const css = readFileSync("technology-visual-refresh.css", "utf8");
const app = readFileSync("app.js", "utf8");

test("technology page loads the gallery fix after legacy style sheets", () => {
  const styles = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+>/g)].map(match => match[0]);
  assert.ok(styles.length > 0, "page should declare stylesheets");
  assert.match(styles.at(-2), /technology-visual-refresh\.css\?v=20261029-conversion-trust1/);
  assert.match(styles.at(-1), /contact-channels\.css\?v=20261028-dual-contact1/);
  assert.match(html, /app\.js\?v=20261029-ai-compact-launcher1/);
  assert.match(html, /id="quality-price-section"/);
  assert.match(app, /quality_price: "💎 CALIDAD-PRECIO"/);
  assert.doesNotMatch(app, /const PRODUCT_TAG_ICONS/);
  assert.doesNotMatch(css, /Center the four curated product labels/);
  assert.match(html, /section-tag-badge--exclusive/);
  assert.match(html, /section-tag-badge--performance/);
  assert.match(html, /section-tag-badge--quality-price/);
  assert.match(html, /section-tag-badge--gaming/);
  assert.match(html, /Se consideran exclusivos por su marca, precio, materiales de construcción y componentes, como el procesador, la RAM, el almacenamiento y las cámaras/);
  assert.match(html, /Modelos capaces de competir con la gama alta/);
  assert.match(html, /Modelos que destacan por el equilibrio entre su precio/);
  assert.match(html, /Los monstruos del gaming: equipos con procesadores potentes/);
  assert.match(css, /section-accessible-title/);
  assert.match(css, /top-gaming-heading \.section-subtitle\s*\{[^}]*font-family:\s*"Space Grotesk"/s);
  assert.match(css, /quality-price-heading \.section-subtitle\s*\{[^}]*font-family:\s*"DM Sans"/s);
  assert.match(css, /high-performance-heading \.section-subtitle\s*\{[^}]*font-family:\s*Manrope/s);
  assert.match(css, /featured-section-heading \.section-subtitle\s*\{[^}]*font-family:\s*Manrope/s);
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

test("featured descriptions use typography tailored to each section badge", () => {
  assert.match(css, /body\.technology-catalog \.top-gaming-heading \.section-subtitle\s*\{[^}]*font-family:\s*"Space Grotesk"[^}]*font-weight:\s*600/s);
  assert.match(css, /body\.technology-catalog \.quality-price-heading \.section-subtitle\s*\{[^}]*font-family:\s*"DM Sans"/s);
  assert.match(css, /body\.technology-catalog \.high-performance-heading \.section-subtitle\s*\{[^}]*font-family:\s*Manrope[^}]*font-weight:\s*600/s);
  assert.match(css, /body\.technology-catalog \.featured-section-heading \.section-subtitle\s*\{[^}]*font-weight:\s*500[^}]*letter-spacing:\s*\.012em/s);
});

test("compacts mobile product configuration controls without stretching variant buttons", () => {
  assert.ok(css.includes("Mobile compact pass: reduce empty space throughout the technology product detail"));
  assert.ok(css.includes("flex-wrap: wrap !important"));
  assert.ok(css.includes("Final mobile pass: compact configuration chips and unmistakable stock states"));
  assert.match(css, /status-order[\s\S]*?background: #fff0c2 !important/);
  assert.ok(css.includes("width: auto !important"));
  assert.ok(css.includes("height: clamp(230px, 31svh, 285px) !important"));
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
  assert.match(html, /data-trust-item="payment"/);
  assert.match(html, /data-trust-item="shipping"/);
  assert.match(html, /data-trust-item="whatsapp"/);
  assert.match(html, /data-trust-item="warranty"/);
  assert.match(perfume, /AROMAS CON IDENTIDAD/);
  assert.match(perfume, /href="#coleccion"/);
});

test("perfume hero caption gradient stays subtle and title remains readable", () => {
  const perfumeHtml = readFileSync("perfumeria/index.html", "utf8");
  const perfumeCss = readFileSync("perfumeria.css", "utf8");
  assert.match(perfumeHtml, /perfumeria\.css\?v=20261028-compact-detail2/);
  assert.match(perfumeCss, /Softer editorial caption gradient/);
  assert.match(perfumeCss, /rgba\(32,24,14,\.24\)/);
  assert.match(perfumeCss, /\.perfume-carousel-title\s*\{\s*color:#342a1d !important/);
});


test("mobile trust tiles keep the text inside one rectangular card instead of nested oval pills", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true });
    await page.setContent(`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="technology-catalog"><section class="hero"><div class="hero-copy"><div class="hero-trust">
      <div class="hero-trust-item"><svg class="hero-trust-icon" viewBox="0 0 24 24"><path d="M2 2"/></svg><span class="hero-trust-copy"><strong>Pago al recibir</strong><small>Cuando esté disponible para tu pedido</small></span></div>
      <div class="hero-trust-item"><svg class="hero-trust-icon" viewBox="0 0 24 24"><path d="M2 2"/></svg><span class="hero-trust-copy"><strong>Envíos a departamentos</strong><small>Coordinados según tu destino</small></span></div>
      <div class="hero-trust-item"><svg class="hero-trust-icon" viewBox="0 0 24 24"><path d="M2 2"/></svg><span class="hero-trust-copy"><strong>Atención por WhatsApp</strong><small>Consultá antes de comprar</small></span></div>
      <div class="hero-trust-item"><svg class="hero-trust-icon" viewBox="0 0 24 24"><path d="M2 2"/></svg><span class="hero-trust-copy"><strong>Garantía de fábrica</strong><small>Según el producto</small></span></div>
    </div></div></section></body></html>`);
    for (const theme of ["dark", "light"]) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      const result = await page.evaluate(() => {
        const trust = document.querySelector(".hero-trust");
        const cards = [...document.querySelectorAll(".hero-trust-item")];
        const copies = [...document.querySelectorAll(".hero-trust-copy")];
        return {
          viewportWidth: window.innerWidth,
          columns: getComputedStyle(trust).gridTemplateColumns.trim().split(/\s+/).length,
          cards: cards.map((card, index) => {
            const rect = card.getBoundingClientRect();
            const copy = copies[index];
            const copyRect = copy.getBoundingClientRect();
            const style = getComputedStyle(copy);
            return {
              left: rect.left, right: rect.right, width: rect.width, height: rect.height,
              copyRight: copyRect.right, padding: style.padding,
              borderWidth: style.borderTopWidth, radius: style.borderTopLeftRadius,
              background: style.backgroundColor
            };
          })
        };
      });
      assert.equal(result.columns, 2, theme + ": mobile trust cards should form two balanced columns");
      assert.equal(result.cards.length, 4);
      for (const card of result.cards) {
        assert.ok(card.width > 120, theme + ": cards must retain readable width");
        assert.ok(card.height > 55, theme + ": card height must contain title and description");
        assert.ok(card.left >= 0 && card.right <= result.viewportWidth,
          theme + ": card should fit within viewport without horizontal overflow");
        assert.ok(card.copyRight <= card.right - 4,
          theme + ": copy text must remain inside its card");
        assert.equal(card.padding, "0px", theme + ": nested text wrapper must not inherit pill padding");
        assert.equal(card.borderWidth, "0px", theme + ": nested text wrapper must not draw a second border");
        assert.equal(card.radius, "0px", theme + ": nested text wrapper must not become an oval pill");
        assert.equal(card.background, "rgba(0, 0, 0, 0)", theme + ": nested text wrapper must remain transparent");
      }
    }
  } finally {
    await browser.close();
  }
});
