import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync("tecnologia/index.html", "utf8");
const app = readFileSync("app.js", "utf8");
const css = readFileSync("technology-visual-refresh.css", "utf8");

test("public technology catalog exposes an accessible subcategory selector", () => {
  assert.match(html, /id="subcategory-filter"/);
  assert.match(html, /class="subcategory-filter-bar"/);
  assert.match(html, /technology-visual-refresh\.css\?v=20261029-conversion-trust1/);
  assert.match(html, /app\.js\?v=20261029-tech-specs-order1/);
});

test("subcategory options come from the existing product subcategory field", () => {
  assert.match(app, /String\(product\?\.subcategory \|\| ""\)\.trim\(\)/);
  assert.match(app, /function updateSubcategoryFilter\(\)/);
  assert.match(app, /subcategoryFilter\.disabled = options\.length === 0/);
  assert.doesNotMatch(app, /Gama media-alta/);
  assert.doesNotMatch(app, /Monitores/);
});

test("subcategory is combined with the existing catalog filters", () => {
  assert.match(app, /const subcategoryMatches = !selectedSubcategory/);
  assert.match(app, /return categoryMatches && subcategoryMatches && queryMatches && brandMatches && priceMatches/);
  assert.match(app, /selectedCategory !== "all" \|\| selectedSubcategory \|\| readPriceBound/);
  assert.match(app, /subcategoryFilter\?\.addEventListener\("change"/);
  assert.match(app, /selectedSubcategory = ""/);
});

test("Consolas filter includes products kept in Gaming with Consolas as their subcategory", () => {
  assert.match(app, /function matchesSelectedCatalogCategory\(product, category = selectedCategory\)/);
  assert.match(app, /return selected === "consolas" && normalizeCatalogSearch\(product\?\.subcategory\) === selected/);
  assert.match(app, /products\.filter\(product => matchesSelectedCatalogCategory\(product\)\)/);
  assert.match(app, /const categoryMatches = matchesSelectedCatalogCategory\(product\)/);
  assert.match(app, /const CATALOG_CATEGORY_ORDER = \[[\s\S]*?"Gaming",[\s\S]*?"Consolas"/);
});

test("subcategory selector has responsive styles and uses theme variables", () => {
  assert.match(css, /body\.technology-catalog \.subcategory-filter-bar/);
  assert.match(css, /var\(--tech-card-soft\)/);
  assert.match(css, /@media \(max-width:600px\)[\s\S]*?subcategory-filter-bar/);
});
