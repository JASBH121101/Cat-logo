import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const admin = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const ui = readFileSync(new URL("../ui.js", import.meta.url), "utf8");
const polish = readFileSync(new URL("../fiverr-demo-ui-polish.css", import.meta.url), "utf8");

test("admin theme control is present in markup and uses direct click binding", () => {
  assert.match(admin, /class="theme-toggle admin-theme-toggle"[^>]*data-theme-toggle/);
  assert.match(admin, /ui\.js\?v=20261112-admin-theme-toggle-direct1/);
  assert.match(ui, /function bindThemeToggle\(button\)/);
  assert.match(ui, /button\.addEventListener\("click", event =>/);
  assert.match(ui, /querySelectorAll\("\[data-theme-toggle\]"\)\.forEach\(bindThemeToggle\)/);
  assert.match(polish, /\.admin-header > \.admin-theme-toggle/);
});

test("admin sidebar catalog link always opens the divided Collections landing page", () => {
  assert.match(admin, /<a href="\/index\.html" class="admin-sidebar-catalog-link">/);
  assert.doesNotMatch(admin, /<a href="\.\/tecnologia\/" class="admin-sidebar-catalog-link">/);
});
