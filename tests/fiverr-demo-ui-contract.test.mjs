import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const html = read("admin.html");
const admin = read("admin.js");
const polish = read("fiverr-demo-ui-polish.css");
const demoViewer = read("demo-viewer.css");
const ai = read("admin-ai.js");

test("product editor text fields contain no sample placeholders", () => {
  const productForm = html.split('<form id="product-form"')[1]?.split("</form>")[0] || "";
  assert.ok(productForm, "the product editor form must exist");
  assert.doesNotMatch(productForm, /\splaceholder\s*=/i);
  assert.doesNotMatch(admin, /\.placeholder\s*=/i);
  assert.doesNotMatch(admin, /placeholder\s*:\s*["']/i);
});

test("required labels receive red asterisks while optional fields remain unmarked", () => {
  assert.match(admin, /input\[required\], select\[required\], textarea\[required\]/);
  assert.match(admin, /if \(!control \|\| label\.querySelector\("\.required-mark"\)\) return/);
  assert.match(admin, /requiredFieldObserver\.observe\(document\.body/);
  assert.match(polish, /\.required-mark[\s\S]*color:\s*#dc2626/i);
  assert.match(polish, /html\[data-theme="dark"\][\s\S]*\.required-mark[\s\S]*color:\s*#ff8293/i);
});

test("permissions layout defines readable spacing, wrapping and a mobile single-column grid", () => {
  assert.match(polish, /\.team-permission-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(polish, /\.team-permission-copy\s*\{[\s\S]*display:\s*grid/);
  assert.match(polish, /overflow-wrap:\s*anywhere/);
  assert.match(polish, /@media\s*\(max-width:\s*760px\)[\s\S]*\.team-permission-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("secondary and destructive buttons have explicit colors in light and dark themes", () => {
  for (const theme of ["light", "dark"]) {
    assert.ok(polish.includes('html[data-theme="' + theme + '"] body.admin-body .button-secondary'));
    assert.ok(polish.includes('html[data-theme="' + theme + '"] body.admin-body .button-outline'));
    assert.ok(polish.includes('html[data-theme="' + theme + '"] body.admin-body .admin-product-buttons .admin-icon-button.danger'));
  }
});

test("the dedicated theme polish stylesheet loads after the existing admin CSS", () => {
  assert.match(html, /admin-gopartners-scanner\.css[\s\S]*fiverr-demo-ui-polish\.css\?v=20261112-demo-dual-theme1/);
  assert.ok(html.includes("admin.js?v=20261112-demo-chat-cleanup1"));
});


test("the image migration feature is completely removed from the demo UI and bootstrap", () => {
  assert.doesNotMatch(html, /storage-migration|Migración de imágenes/);
  assert.doesNotMatch(admin, /storage-migration|initStorageMigration|admin-storage-migration/);
  assert.doesNotMatch(demoViewer, /storage-migration|cache-rescue|supabase-r2/);
});

test("demo banners and module notices have explicit high-contrast light and dark palettes", () => {
  for (const theme of ["light", "dark"]) {
    assert.ok(demoViewer.includes('html[data-theme="' + theme + '"] body.demo-viewer-mode .demo-viewer-banner'));
    assert.ok(demoViewer.includes('html[data-theme="' + theme + '"] body.demo-viewer-mode .demo-viewer-module-notice'));
  }
  assert.match(demoViewer, /background: #eef4ff/);
  assert.match(demoViewer, /color: #263b5a/);
  assert.match(demoViewer, /background: #17263e/);
  assert.match(demoViewer, /color: #e4edfb/);
});

test("demo viewers may chat with the AI but cannot run scanner or product-prefill actions", () => {
  assert.match(admin, /jbManagerAI\?\.setAuthenticatedUser\(currentUser\)/);
  assert.match(ai, /getCurrentUser\(\)\?\.role === "demo_viewer"/);
  assert.match(ai, /catalogContext\(availableProducts, message\)/);
  assert.match(ai, /new URL\("\/api\/jb-manager-ai", window\.location\.origin\)/);
  assert.match(demoViewer, /\.jb-ai-prefill-action/);
  assert.match(admin, /ChatGPT responde preguntas sobre el catálogo publicado/);
  assert.match(demoViewer, /\.jb-gp-scanner/);
  assert.doesNotMatch(demoViewer, /pointer-events:none !important;[\s\S]{0,80}jb-manager-ai-chat/);
});
