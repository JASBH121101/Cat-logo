import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const css = await readFile(new URL("theme-ui.css", root), "utf8");
const html = await readFile(new URL("admin.html", root), "utf8");
const adminJs = await readFile(new URL("admin.js", root), "utf8");

test("mobile admin sidebar reserves Android safe-area space and remains scrollable", () => {
  assert.match(css, /jb-manager-mobile-sidebar-stability/);
  assert.match(css, /overflow-y:\s*auto\s*!important/);
  assert.match(css, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(css, /padding:\s*14px 13px calc\(18px \+ max\(env\(safe-area-inset-bottom/);
  assert.match(css, /\.admin-sidebar-logout\s*\{[^}]*min-height:\s*42px/s);
});

test("mobile admin sidebar avoids hover motion and backdrop-filter repaints on touch", () => {
  assert.match(css, /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)/);
  assert.match(css, /\.admin-sidebar-catalog-link:hover[\s\S]*?transform:\s*none\s*!important/);
  assert.match(css, /\.admin-sidebar-logout:hover:not\(:disabled\)[\s\S]*?transition:\s*none\s*!important/);
  assert.match(css, /\.admin-sidebar-backdrop:not\(\[hidden\]\)[\s\S]*?-webkit-backdrop-filter:\s*none\s*!important/);
});

test("admin page cache-busts the Android-safe sidebar stylesheet", () => {
  assert.match(html, /theme-ui\.css\?v=20261028-color-ai-cors-button2/);
});


test("admin script uses fresh cache key for the scroll-lock repair", () => {
  assert.ok(html.includes("admin.js?v=20261028-topbar-settings1"));
});

test("opening the drawer locks document scrolling and closing restores the saved position", () => {
  assert.ok(adminJs.includes('root.classList.toggle("admin-sidebar-scroll-locked", shouldOpen)'));
  assert.ok(adminJs.includes('body.classList.toggle("admin-sidebar-scroll-locked", shouldOpen)'));
  assert.ok(adminJs.includes('body.dataset.adminSidebarScrollY = String(currentScrollY)'));
  assert.ok(adminJs.includes('window.scrollTo({ top: savedScrollY, left: 0, behavior: "auto" })'));

  const start = adminJs.indexOf("function setMobileSidebarOpen(open)");
  const end = adminJs.indexOf('\ndocument.getElementById("admin-menu-toggle")?.addEventListener', start);
  assert.ok(start >= 0 && end > start, "drawer handler is present and has a clear boundary");
  const handler = adminJs.slice(start, end);
  const classList = () => {
    const values = new Set();
    return {
      contains: value => values.has(value),
      toggle(value, force) {
        const shouldAdd = force === undefined ? !values.has(value) : Boolean(force);
        if (shouldAdd) values.add(value);
        else values.delete(value);
        return shouldAdd;
      }
    };
  };
  const body = { classList: classList(), dataset: {}, scrollTop: 0 };
  const rootElement = { classList: classList(), scrollTop: 0 };
  const toggleElement = {
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector() { return { textContent: "" }; }
  };
  const backdrop = { hidden: true };
  const document = {
    body,
    documentElement: rootElement,
    getElementById(id) {
      if (id === "admin-menu-toggle") return toggleElement;
      if (id === "admin-sidebar-backdrop") return backdrop;
      return null;
    }
  };
  const scrollCalls = [];
  const window = {
    scrollY: 428,
    matchMedia: () => ({ matches: true }),
    requestAnimationFrame(callback) { callback(); },
    scrollTo(options) { scrollCalls.push(options); }
  };
  const result = vm.runInNewContext(
    handler + "\nsetMobileSidebarOpen(true);" +
    "\nconst opened = {bodyLocked:document.body.classList.contains('admin-sidebar-scroll-locked'),rootLocked:document.documentElement.classList.contains('admin-sidebar-scroll-locked'),drawerOpen:document.body.classList.contains('admin-sidebar-open'),backdropHidden:document.getElementById('admin-sidebar-backdrop').hidden,storedScroll:document.body.dataset.adminSidebarScrollY};" +
    "\nsetMobileSidebarOpen(false);" +
    "\n({opened,bodyUnlocked:!document.body.classList.contains('admin-sidebar-scroll-locked'),rootUnlocked:!document.documentElement.classList.contains('admin-sidebar-scroll-locked'),drawerClosed:!document.body.classList.contains('admin-sidebar-open'),backdropHidden:document.getElementById('admin-sidebar-backdrop').hidden,storedScroll:document.body.dataset.adminSidebarScrollY,scrollCalls});",
    { document, window, scrollCalls, Math, Number, String, Boolean }
  );
  assert.deepEqual({ ...result.opened }, {
    bodyLocked: true,
    rootLocked: true,
    drawerOpen: true,
    backdropHidden: false,
    storedScroll: "428"
  });
  assert.equal(result.bodyUnlocked, true);
  assert.equal(result.rootUnlocked, true);
  assert.equal(result.drawerClosed, true);
  assert.equal(result.backdropHidden, true);
  assert.equal(result.storedScroll, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.scrollCalls)), [
    { top: 428, left: 0, behavior: "auto" }
  ]);
});

test("CSS prevents scroll chaining behind the drawer while preserving drawer scrolling", () => {
  assert.ok(css.includes("html.admin-sidebar-scroll-locked"));
  assert.ok(css.includes("overflow: hidden !important"));
  assert.ok(css.includes("body.admin-body.admin-sidebar-scroll-locked .admin-main"));
  assert.ok(css.includes("touch-action: none !important"));
  assert.ok(css.includes("body.admin-body.admin-dashboard-active.admin-sidebar-open .admin-sidebar-backdrop:not([hidden])"));
});
