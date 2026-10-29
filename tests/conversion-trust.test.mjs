import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import test from "node:test";

const technologyHtml = readFileSync(new URL("../tecnologia/index.html", import.meta.url), "utf8");
const technologyCss = readFileSync(new URL("../technology-visual-refresh.css", import.meta.url), "utf8");
const appJs = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const homeHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const perfumeHtml = readFileSync(new URL("../perfumeria/index.html", import.meta.url), "utf8");
const perfumeJs = readFileSync(new URL("../perfumeria.js", import.meta.url), "utf8");

test("technology hero shows truthful purchase trust items and keeps warranty exclusive to technology", () => {
  for (const trustItem of ["payment", "shipping", "whatsapp", "warranty"]) {
    assert.match(technologyHtml, new RegExp('data-trust-item="' + trustItem + '"'));
  }
  assert.match(technologyHtml, /Pago al recibir/);
  assert.match(technologyHtml, /Cuando esté disponible para tu pedido/);
  assert.match(technologyHtml, /Envíos a departamentos/);
  assert.match(technologyHtml, /Atención por WhatsApp/);
  assert.match(technologyHtml, /Garantía de fábrica/);
  assert.match(technologyHtml, /3, 6 o 12 meses, según producto/);
  assert.doesNotMatch(technologyHtml, /1 año de garantía/i);
  assert.doesNotMatch(perfumeHtml, /garantía|garantía de fábrica|meses de garantía/i);
  assert.doesNotMatch(perfumeJs, /warranty_months|Garantía:/i);
  assert.match(appJs, /product\.warranty_months/);
  assert.match(appJs, /meses, según catálogo/);
});

test("homepage catalog CTAs remain distinct and warranty copy belongs only to the technology panel", () => {
  assert.match(homeHtml, /world-cta--parfums[^>]*href="\.\/perfumeria\//);
  assert.match(homeHtml, /world-cta--tech[^>]*href="\.\/tecnologia\//);
  const perfumePanel = homeHtml.slice(
    homeHtml.indexOf('class="world-panel world-panel--parfums"'),
    homeHtml.indexOf('class="world-panel world-panel--tech"')
  );
  const technologyPanel = homeHtml.slice(homeHtml.indexOf('class="world-panel world-panel--tech"'));
  assert.doesNotMatch(perfumePanel, /garantía/i);
  assert.match(technologyPanel, /world-trust-note--tech/);
  assert.match(technologyPanel, /Garantía de fábrica según producto/);
  assert.match(homeHtml, /collections\.css\?v=20261029-trust-microcopy1/);
});

test("trust cards use responsive styling and retain accessible visible text", () => {
  assert.match(technologyCss, /body\.technology-catalog \.hero-trust-item/);
  assert.match(technologyCss, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(technologyCss, /html\[data-theme="dark"\] body\.technology-catalog \.hero-trust-item/);
  assert.match(technologyCss, /@media \(max-width: 360px\)/);
});

test("browser layout keeps all four trust items inside the viewport on phones and desktop", { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(new URL("../tecnologia/index.html", import.meta.url).href, { waitUntil: "domcontentloaded" });
    await page.locator(".hero-trust-item").first().waitFor();
    for (const width of [360, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const measurements = await page.evaluate(() => {
        const trust = document.querySelector(".hero-trust");
        const cards = [...document.querySelectorAll(".hero-trust-item")];
        const image = document.querySelector(".hero-art.hero-visual");
        const rect = trust.getBoundingClientRect();
        const imageRect = image.getBoundingClientRect();
        return {
          itemCount: cards.length,
          allVisible: cards.every(card => {
            const box = card.getBoundingClientRect();
            const style = getComputedStyle(card);
            return box.width > 0 && box.height > 0 && style.display !== "none";
          }),
          trustLeft: rect.left,
          trustRight: rect.right,
          viewportWidth: window.innerWidth,
          imageTop: imageRect.top,
          trustBottom: rect.bottom,
          pageWidth: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
          columns: getComputedStyle(trust).gridTemplateColumns
        };
      });
      assert.equal(measurements.itemCount, 4, "four purchase trust items should be present");
      assert.equal(measurements.allVisible, true, "all trust items should be visible");
      assert.ok(measurements.trustLeft >= -1, "trust strip should not clip off the left edge at " + width + "px");
      assert.ok(measurements.trustRight <= measurements.viewportWidth + 1, "trust strip should fit the viewport at " + width + "px");
      if (width <= 760) {
        assert.ok(measurements.trustBottom <= measurements.imageTop + 1, "trust information should appear before the hero image");
        assert.ok(measurements.pageWidth <= measurements.viewport + 1, "page should not scroll horizontally at " + width + "px");
        assert.equal(measurements.columns.split(" ").length, 2, "phone trust cards should use a two-column grid");
      }
      await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
      const darkThemeVisible = await page.locator(".hero-trust-item").evaluateAll(cards =>
        cards.length === 4 && cards.every(card => getComputedStyle(card).display !== "none")
      );
      assert.equal(darkThemeVisible, true, "trust cards should remain visible in dark theme");
      await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    }
  } finally {
    await browser.close();
  }
});
