import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const html = read("admin.html");
const admin = read("admin.js");
const polish = read("fiverr-demo-ui-polish.css");
const demoViewer = read("demo-viewer.css");
const ai = read("admin-ai.js");
const ui = read("ui.js");

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
  assert.ok(html.includes("admin.js?v=20261112-button-audit2"));
  assert.ok(html.includes("demo-viewer.css?v=20261112-guest-explore-readonly1"));
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

test("paid AI entry points are hidden from Fiverr guests while Android voice source remains available", () => {
  assert.match(demoViewer, /body\.demo-viewer-mode \.admin-nav-button\[data-admin-section="ai"\]/);
  assert.match(demoViewer, /body\.demo-viewer-mode #admin-section-ai/);
  assert.match(demoViewer, /body\.demo-viewer-mode #jb-ai-floating-launcher/);
  assert.match(admin, /initJbManagerAI/);
  assert.match(admin, /if \(isDemoViewer\) \{[\s\S]*jbManagerAI\?\.clearSession\(\);[\s\S]*\} else \{[\s\S]*jbManagerAI\?\.setAuthenticatedUser\(currentUser\)/);
  assert.match(ai, /nativeVoicePlugin\(\)/);
});

test("guest mode explicitly permits the user-facing light/dark theme toggle", () => {
  assert.match(ui, /data-theme-toggle/);
  assert.match(admin, /Vista de invitado: podés explorar módulos, variantes y fotografías/);
  assert.match(demoViewer, /body\.demo-viewer-mode \.site-header \.theme-toggle/);
  assert.match(demoViewer, /pointer-events: auto !important/);
  assert.match(ui, /button\.addEventListener\("click", \(\) => \{/);
  assert.match(ui, /applyTheme\(next\);\s*saveTheme\(next\);/);
});


test("Fiverr guest can open Settings and use logout without exposing other settings actions", () => {
  assert.ok(admin.includes("#admin-settings-toggle"));
  assert.ok(admin.includes("#logout-button"));
  assert.match(admin, /const DEMO_BLOCKED_MUTATION_SELECTOR = \[/);
  assert.doesNotMatch(demoViewer, /body\.demo-viewer-mode \.admin-settings-menu,\s*body\.demo-viewer-mode/);
  assert.match(demoViewer, /body\.demo-viewer-mode \.admin-sidebar-settings \.admin-settings-item:not\(#logout-button\)/);
  assert.match(demoViewer, /body\.demo-viewer-mode \.admin-sidebar-settings #logout-button/);
});

test("guest logout closes the Settings menu and mobile sidebar before returning to login", () => {
  const logoutStart = admin.indexOf('$("#logout-button")?.addEventListener("click"');
  const logoutEnd = admin.indexOf("/* =========================================================", logoutStart);
  const logoutHandler = admin.slice(logoutStart, logoutEnd);
  assert.ok(logoutStart >= 0 && logoutEnd > logoutStart);
  assert.match(logoutHandler, /settingsMenu\.hidden = true/);
  assert.match(logoutHandler, /admin-settings-toggle.*aria-expanded.*false/);
  assert.match(logoutHandler, /setMobileSidebarOpen\(false\)/);
  assert.match(logoutHandler, /await signOutLocalSafely\(\)/);
});


test("Fiverr guest may freely navigate product form tabs, variant accordions and photo galleries", () => {
  assert.match(admin, /\[data-product-form-step\]/);
  assert.match(admin, /\[data-product-form-next\]/);
  assert.match(admin, /\[data-product-form-prev\]/);
  assert.match(admin, /const blockedAction = event\.target\.closest\(DEMO_BLOCKED_MUTATION_SELECTOR\)/);
  assert.doesNotMatch(admin, /const allowed = event\.target\.closest\([\s\S]{0,400}if \(allowed\) return/);
  assert.doesNotMatch(demoViewer, /body\.demo-viewer-mode \.admin-product-editor/);
  assert.match(demoViewer, /body\.demo-viewer-mode \[data-edit\]/);
  assert.doesNotMatch(demoViewer, /\.admin-product-buttons button:not\(\[data-preview-product\]\)/);
  assert.match(demoViewer, /body\.demo-viewer-mode \.variant-image-preview/);
  assert.match(demoViewer, /body\.demo-viewer-mode \[data-preview-product\]/);
  assert.match(demoViewer, /body\.demo-viewer-mode \[data-edit\]/);
});

test("Fiverr demo blocks persisted writes and uploads while keeping database and photo reads available", () => {
  assert.match(admin, /function isReadOnlySession\(\) \{\s*return IS_READ_ONLY_PREVIEW \|\| currentUser\?\.role === "demo_viewer";\s*\}/);
  assert.match(admin, /if \(supabase && IS_READ_ONLY_PREVIEW\)/);
  assert.match(admin, /\["insert", "update", "upsert", "delete"\]/);
  assert.match(admin, /\["upload", "update", "move", "copy", "remove", "createSignedUploadUrl"\]/);
  assert.doesNotMatch(admin, /createSignedUrls"\]/);
  assert.match(admin, /#save-product-button/);
  assert.match(admin, /\[data-trash-product\]/);
  assert.match(admin, /\[data-delete-product\]/);
  assert.match(admin, /\[data-save-color-library\]/);
  assert.match(admin, /input\[type='file'\]/);
});

test("read-only product editor retains view/preview actions and hides only save, delete and file upload", () => {
  for (const selector of ["#save-product-button", "#publish-product-button", "#save-draft-button",
    "[data-trash-product]", "[data-delete-product]", "#product-images", ".variant-image-label input[type=\"file\"]"]) {
    assert.ok(demoViewer.includes("body.demo-viewer-mode " + selector), selector + " must be blocked");
  }
  assert.doesNotMatch(demoViewer, /body\.demo-viewer-mode \.admin-product-editor/);
  assert.match(demoViewer, /body\.demo-viewer-mode \[data-edit\]/);
});


test("the Fiverr demo owner is not blocked by the demo hostname; only demo_viewer sessions are read-only", () => {
  assert.match(admin, /const IS_FIVERR_DEMO_HOST = adminHostname === "fiverr-demo\.jb-collections\.pages\.dev"/);
  assert.match(admin, /const IS_READ_ONLY_PREVIEW =\s*!IS_FIVERR_DEMO_HOST/);
  assert.match(admin, /function isReadOnlySession\(\) \{\s*return IS_READ_ONLY_PREVIEW \|\| currentUser\?\.role === "demo_viewer";\s*\}/);
  assert.doesNotMatch(admin, /IS_FIVERR_DEMO_HOST\s*\|\|\s*IS_READ_ONLY_PREVIEW/);
  assert.match(admin, /if \(supabase && IS_READ_ONLY_PREVIEW\)/);
  assert.match(admin, /if \(isReadOnlySession\(\)\)/);
});
