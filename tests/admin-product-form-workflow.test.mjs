import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const admin = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../ui.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261027141445_allow_incomplete_unpublished_products.sql", import.meta.url), "utf8");
const colorApi = readFileSync(new URL("../functions/api/color-assistant.js", import.meta.url), "utf8");
const theme = readFileSync(new URL("../theme-ui.css", import.meta.url), "utf8");

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

test("variant editor restores the add button and exposes the primary RAM/storage configuration for legacy categories", () => {
  assert.match(admin, /function normalizeTechnologyCategory[\s\S]*?return "Celulares"[\s\S]*?return "Laptops"[\s\S]*?return "Tablets"/);
  assert.match(admin, /baseColorManager\?\.classList\.toggle\("is-ram-storage", usesRamStorage\)/);
  assert.match(admin, /renderVariantRows\(activeCatalogType === "perfumery" \? \[\] : legacyVariants\(product\)\);\s*updateCategoryVariantVisibility\(\);/);
  assert.match(html, /id="add-variant-button"[^>]*aria-label="Agregar variante de RAM y almacenamiento"/);
  assert.match(theme, /base-color-manager\.is-ram-storage \.variant-base-group > \.variant-config-fields/);
});

test("published phone/tablet/laptop products require complete configurations and at least one variant", () => {
  assert.match(admin, /requiresConfiguration && !options\.allowIncomplete && \(!storageRaw \|\| !ramRaw\)/);
  assert.match(admin, /categoryUsesRamStorage\(\$\("#product-category"\)\?\.value \|\| ""\) && !options\.allowIncomplete && !configs\.length/);
  assert.match(admin, /Agregá al menos una variante con RAM, almacenamiento y color antes de publicar/);
});

test("database constraint allows incomplete draft and unpublished records but validates publication", () => {
  assert.match(migration, /workflow_status in \('draft', 'unpublished'\)/);
  assert.match(migration, /category is not null[\s\S]*?availability is not null/);
  assert.match(migration, /name is not null[\s\S]*?length\(btrim\(name\)\) > 0/);
});

test("admin hides the floating back-to-top control and forces fresh script URLs", () => {
  assert.match(ui, /!document\.body\.classList\.contains\("admin-body"\)/);
  assert.match(ui, /querySelectorAll\("\[data-back-to-top\]"\)\.forEach\(button => button\.remove\(\)\)/);
  assert.match(html, /admin\.js\?v=20261027-subcategories-tags3/);
  assert.match(html, /ui\.js\?v=20261027-admin-backtop1/);
});

test("technology products support editable subcategories and manually selected tags", () => {
  assert.match(html, /id="product-subcategory"/);
  assert.match(html, /id="product-subcategory-options"/);
  assert.match(html, /id="product-custom-tags"/);
  assert.match(admin, /PRODUCT_SUBCATEGORY_SUGGESTIONS/);
  assert.match(admin, /function updateProductSubcategorySuggestions\(\)/);
  assert.match(admin, /function selectedProductTags\(\)/);
  assert.match(admin, /PREDEFINED_PRODUCT_TAGS/);
  assert.match(html, /id="product-taxonomy-fields"/);
  assert.match(html, /data-product-tag value="top_gaming"/);
  assert.match(admin, /subcategory: isPerfume \? \(existingProduct\?\.subcategory \?\? null\) : \(\$\("#product-subcategory"\)\.value\.trim\(\) \|\| null\)/);
  assert.match(admin, /tags: isPerfume \? \(existingProduct\?\.tags \?\? \[\]\) : selectedProductTags\(\)/);
  assert.match(admin, /function setProductTags\(tags\)/);
});

test("public technology catalog renders manual badges and a dedicated Top Gaming section", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const technologyHtml = readFileSync(new URL("../tecnologia/index.html", import.meta.url), "utf8");
  assert.match(app, /PRODUCT_TAG_LABELS/);
  assert.match(app, /normalizedProductTags\(product\)\.includes\("top_gaming"\)/);
  assert.match(technologyHtml, /id="top-gaming-section"/);
  assert.match(technologyHtml, /id="top-gaming-grid"/);
});

test("photo color analysis forwards the base64 data URL in the format documented by Cloudflare", () => {
  assert.match(colorApi, /image:\s*imageDataUrl/);
  assert.doesNotMatch(colorApi, /image:\s*Array\.from\(atob/);
});
