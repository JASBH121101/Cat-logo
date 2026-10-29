import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const adminHtml = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const adminJs = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
const themeCss = readFileSync(new URL("../theme-ui.css", import.meta.url), "utf8");
const technologyHtml = readFileSync(new URL("../tecnologia/index.html", import.meta.url), "utf8");
const technologyJs = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const technologyCss = readFileSync(new URL("../technology-visual-refresh.css", import.meta.url), "utf8");
const perfumeHtml = readFileSync(new URL("../perfumeria/index.html", import.meta.url), "utf8");
const perfumeJs = readFileSync(new URL("../perfumeria.js", import.meta.url), "utf8");
const perfumeCss = readFileSync(new URL("../perfumeria.css", import.meta.url), "utf8");

test("limited edition is a shared manual label in technology and perfume forms", () => {
  assert.match(adminHtml, /id="product-tag-limited-edition"/);
  assert.match(adminHtml, /data-product-tag value="limited_edition"/);
  assert.match(adminHtml, /product-tag-option-icon--tech/);
  assert.match(adminHtml, /product-tag-option-icon--perfume/);
  assert.match(themeCss, /admin-catalog-perfumery \.product-tag-option-icon--perfume/);
  assert.match(adminHtml, /product-collection-tag-options/);
  assert.match(adminHtml, /product-tech-tag-options/);
  assert.match(adminJs, /"limited_edition"/);
  assert.match(adminJs, /document\.body\.classList\.toggle\("admin-catalog-perfumery", isPerfume\)/);
  assert.match(adminJs, /product-tech-tag-options[\s\S]*?classList\.toggle\("hidden", isPerfume\)/);
  assert.match(adminJs, /setProductTags\(product\.tags \|\| \[\]\)/);
  assert.match(adminJs, /tags: selectedProductTags\(\)/);
  assert.match(themeCss, /product-tag-option--limited-edition/);
  assert.match(themeCss, /admin-catalog-perfumery[\s\S]*?product-tag-option--limited-edition/);
});

test("technology limited editions have a dedicated section immediately after Exclusives", () => {
  assert.match(technologyHtml, /id="limited-edition-section"/);
  assert.match(technologyHtml, /id="limited-edition-grid"/);
  assert.match(technologyHtml, /id="limited-edition-count"/);
  assert.ok(technologyHtml.indexOf('id="featured-section"') < technologyHtml.indexOf('id="limited-edition-section"'));
  assert.ok(technologyHtml.indexOf('id="limited-edition-section"') < technologyHtml.indexOf('id="high-performance-section"'));
  assert.match(technologyHtml, /app\.js\?v=20261029-ai-compact-launcher1/);
  assert.match(technologyHtml, /technology-visual-refresh\.css\?v=20261029-showcase-readable-type1/);
  assert.match(technologyJs, /limited_edition:\s*"▦ EDICIÓN LIMITADA"/);
  assert.match(technologyHtml, /<rect x="6\.5" y="6\.5" width="11" height="11" rx="2"\/>/);
  assert.match(technologyJs, /normalizedProductTags\(product\)\.includes\("limited_edition"\)/);
  assert.match(technologyJs, /limitedEditionSection\.classList\.toggle\("hidden", limitedEdition\.length === 0\)/);
  assert.match(technologyJs, /!tags\.includes\("limited_edition"\)/);
  assert.match(technologyCss, /limited-edition-section/);
  assert.match(technologyCss, /product-tag-badge\.tag-limited_edition/);
});

test("JB Parfums has independent exclusive and luxury limited-edition showcases", () => {
  assert.match(perfumeHtml, /id="perfume-exclusive-section"/);
  assert.match(perfumeHtml, /id="perfume-limited-edition-section"/);
  assert.match(perfumeHtml, /id="perfume-exclusive-grid"/);
  assert.match(perfumeHtml, /id="perfume-limited-edition-grid"/);
  assert.ok(perfumeHtml.indexOf('id="perfume-exclusive-section"') < perfumeHtml.indexOf('id="perfume-limited-edition-section"'));
  assert.ok(perfumeHtml.indexOf('id="perfume-limited-edition-section"') < perfumeHtml.indexOf('id="category-nicho"'));
  assert.match(perfumeHtml, /perfumeria\.js\?v=20261028-private-chat1/);
  assert.match(perfumeHtml, /perfumeria\.css\?v=20261029-a11y-contrast3/);
  assert.match(perfumeJs, /function normalizedPerfumeProductTags\(product\)/);
  assert.match(perfumeJs, /tags\.includes\("exclusive"\)/);
  assert.match(perfumeJs, /tags\.includes\("limited_edition"\)/);
  assert.match(perfumeJs, /perfumeLimitedEditionSection\.classList\.toggle\("hidden", limitedEditionProducts\.length === 0\)/);
  assert.match(perfumeJs, /matched\.filter\(product => !highlightedIds\.has\(String\(product\.id\)\)\)/);
  assert.match(perfumeJs, /perfume-limited-edition-badge/);
  assert.match(perfumeCss, /perfume-featured-section--limited-edition/);
  assert.match(perfumeCss, /perfume-limited-edition-badge/);
});
