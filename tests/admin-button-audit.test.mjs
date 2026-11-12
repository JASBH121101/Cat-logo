import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
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
test("sticky section tabs use the measured desktop and mobile admin-header offsets", () => {
  assert.match(css, /body\.admin-body \{ --jb-admin-header-height: 76px; \}/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?--jb-admin-header-height: 88px/);
  assert.match(css, /top: calc\(var\(--jb-admin-header-height, 76px\) \+ env\(safe-area-inset-top, 0px\) \+ 12px\) !important/);
  assert.match(css, /scroll-margin-top: calc\(var\(--jb-admin-header-height, 76px\) \+ env\(safe-area-inset-top, 0px\) \+ 20px\) !important/);
  assert.match(css, /z-index: 19 !important/);
});


test("JB Expert QA measures real product-editor tabs and buttons across mobile/desktop and both themes", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const viewports = [
    { name: "mobile-360", width: 360, height: 844, expectedColumns: 2 },
    { name: "mobile-390", width: 390, height: 844, expectedColumns: 2 },
    { name: "mobile-430", width: 430, height: 900, expectedColumns: 2 },
    { name: "desktop-1280", width: 1280, height: 900, expectedColumns: 5 }
  ];
  const themes = ["light", "dark"];
  const report = [];
  const outputDir = resolve("artifacts/admin-button-audit");
  await mkdir(outputDir, { recursive: true });

  try {
    for (const viewport of viewports) {
      for (const theme of themes) {
        const page = await browser.newPage({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1
        });
        await page.goto(new URL("../admin.html", import.meta.url).href, { waitUntil: "domcontentloaded" });
        await page.evaluate(({ theme }) => {
          document.documentElement.setAttribute("data-theme", theme);
          document.getElementById("login-panel")?.classList.add("hidden");
          document.getElementById("dashboard")?.classList.remove("hidden");
          document.querySelectorAll("[data-admin-panel]").forEach(panel => {
            panel.classList.toggle("hidden", panel.dataset.adminPanel !== "add");
          });
          const addPanel = document.querySelector('[data-admin-panel="add"]');
          addPanel?.classList.remove("hidden");
          const form = document.getElementById("product-form");
          form?.classList.remove("hidden");
          form?.querySelectorAll("[data-product-form-panel]").forEach(section => {
            section.hidden = false;
            section.classList.remove("hidden");
          });
          const variants = document.querySelector(".variants-editor-actions");
          if (variants && !form.querySelector("[data-jb-qa-variant-group]")) {
            const group = document.createElement("div");
            group.className = "variant-config-body";
            group.dataset.jbQaVariantGroup = "true";
            group.innerHTML = '<div class="variant-config-group-heading"><small>Configuración de prueba</small><button type="button" class="admin-mini-button" data-remove-group>Eliminar configuración</button></div>';
            variants.after(group);
          }
        }, { theme });

        const metrics = await page.evaluate(async () => {
          const header = document.querySelector("header.admin-header");
          const nav = document.querySelector("#product-form .product-form-section-nav");
          const addVariant = document.querySelector("#product-form #add-variant-button");
          const removeGroup = document.querySelector("#product-form [data-jb-qa-variant-group] [data-remove-group]");
          const actionBar = document.querySelector("#product-form .workflow-form-actions");
          const visible = element => {
            if (!element) return false;
            const style = getComputedStyle(element), rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          };
          if (!header || !nav || !addVariant || !removeGroup || !actionBar) return { missing: true };
          nav.scrollIntoView({ block: "start", behavior: "instant" });
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const rect = element => {
            const r = element.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
          };
          const actionButtons = [...actionBar.querySelectorAll("button")].filter(visible).map(button => ({
            text: button.innerText.trim(),
            rect: rect(button),
            minHeight: getComputedStyle(button).minHeight,
            whiteSpace: getComputedStyle(button).whiteSpace
          }));
          const tabs = [...nav.querySelectorAll(".product-form-section-tab")].map(button => ({
            text: button.innerText.trim(),
            rect: rect(button),
            minHeight: getComputedStyle(button).minHeight
          }));
          const docWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
          return {
            viewportWidth: innerWidth,
            documentWidth: docWidth,
            horizontalOverflow: Math.max(0, docWidth - innerWidth),
            header: rect(header),
            nav: rect(nav),
            navPosition: getComputedStyle(nav).position,
            navTop: getComputedStyle(nav).top,
            navZIndex: getComputedStyle(nav).zIndex,
            navGapBelowHeader: rect(nav).top - rect(header).bottom,
            tabs,
            addVariant: {
              rect: rect(addVariant),
              maxWidth: getComputedStyle(addVariant).maxWidth,
              minHeight: getComputedStyle(addVariant).minHeight
            },
            removeGroup: {
              rect: rect(removeGroup),
              whiteSpace: getComputedStyle(removeGroup).whiteSpace,
              minHeight: getComputedStyle(removeGroup).minHeight,
              textOverflow: removeGroup.scrollWidth > removeGroup.clientWidth + 1
            },
            actionColumns: getComputedStyle(actionBar).gridTemplateColumns.split(" ").length,
            actionButtons
          };
        });

        assert.equal(metrics.missing, undefined, "all key form controls must exist in " + viewport.name + "/" + theme);
        assert.equal(metrics.horizontalOverflow, 0, "editor must not overflow horizontally at " + viewport.name + "/" + theme);
        assert.ok(metrics.navGapBelowHeader >= 8, "sticky tabs must remain below the fixed header at " + viewport.name + "/" + theme + ": " + JSON.stringify({ header: metrics.header, nav: metrics.nav, gap: metrics.navGapBelowHeader, top: metrics.navTop }));
        assert.ok(metrics.tabs.every(tab => tab.rect.height >= 42), "all form tabs must remain touch-friendly at " + viewport.name + "/" + theme);
        assert.ok(metrics.tabs.every(tab => tab.rect.left >= metrics.nav.left && tab.rect.right <= metrics.nav.right + 1), "tabs must stay inside their navigation shell");
        assert.ok(metrics.addVariant.rect.width <= Math.min(260, viewport.width - 32) + 1, "Add variant must not become a full-width oversized button at " + viewport.name);
        assert.ok(metrics.addVariant.rect.height >= 42, "Add variant must have a comfortable touch target");
        assert.equal(metrics.removeGroup.whiteSpace, "nowrap", "Delete configuration label must not wrap");
        assert.ok(metrics.removeGroup.rect.height >= 34, "Delete configuration button must keep a compact touch target");
        assert.equal(metrics.removeGroup.textOverflow, false, "Delete configuration label must fit inside its button");
        assert.equal(metrics.actionColumns, viewport.expectedColumns, "workflow actions must use the intended responsive grid at " + viewport.name);
        assert.ok(metrics.actionButtons.every(button => button.rect.height >= 44), "save/publish/draft/cancel buttons must be at least 44px high");
        assert.ok(metrics.actionButtons.every(button => button.rect.left >= 0 && button.rect.right <= viewport.width + 1), "workflow buttons must stay within the viewport");

        report.push({ viewport: viewport.name, theme, ...metrics });
        if ((viewport.width === 390 || viewport.width === 1280)) {
          await page.screenshot({
            path: resolve(outputDir, "product-editor-" + viewport.name + "-" + theme + ".png"),
            fullPage: true
          });
        }
        await page.close();
      }
    }
    await writeFile(resolve(outputDir, "admin-button-audit-report.json"), JSON.stringify({
      generatedAt: new Date().toISOString(),
      scenarioCount: report.length,
      passed: true,
      report
    }, null, 2));
  } finally {
    await browser.close();
  }
});
