import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const html=readFileSync(new URL("../admin.html",import.meta.url),"utf8");
const css=readFileSync(new URL("../admin-button-audit.css",import.meta.url),"utf8");
const admin=readFileSync(new URL("../admin.js",import.meta.url),"utf8");

test("admin button audit stylesheet is loaded last",()=>{
 assert.match(html,/admin-button-audit\.css\?v=20261112-button-system3/);
 assert.ok(html.indexOf("admin-button-audit.css")>html.indexOf("fiverr-demo-ui-polish.css"));
});
test("primary, secondary and outline controls share one geometry and accessible states",()=>{
 assert.match(css,/body\.admin-body \.button,[\s\S]*?min-height:42px!important/);
 assert.match(css,/border-radius:11px!important/);
 assert.match(css,/font-family:"DM Sans",sans-serif!important/);
 assert.match(css,/\.button:hover/);
 assert.match(css,/button:focus-visible/);
 assert.match(css,/button:disabled/);
});
test("product step navigation sits below sticky header and has three equal tabs",()=>{
 assert.match(css,/\.product-form-section-nav\{[\s\S]*?top:calc\(76px \+ env\(safe-area-inset-top,0px\) \+ 10px\)!important/);
 assert.match(css,/z-index:15!important/);
 assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/);
 assert.match(css,/scroll-margin-top:calc\(76px \+ env\(safe-area-inset-top,0px\) \+ 18px\)!important/);
});
test("tabs, variants and workflow actions retain responsive tap targets",()=>{
 assert.match(css,/\.product-form-section-tab\{[\s\S]*?min-height:46px!important/);
 assert.match(css,/\.variants-editor-actions>\.button\{min-height:42px!important/);
 assert.match(css,/workflow-action\{[\s\S]*?min-height:44px!important/);
 assert.match(css,/@media\(max-width:760px\)/);
 assert.match(css,/@media\(max-width:390px\)/);
});
test("both themes keep semantic publish/cancel states and reduced motion support",()=>{
 assert.match(css,/html\[data-theme="light"\] body\.admin-body/);
 assert.match(css,/html\[data-theme="dark"\] body\.admin-body/);
 assert.match(css,/workflow-action-publish/);
 assert.match(css,/workflow-action-cancel/);
 assert.match(css,/prefers-reduced-motion/);
});


test("navigation and filter controls share button geometry and maintain visible active state", () => {
  assert.match(css, /admin-nav-button\.active/);
  assert.match(css, /private-chat-admin-filter/);
  assert.match(css, /dashboard-quick-action:focus-visible/);
  assert.match(css, /dashboard-task-row:focus-visible/);
});

test("paid AI floating launcher is absent from every Fiverr demo session", () => {
  assert.match(admin, /if \(IS_FIVERR_DEMO_HOST\) document\.body\.classList\.add\("fiverr-demo-host"\)/);
  assert.match(css, /body\.fiverr-demo-host #jb-ai-floating-launcher \{ display:none!important; \}/);
});


test("mobile variant add action is compact and destructive configuration action never wraps", () => {
  assert.match(css, /#product-form #add-variant-button\s*\{[^}]*width:\s*auto\s*!important;[^}]*max-width:\s*min\(100%, 260px\)\s*!important;[^}]*white-space:\s*nowrap\s*!important;/s);
  assert.match(css, /\.variant-config-group-heading \[data-remove-group\]\s*\{[^}]*min-height:\s*36px\s*!important;[^}]*white-space:\s*nowrap\s*!important;/s);
});
test("sticky section tabs reserve space for the mobile admin header", () => {
  assert.match(css, /\.product-form-section-nav\s*\{[^}]*top:\s*calc\(var\(--admin-header-height, 92px\) \+ env\(safe-area-inset-top, 0px\) \+ 12px\)\s*!important;/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?top:\s*calc\(var\(--admin-header-height, 92px\) \+ env\(safe-area-inset-top, 0px\) \+ 10px\)\s*!important;/);
});
