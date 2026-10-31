import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("tag highlight sections do not remove products from their general category section", () => {
  const renderStart = app.indexOf("function renderProducts()");
  const renderEnd = app.indexOf("\\nfunction uniqueValues(", renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart, "renderProducts must exist");
  const render = app.slice(renderStart, renderEnd);

  assert.match(render, /const regularProducts = list;/);
  assert.match(render, /renderCategorizedProducts\\(regularProducts\\)/);
  assert.doesNotMatch(render, /const regularProducts = hasFilters \\? list : list\\.filter/);
});

test("each product tag creates an independent highlight without excluding other tags", () => {
  const renderStart = app.indexOf("function renderProducts()");
  const renderEnd = app.indexOf("\\nfunction uniqueValues(", renderStart);
  const render = app.slice(renderStart, renderEnd);

  assert.match(render, /const featured = hasFilters \\? \\[\\] : list\\.filter\\(isExclusiveProduct\\)/);
  assert.match(render, /normalizedProductTags\\(product\\)\\.includes\\("limited_edition"\\)/);
  assert.match(render, /normalizedProductTags\\(product\\)\\.includes\\("high_performance"\\)/);
  assert.match(render, /normalizedProductTags\\(product\\)\\.includes\\("quality_price"\\)/);
  assert.match(render, /normalizedProductTags\\(product\\)\\.includes\\("top_gaming"\\)/);
  assert.doesNotMatch(render, /high_performance[^}]*!isExclusiveProduct/);
});

test("tagged products are grouped by their canonical category in the general catalog", () => {
  assert.match(app, /function renderCategorizedProducts\\(productList\\)/);
  assert.match(app, /const category = canonicalCatalogCategory\\(product\\)/);
  assert.match(app, /items\\.map\\(renderCard\\)/);
});
