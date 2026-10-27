import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const admin = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../ui.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261027141445_allow_incomplete_unpublished_products.sql", import.meta.url), "utf8");
const colorApi = readFileSync(new URL("../functions/api/color-assistant.js", import.meta.url), "utf8");

test("product draft and unpublished saves require a name but defer publish-only fields", () => {
  assert.match(admin, /if \(!name\) throw new Error\("Escribí el nombre del producto\."\);/);
  assert.match(admin, /if \(targetStatus === "published"\) \{[\s\S]*?product-category[\s\S]*?product-availability[\s\S]*?product-perfume-family/);
  assert.match(admin, /allowIncomplete: targetStatus !== "published"/);
  assert.match(admin, /category: isPerfume \? "Perfumería" : \(\$\("#product-category"\)\.value\.trim\(\) \|\| null\)/);
});

test("RAM and storage controls are limited to phones, tablets, and laptops", () => {
  assert.match(admin, /function categoryUsesRamStorage[\s\S]*?\["Celulares", "Tablets", "Laptops"\]/);
  assert.match(admin, /function updateCategoryVariantVisibility[\s\S]*?classList\.toggle\("hidden", !usesRamStorage\)/);
});

test("database constraint allows incomplete draft and unpublished records but validates publication", () => {
  assert.match(migration, /workflow_status in \('draft', 'unpublished'\)/);
  assert.match(migration, /category is not null[\s\S]*?availability is not null/);
  assert.match(migration, /name is not null[\s\S]*?length\(btrim\(name\)\) > 0/);
});

test("admin hides the floating back-to-top control and forces fresh script URLs", () => {
  assert.match(ui, /!document\.body\.classList\.contains\("admin-body"\)/);
  assert.match(ui, /querySelectorAll\("\[data-back-to-top\]"\)\.forEach\(button => button\.remove\(\)\)/);
  assert.match(html, /admin\.js\?v=20261027-android-menu-scroll-lock1/);
  assert.match(html, /ui\.js\?v=20261027-admin-backtop1/);
});

test("photo color analysis forwards the base64 data URL in the format documented by Cloudflare", () => {
  assert.match(colorApi, /image:\s*imageDataUrl/);
  assert.doesNotMatch(colorApi, /image:\s*Array\.from\(atob/);
});
