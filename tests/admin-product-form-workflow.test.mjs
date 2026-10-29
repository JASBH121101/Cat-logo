import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const admin = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
const ui = readFileSync(new URL("../ui.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261027141445_allow_incomplete_unpublished_products.sql", import.meta.url), "utf8");
const colorApi = readFileSync(new URL("../functions/api/color-assistant.js", import.meta.url), "utf8");
const theme = readFileSync(new URL("../theme-ui.css", import.meta.url), "utf8");
const provider = readFileSync(new URL("../admin-provider.js", import.meta.url), "utf8");
const providerCss = readFileSync(new URL("../admin-provider.css", import.meta.url), "utf8");
const publicApp = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const advisorCss = readFileSync(new URL("../ai-assistant.css", import.meta.url), "utf8");

test("product draft and unpublished saves require a name but defer publish-only fields", () => {
  assert.match(admin, /if \(!name\) throw new Error\("Escribí el nombre del producto\."\);/);
  assert.match(admin, /if \(targetStatus === "published"\) \{[\s\S]*?product-category[\s\S]*?product-availability[\s\S]*?product-perfume-family/);
  assert.match(admin, /allowIncomplete: targetStatus !== "published"/);
  assert.match(admin, /category: isPerfume \? "Perfumería" : \(\$\("#product-category"\)\.value\.trim\(\) \|\| null\)/);
});

test("RAM and storage fields stay available but are optional when a product does not use them", () => {
  assert.match(admin, /function categoryUsesRamStorage[\s\S]*?\["Celulares", "Tablets", "Laptops"\]/);
  assert.match(admin, /group\.querySelectorAll\("\.variant-storage-label, \[data-group-ram\]"\)[\s\S]*?wrapper\?\.classList\.remove\("hidden"\)/);
  assert.match(admin, /const ramRaw = read\("\[data-group-ram\]"\);[\s\S]*?const ram = ramRaw \?/);
  assert.doesNotMatch(admin, /requiresConfiguration && !options\.allowIncomplete && !ramRaw/);
});

test("variant add control is available for every technology category and fields adapt immediately", () => {
  assert.match(admin, /addVariantButton\?\.classList\.remove\("hidden"\)/);
  assert.match(admin, /addVariantButton\.title = "Agregar otra variante de capacidad, RAM, precio y color"/);
  assert.match(admin, /wrapper\?\.classList\.remove\("hidden"\)/);
  assert.match(admin, /updateCategoryVariantVisibility\(\);[\s\S]*?const focusSelector = categoryUsesRamStorage\(\) \?[\s\S]*?data-group-price-usd/);
  assert.match(html, /id="base-color-manager" class="base-color-manager primary-config-slot"/);
});

test("variant editor restores the add button and exposes the primary RAM/storage configuration for legacy categories", () => {
  assert.match(admin, /function normalizeTechnologyCategory[\s\S]*?return "Celulares"[\s\S]*?return "Laptops"[\s\S]*?return "Tablets"[\s\S]*?return "Consolas"/);
  assert.match(admin, /value: "Consolas", label: "Consolas"/);
  assert.match(admin, /baseColorManager\?\.classList\.toggle\("is-ram-storage", usesRamStorage\)/);
  assert.match(admin, /renderVariantRows\(activeCatalogType === "perfumery" \? \[\] : legacyVariants\(product\)\);\s*updateCategoryVariantVisibility\(\);/);
  assert.match(html, /id="add-variant-button"[^>]*aria-label="Agregar variante de RAM y almacenamiento"/);
  assert.match(theme, /base-color-manager\.is-ram-storage \.variant-base-group > \.variant-config-fields/);
});

test("published phone/tablet/laptop products require complete configurations and at least one variant", () => {
  assert.match(admin, /requiresConfiguration && !options\.allowIncomplete && !storageRaw/);
  assert.match(admin, /const ramRaw = read\("\[data-group-ram\]"\);[\s\S]*?const ram = ramRaw \?/);
  assert.doesNotMatch(admin, /requiresConfiguration && !options\.allowIncomplete && !ramRaw/);
  assert.match(admin, /categoryUsesRamStorage\(\$\("#product-category"\)\?\.value \|\| ""\) && !options\.allowIncomplete && !configs\.length/);
  assert.match(admin, /Agregá al menos una variante con almacenamiento y color antes de publicar/);
});

test("database constraint allows incomplete draft and unpublished records but validates publication", () => {
  assert.match(migration, /workflow_status in \('draft', 'unpublished'\)/);
  assert.match(migration, /category is not null[\s\S]*?availability is not null/);
  assert.match(migration, /name is not null[\s\S]*?length\(btrim\(name\)\) > 0/);
});

test("admin hides the floating back-to-top control and forces fresh script URLs", () => {
  assert.match(ui, /!document\.body\.classList\.contains\("admin-body"\)/);
  assert.match(ui, /querySelectorAll\("\[data-back-to-top\]"\)\.forEach\(button => button\.remove\(\)\)/);
  assert.match(html, /admin\.js\?v=20261029-admin-webpush3/);
  assert.match(html, /admin-private-chat\.css\?v=20261028-inbox-no-blank-space7/);
  assert.match(html, /ui\.js\?v=20261027-audit-cascade1/);
});

test("smart duplicate suggestions compare only the same brand and catalog, and reuse existing product details", () => {
  const duplicateCss = readFileSync(new URL("../admin-duplicate-detector.css", import.meta.url), "utf8");
  assert.match(admin, /function normalizeDuplicateText\(value\)/);
  assert.match(admin, /function duplicateTextSimilarity\(left, right\)/);
  assert.match(admin, /function scoreProductDuplicate\(candidate, query\)/);
  assert.match(admin, /normalizeDuplicateText\(product\.brand\) !== brandKey/);
  assert.match(admin, /normalizeCatalogType\(product\.catalog_type\) !== query\.catalogType/);
  assert.match(admin, /if \(currentId && String\(product\.id\) === currentId\) return false/);
  assert.match(admin, /\["trash", "deleting"\]\.includes\(getWorkflowStatus\(product\)\)/);
  assert.match(admin, /getDuplicateVariantProfiles\(candidate\)/);
  assert.match(admin, /sameVolume/);
  assert.match(admin, /sameConcentration/);
  assert.match(admin, /\.filter\(match => match\.score >= 0\.39\)/);
  assert.match(admin, /data-duplicate-edit/);
  assert.match(admin, /scheduleProductDuplicateCheck\(\{ immediate: true \}\)/);
  assert.match(html, /id="product-duplicate-panel"/);
  assert.match(html, /id="product-duplicate-results"/);
  assert.match(html, /admin-duplicate-detector\.css\?v=20261028-smart-duplicate-detector1/);
  assert.match(duplicateCss, /@media \(max-width: 560px\)/);
  assert.match(duplicateCss, /\.product-duplicate-result/);
});

test("technology products support editable subcategories and manually selected tags", () => {
  assert.match(html, /<select id="product-subcategory"/);
  assert.match(html, /id="product-subcategory-custom"/);
  assert.doesNotMatch(html, /<input id="product-subcategory" list=/);
  assert.match(html, /id="product-custom-tags"/);
  assert.match(html, /id="product-custom-tags-chips"/);
  assert.match(html, /Presioná Enter para guardar cada etiqueta por separado/);
  assert.match(admin, /function parseCustomProductTagTokens\(value\)/);
  assert.match(admin, /function renderCustomProductTagChips\(\)/);
  assert.match(admin, /function commitCustomProductTags\(\)/);
  assert.match(admin, /event\.key === "Enter"[\s\S]*?commitCustomProductTags\(\)/);
  assert.match(theme, /--admin-taxonomy-panel:\s*linear-gradient/);
  assert.match(theme, /flex-direction:\s*row\s*!important/);
  assert.match(theme, /appearance:\s*none\s*!important/);
  assert.match(admin, /PRODUCT_SUBCATEGORY_SUGGESTIONS/);
  assert.match(admin, /function updateProductSubcategorySuggestions\(preferredValue\)/);
  assert.match(admin, /function getSelectedProductSubcategory\(\)/);
  assert.match(admin, /function selectedProductTags\(\)/);
  assert.match(admin, /PREDEFINED_PRODUCT_TAGS/);
  assert.match(html, /id="product-taxonomy-fields"/);
  assert.match(html, /data-product-tag[^>]*value="top_gaming"/);
  assert.match(html, /data-product-tag[^>]*value="high_performance"/);
  assert.match(admin, /subcategory: isPerfume \? \(existingProduct\?\.subcategory \?\? null\) : \(getSelectedProductSubcategory\(\) \|\| null\)/);
  assert.match(admin, /tags: selectedProductTags\(\)/);
  assert.match(admin, /function setProductTags\(tags\)/);
  assert.match(admin, /function clearEditor\(\)[\s\S]*?customProductTags = \[\];[\s\S]*?renderCustomProductTagChips\(\)/);
  assert.match(admin, /function parseSpecs\(text\)[\s\S]*?return lines\.map\(line =>/);
  assert.match(admin, /function specsText\(specs\)[\s\S]*?isGeneratedSpecificationLabel\(key\)/);
  assert.match(admin, /taxonomyReviewMarkup/);
  assert.match(admin, /reviewTagLabels/);
  const publicApp = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(publicApp, /function specsArray\(specs\)[\s\S]*?isGeneratedSpecificationLabel\(key\)/);
});

test("public technology catalog renders manual badges and dedicated product sections", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const technologyHtml = readFileSync(new URL("../tecnologia/index.html", import.meta.url), "utf8");
  assert.match(app, /PRODUCT_TAG_LABELS/);
  assert.match(app, /high_performance:\s*"⚡ ALTO RENDIMIENTO"/);
  assert.match(app, /tags\.includes\("high_performance"\)/);
  assert.match(app, /normalizedProductTags\(product\)\.includes\("top_gaming"\)/);
  assert.match(technologyHtml, /id="high-performance-section"/);
  assert.match(technologyHtml, /id="high-performance-grid"/);
  assert.match(technologyHtml, /id="top-gaming-section"/);
  assert.match(technologyHtml, /id="top-gaming-grid"/);
});

test("photo color analysis forwards the base64 data URL in the format documented by Cloudflare", () => {
  assert.match(colorApi, /image:\s*imageDataUrl/);
  assert.doesNotMatch(colorApi, /image:\s*Array\.from\(atob/);
});


test("configuration availability is independent from each color's availability", () => {
  assert.match(admin, /data-group-availability/);
  assert.match(admin, /configuration_availability: normalizeVariantAvailability\(read\("\[data-group-availability\]"\)\)/);
  assert.match(admin, /configuration_availability: config\.configuration_availability/);
  assert.match(admin, /availability: color\.availability/);
  assert.match(admin, /availability:g\.querySelector\('\[data-group-availability\]'\)/);
  assert.match(admin, /Disponibilidad de la variante/);
  assert.match(admin, /Bajo pedido/);
  assert.match(admin, /Agotado/);
});


test("configuration color action stays visible and the empty color hint cannot consume phantom grid rows", () => {
  const css = readFileSync("theme-ui.css", "utf8");
  assert.match(css, /body\.admin-body \.variant-config-group \.variant-color-section > \.variant-add-color \{[\s\S]*?display: inline-flex !important/);
  assert.match(css, /body\.admin-body \.variant-config-group \.variant-color-list \{[\s\S]*?grid-auto-rows: auto !important/);
  assert.match(css, /body\.admin-body \.variant-config-group \.variant-color-list > \.variants-empty-hint \{[\s\S]*?grid-row: auto !important/);
  assert.match(html, /theme-ui\.css\?v=20261028-limited-edition-icons1/);
});


test("GitHub Pages admin origin is allowed for the color AI endpoint and add-color controls are forced visible", () => {
  const colorApi = readFileSync("functions/api/color-assistant.js", "utf8");
  const css = readFileSync("theme-ui.css", "utf8");
  assert.match(colorApi, /https:\/\/jasbh121101\.github\.io/);
  assert.match(css, /body\.admin-body #base-color-manager \.variant-base-group \.variant-color-section > button\[data-add-group-color\][\s\S]*?display: inline-flex !important/);
  assert.match(html, /theme-ui\.css\?v=20261028-limited-edition-icons1/);
});


test("provider review identifies perfume details and compares current published prices", () => {
  assert.match(html, /id="provider-review-product-details"/);
  assert.match(html, /id="provider-review-price-comparison"/);
  assert.match(provider, /function renderReviewProductDetails\(product\)/);
  assert.match(provider, /detail\.audience/);
  assert.match(provider, /detail\.concentration/);
  assert.match(provider, /detail\.volume_ml/);
  assert.match(provider, /detail\.family/);
  assert.match(provider, /product\.price_usd/);
  assert.match(provider, /product\.price_nio/);
});

test("provider review compares prices and syncs catalog only through explicit confirmation", () => {
  assert.match(html, /id="provider-review-validation-summary"/);
  assert.match(provider, /function numericPriceDifference\(currentValue, providerValue\)/);
  assert.match(provider, /function renderReviewPriceComparison\(product, review = \{\}\)/);
  assert.match(provider, /diffDisplay/);
  assert.match(provider, /En revisión/);
  assert.match(provider, /function updateReviewComparison\(\)/);
  assert.match(provider, /provider_price_usd: priceUSD \?\? previous\.provider_price_usd \?\? null/);
  assert.match(provider, /provider_price_nio: priceNIO \?\? previous\.provider_price_nio \?\? null/);
  assert.match(html, /id="provider-review-sync-catalog-availability" type="checkbox" checked/);
  assert.match(provider, /p_sync_catalog_availability: syncCatalogAvailability/);
  assert.match(provider, /supabase\.rpc\("confirm_provider_product_review"/);
  const start = provider.indexOf("async function saveReview(event)");
  const end = provider.indexOf("async function openHistory(productId)", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(provider.slice(start, end), /from\("products"\)[\s\S]*?\.update\(/);
  assert.match(providerCss, /provider-review-current-card/);
  assert.match(providerCss, /provider-review-sync-details/);
  assert.match(providerCss, /provider-price-difference\.is-different/);
  assert.match(providerCss, /@media\(max-width:480px\)/);
});

test("customer specification lists hide legacy sequence numbers and preserve their intended order", () => {
  assert.match(publicApp, /line = line\.replace\(\/\^\\s\*\\d\+\\s\*\[\.\):\\-\]\\s\*\//);
  assert.match(publicApp, /const numbered = lines\.filter\(line => \/\^\\s\*\\d\+\\s\*\[\.\):\\-\]\\s\*\//);
  assert.match(publicApp, /\.sort\(\(left, right\) => left\.order - right\.order \|\| left\.index - right\.index\)/);
});

test("JB TECH mobile advisor launcher is compact and its label does not cover specifications", () => {
  assert.match(advisorCss, /body:not\(\.perfume-page\) \.jb-ai-launcher-label/);
  assert.match(advisorCss, /width: 48px;[\s\S]*?height: 48px;[\s\S]*?border-radius: 50%/);
  assert.match(advisorCss, /clip: rect\(0, 0, 0, 0\)/);
});
