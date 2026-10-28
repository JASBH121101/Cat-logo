import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const provider = readFileSync("admin-provider.js", "utf8");
const html = readFileSync("admin.html", "utf8");
const css = readFileSync("admin-provider.css", "utf8");
const admin = readFileSync("admin.js", "utf8");

test("provider review displays live price differences and availability validation", () => {
  assert.match(html, /id="provider-review-product-details"/);
  assert.match(html, /id="provider-review-price-comparison"/);
  assert.match(html, /id="provider-review-validation-summary"/);
  assert.match(provider, /function priceDifferenceText(currentValue, providerValue, currency)/);
  assert.match(provider, /function renderReviewAvailabilityComparison(product, providerAvailability)/);
  assert.match(provider, /function updateReviewComparison()/);
  assert.match(provider, /Diferencia:/);
  assert.match(html, /id="provider-review-validation-summary"[^>]*aria-live="polite"/);
  assert.match(css, /provider-price-difference.is-different/);
  assert.match(css, /provider-validation-line.is-match/);
  assert.match(admin, /admin-provider\.js\?v=20261028-provider-validation2/);
});

test("manual provider reviews preserve public prices and existing provider references", () => {
  const start = provider.indexOf("async function saveReview(event)");
  const end = provider.indexOf("async function openHistory(productId)", start);
  assert.ok(start >= 0 && end > start, "provider save handler has a clear boundary");
  const save = provider.slice(start, end);
  assert.match(save, /provider_price_usd: priceUSD \?\? previous\.provider_price_usd \?\? null/);
  assert.match(save, /provider_price_nio: priceNIO \?\? previous\.provider_price_nio \?\? null/);
  assert.match(save, /provider_product_id: previous\.provider_product_id \?\? null/);
  assert.match(save, /Los precios públicos se conservaron sin cambios/);
  assert.doesNotMatch(save, /from\("products"\)[\s\S]*?\.update\(/);
});

test("provider review history retrieves every page instead of only the latest 30 entries", () => {
  const start = provider.indexOf("async function openHistory(productId)");
  const end = provider.indexOf("function parseImportFile(file)", start);
  assert.ok(start >= 0 && end > start, "history handler has a clear boundary");
  const history = provider.slice(start, end);
  assert.match(history, /const pageSize = 500/);
  assert.match(history, /\.range\(offset, offset \+ pageSize - 1\)/);
  assert.doesNotMatch(history, /\.limit\(30\)/);
  assert.match(history, /historyRows\.length\.toLocaleString/);
});

test("import preview shows current-versus-incoming field differences before changes are applied", () => {
  assert.match(provider, /function importDifferenceSummary\(item\)/);
  assert.match(provider, /Proveedor US\$ vs precio público/);
  assert.match(provider, /Nuevo precio público US\$/);
  assert.match(provider, /Disponibilidad importada/);
  assert.match(provider, /Diferencias detectadas/);
  assert.match(provider, /provider-diff-list/);
  assert.match(provider, /vista previa/i);
});

test("admin settings are located in the dashboard sidebar and hidden during login", () => {
  const headerStart = html.indexOf("<header");
  const headerEnd = html.indexOf("</header>", headerStart);
  const sidebarStart = html.indexOf('<aside class="admin-sidebar"');
  const sidebarEnd = html.indexOf("</aside>", sidebarStart);
  assert.ok(headerStart >= 0 && headerEnd > headerStart && sidebarStart >= 0 && sidebarEnd > sidebarStart);
  assert.doesNotMatch(html.slice(headerStart, headerEnd), /admin-settings-toggle/);
  assert.match(html.slice(sidebarStart, sidebarEnd), /admin-settings-toggle/);
  assert.match(html.slice(sidebarStart, sidebarEnd), /data-admin-section="updates"/);
  assert.match(css, /body\.admin-body:not\(\.admin-dashboard-active\) #dashboard\.hidden[\s\S]*?display:none!important/);
  assert.match(css, /body\.admin-body:not\(\.admin-dashboard-active\) \.admin-main\{padding-top:0!important\}/);
  assert.match(css, /\.admin-sidebar \.admin-settings-menu\{position:static/);
  assert.match(html, /admin-provider\.css\?v=20261028-provider-validation4/);
  assert.match(html, /admin\.js\?v=20261028-validation-differences4/);
});
