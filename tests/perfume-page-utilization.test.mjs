import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const perfCss = readFileSync(new URL("../perfumeria.css", import.meta.url), "utf8");
const techCss = readFileSync(new URL("../technology-visual-refresh.css", import.meta.url), "utf8");
const perfumeHtml = readFileSync(new URL("../perfumeria/index.html", import.meta.url), "utf8");
const techHtml = readFileSync(new URL("../tecnologia/index.html", import.meta.url), "utf8");

test("JB Parfums desktop layout uses more of the available page width", () => {
  assert.match(perfCss, /@media\s*\(min-width:\s*1100px\)[\s\S]*?body\.perfume-page main\s*\{[^}]*max-width:\s*1720px/);
  assert.match(perfCss, /body\.perfume-page \.perfume-cross-promo\s*\{[^}]*width:\s*min\(1540px/);
  assert.match(perfCss, /body\.perfume-page \.product-grid,[\s\S]*?justify-content:\s*center/);
  assert.match(perfCss, /body\.perfume-page \.perfume-category-section\s*\{[^}]*padding-top:\s*clamp\(28px/);
});

test("concierge heading is allowed to grow and wrap without a clipping height", () => {
  assert.match(perfCss, /body\.perfume-page \.perfume-contact h2\s*\{[^}]*max-height:\s*none/);
  assert.match(perfCss, /body\.perfume-page \.perfume-contact h2\s*\{[^}]*overflow:\s*visible/);
  assert.match(perfCss, /body\.perfume-page \.perfume-contact h2\s*\{[^}]*line-height:\s*1\.22/);
  assert.match(perfCss, /@media\s*\(max-width:\s*640px\)[\s\S]*?body\.perfume-page \.perfume-contact h2\s*\{[^}]*line-height:\s*1\.2/);
  assert.ok(perfumeHtml.includes("Encontrá una fragancia que hable por vos."));
});

test("JB TECH cross-catalog banner expands on desktop and remains responsive on mobile", () => {
  assert.match(techCss, /body\.technology-catalog \.technology-promo-banner\s*\{[^}]*width:\s*min\(1600px/);
  assert.match(techCss, /@media\s*\(max-width:\s*700px\)[\s\S]*?body\.technology-catalog \.technology-promo-banner\s*\{[^}]*width:\s*calc\(100%\s*-\s*28px\)/);
  assert.ok(techHtml.includes("technology-visual-refresh.css?v=20261031-limited-edition-vertical-card1"));
  assert.ok(perfumeHtml.includes("perfumeria.css?v=20261030-desktop-type12"));
});

test("both public catalogs expand beyond 1720px on large desktop and ultrawide screens", () => {
  assert.ok(techCss.includes("@media (min-width: 2560px)"));
  assert.ok(techCss.includes("width: min(3360px"));
  assert.ok(perfCss.includes("@media (min-width: 2560px)"));
  assert.ok(perfCss.includes("width: min(2680px"));
  assert.ok(techHtml.includes("technology-visual-refresh.css?v=20261031-limited-edition-vertical-card1"));
  assert.ok(perfumeHtml.includes("perfumeria.css?v=20261030-desktop-type12"));
});
