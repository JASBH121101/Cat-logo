import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const css = await readFile(new URL("theme-ui.css", root), "utf8");
const html = await readFile(new URL("admin.html", root), "utf8");

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
  assert.match(html, /theme-ui\.css\?v=20261027-mobile-sidebar-stability2/);
});
