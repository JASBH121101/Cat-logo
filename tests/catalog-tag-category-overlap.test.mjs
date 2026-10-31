import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("tag highlight sections do not remove products from their general category section", () => {
  const renderStart = app.indexOf("function renderProducts()");
  const renderEnd = app.indexOf("\nfunction uniqueValues(", renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart, "renderProducts must exist");
  const render = app.slice(renderStart, renderEnd);

  assert.ok(render.includes("const regularProducts = list;"));
  assert.ok(render.includes("renderCategorizedProducts(regularProducts)"));
  assert.ok(!render.includes("const regularProducts = hasFilters ? list : list.filter"));
});

test("each product tag creates an independent highlight without excluding other tags", () => {
  const renderStart = app.indexOf("function renderProducts()");
  const renderEnd = app.indexOf("\nfunction uniqueValues(", renderStart);
  const render = app.slice(renderStart, renderEnd);

  assert.ok(render.includes("const featured = hasFilters ? [] : list.filter(isExclusiveProduct);"));
  assert.ok(render.includes('normalizedProductTags(product).includes("limited_edition")'));
  assert.ok(render.includes('normalizedProductTags(product).includes("high_performance")'));
  assert.ok(render.includes('normalizedProductTags(product).includes("quality_price")'));
  assert.ok(render.includes('normalizedProductTags(product).includes("top_gaming")'));
  assert.ok(!render.includes('tags.includes("high_performance") && !isExclusiveProduct(product)'));
});

test("tagged products are grouped by their canonical category in the general catalog", () => {
  assert.ok(app.includes("function renderCategorizedProducts(productList)"));
  assert.ok(app.includes("const category = canonicalCatalogCategory(product)"));
  assert.ok(app.includes("items.map(renderCard).join(\"\")"));
});
