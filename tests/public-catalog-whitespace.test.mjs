import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";

const css = readFileSync(new URL("../technology-visual-refresh.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../tecnologia/index.html", import.meta.url), "utf8");

test("public technology catalog trims excess vertical spacing without affecting behavior", () => {
  assert.match(html, /technology-visual-refresh\.css\?v=20261029-public-whitespace1/);
  assert.match(css, /JB TECH · Auditoría de espacio público/);
  assert.match(css, /\.catalog-section\s*\{[^}]*padding-top:\s*clamp\(38px, 4\.2vw, 58px\)/s);
  assert.match(css, /@media \(min-width: 1200px\)[\s\S]*?padding: clamp\(38px, 3\.6vw, 54px\) clamp\(18px, 1\.8vw, 30px\) 44px !important/);
  assert.match(css, /\.technology-promo-banner\s*\{[^}]*margin-top:\s*24px/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.catalog-section\s*\{[^}]*padding:\s*30px 16px 34px/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.catalog-extra-filters\s*\{[^}]*padding:\s*12px/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.budget-filter-bar\s*\{[^}]*padding:\s*12px/s);
});

test("public technology spacing remains inside the intended container in both themes and mobile/desktop widths", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{width:390,height:844},{width:1365,height:900}]) {
      const page = await browser.newPage({viewport, isMobile: viewport.width < 600});
      await page.setContent(`<!doctype html><html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style></head><body class="technology-catalog">
        <section class="technology-promo-banner"></section>
        <section class="catalog-section"><div class="section-heading"><h2>Catálogo</h2><label class="search-box"><input></label></div>
        <div class="filter-row"><button class="filter-chip">Celulares</button><button class="filter-chip">Accesorios</button></div>
        <div class="catalog-extra-filters"><label class="catalog-control-field"><span>Marca</span><select><option>Todo</option></select></label></div>
        <div class="budget-filter-bar"></div><div class="catalog-results-heading"><h2>Resultados</h2></div></section>
      </body></html>`);
      for (const theme of ["light","dark"]) {
        await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        const measured = await page.evaluate(() => {
          const rect = selector => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return {top:r.top,bottom:r.bottom,height:r.height,left:r.left,right:r.right};
          };
          return {
            viewport: innerWidth,
            catalog: rect(".catalog-section"),
            promo: rect(".technology-promo-banner"),
            filters: rect(".catalog-extra-filters"),
            budget: rect(".budget-filter-bar"),
            theme: document.documentElement.dataset.theme,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            offenders: [...document.querySelectorAll("body *")].map(node => ({selector: node.tagName.toLowerCase() + (node.className && typeof node.className === "string" ? "." + node.className.trim().replace(/\\s+/g, ".") : ""), left: Math.round(node.getBoundingClientRect().left), right: Math.round(node.getBoundingClientRect().right), width: Math.round(node.getBoundingClientRect().width)})).filter(box => box.right > innerWidth + 2 || box.left < -2).slice(0, 10)
          };
        });
        assert.ok(measured.overflow <= 2, `${viewport.width}px ${theme}: no meaningful horizontal overflow (measured ${measured.overflow}px); offenders=${JSON.stringify(measured.offenders)}`);
        assert.ok(measured.catalog.left >= 0 && measured.catalog.right <= measured.viewport, `${viewport.width}px ${theme}: catalog stays within viewport`);
        assert.ok(measured.filters.height > 0 && measured.budget.height > 0, `${viewport.width}px ${theme}: filter surfaces remain rendered`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
