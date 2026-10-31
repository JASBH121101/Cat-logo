import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const provider = readFileSync(new URL("../admin-provider.js", import.meta.url), "utf8");
const admin = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const providerCss = readFileSync(new URL("../admin-provider.css", import.meta.url), "utf8");
const workflowCss = readFileSync(new URL("../admin-workflow.css", import.meta.url), "utf8");
const snapshotMigration = readFileSync(new URL("../supabase/migrations/20261028220649_provider_variant_review_snapshot.sql", import.meta.url), "utf8");
const confirmMigration = readFileSync(new URL("../supabase/migrations/20261028221351_confirm_provider_product_review.sql", import.meta.url), "utf8");
const hardenMigration = readFileSync(new URL("../supabase/migrations/20261028221448_harden_provider_review_confirm.sql", import.meta.url), "utf8");
const priceSyncMigration = readFileSync(new URL("../supabase/migrations/20261028221932_sync_provider_variant_prices.sql", import.meta.url), "utf8");

test("supplier review collects provider availability for every configuration and color", () => {
  assert.match(html, /id="provider-review-variants-section"/);
  assert.match(html, /id="provider-review-variants"/);
  assert.match(provider, /function providerVariantReviewGroups\(product, savedSnapshot\)/);
  assert.match(provider, /data-provider-config-availability/);
  assert.match(provider, /data-provider-color-availability/);
  assert.match(provider, /provider_variant_snapshot: variantSnapshot/);
  assert.match(provider, /const unconfirmedVariantStatus = variantSnapshot\.some/);
  assert.match(provider, /if \(\(!hasVariants && overallAvailability === "unknown"\) \|\| \(hasVariants && unconfirmedVariantStatus\)\)/);
  assert.match(provider, /cada configuración y cada color/);
  assert.match(provider, /disponibilidad general comprobada/);
  assert.match(html, /Confirmar revisión/);
});

test("save validation requires general availability only for products without variants", () => {
  assert.match(provider, /if \(\(!hasVariants && overallAvailability === "unknown"\) \|\| \(hasVariants && unconfirmedVariantStatus\)\)/);
  assert.doesNotMatch(provider, /if \(overallAvailability === "unknown" \|\| unconfirmedVariantStatus\)/);
});

test("variant products do not require duplicate general price or availability confirmation", () => {
  assert.match(provider, /function productHasProviderVariants\(product\)/);
  assert.match(provider, /!hasVariants && overall === "unknown"/);
  assert.match(provider, /const overview = deriveProviderVariantOverview\(variantSnapshot\)/);
  assert.match(provider, /overallAvailability = overview\.provider_availability/);
  assert.match(provider, /setProviderReviewFormMode\(product\)/);
  assert.match(html, /el precio general se toma de la configuración con menor RAM y almacenamiento/);
});

test("base price selection is based on lowest RAM and then lowest storage, not JSON array order", () => {
  assert.match(provider, /function compareProviderConfigurations\(left, right\)/);
  assert.match(provider, /configurationRamValue\(left\?\.ram\) - configurationRamValue\(right\?\.ram\)/);
  assert.match(provider, /configurationStorageValue\(left\?\.storage\) - configurationStorageValue\(right\?\.storage\)/);
  assert.match(provider, /groups\.slice\(\)\.sort\(compareProviderConfigurations\)/);
  assert.match(provider, /base_configuration: providerConfigLabel\(lowest\)/);
  assert.match(provider, /catalog_price_usd: lowest\.catalog_price_usd \?\? null/);
  assert.match(provider, /provider_price_usd: hasVariants \? priceUSD :/);
});

test("supplier review history persists each snapshot and makes catalog changes conditional on explicit sync", () => {
  assert.match(snapshotMigration, /provider_variant_snapshot jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(snapshotMigration, /NEW\.provider_variant_snapshot/);
  assert.match(provider, /select\("provider_name,provider_product_id,provider_url,provider_price_usd,provider_price_nio,provider_availability,review_notes,provider_variant_snapshot,reviewed_at"\)/);
  assert.match(provider, /providerVariantSnapshotHistoryHTML\(row\.provider_variant_snapshot\)/);
  assert.match(provider, /Los precios GoPartner ingresados por configuración se aplicaron/);
  assert.match(provider, /Las fotos y el estado de publicación no cambiaron/);
});

test("supplier import uses strict exact identifiers and blocks omitted variants", () => {
  assert.match(provider, /An explicit identifier must never silently fall back to a different product/);
  assert.match(provider, /ID interno exacto/);
  assert.match(provider, /Clave de catálogo exacta/);
  assert.match(provider, /ID de proveedor exacto/);
  assert.match(provider, /No aparece en el archivo:/);
  assert.match(provider, /omittedVariantUpdate/);
  assert.match(provider, /no se aplicó ninguna actualización de variantes/);
});

test("variant editor uses collapsible configuration and color cards", () => {
  assert.match(admin, /<details class="variant-config-group variant-config-collapse"/);
  assert.match(admin, /<details class="variant-admin-row inline-color-card inline-color-card-collapse"/);
  assert.match(admin, /newColorRow\.open = true/);
  assert.match(admin, /gridAutoRows = "auto"/);
  assert.doesNotMatch(admin, /const autoRow = 4/);
  assert.match(workflowCss, /grid-auto-rows:auto!important/);
  assert.match(workflowCss, /details\.inline-color-card-collapse/);
});

test("variant editor summaries show current status and do not lose focus for new colors", () => {
  assert.match(admin, /data-variant-summary-availability/);
  assert.match(admin, /availabilitySummary\.textContent/);
  assert.match(admin, /event\.preventDefault\(\);\s*const group = remove\.closest\("\[data-variant-group\]"\)/);
  assert.match(providerCss, /\.provider-product-variant-summary/);
});


test("confirm review atomically records supplier state and optionally syncs public availability", () => {
  assert.match(html, /id="provider-review-sync-catalog-availability" type="checkbox" checked/);
  assert.match(provider, /supabase\.rpc\("confirm_provider_product_review"/);
  assert.match(provider, /p_sync_catalog_availability: syncCatalogAvailability/);
  assert.match(confirmMigration, /function public\.confirm_provider_product_review/i);
  assert.match(confirmMigration, /IF v_sync THEN/);
  assert.match(confirmMigration, /configuration_availability/);
  assert.match(confirmMigration, /'availability'/);
  assert.match(confirmMigration, /catalog_availability_synced/);
  assert.match(confirmMigration, /admin_only/);
  assert.match(confirmMigration, /GRANT EXECUTE ON FUNCTION public\.confirm_provider_product_review/);
  assert.doesNotMatch(confirmMigration, /SET price_usd\s*=/i);
});


test("provider review RPC uses authenticated admin RLS rather than a security-definer bypass", () => {
  assert.match(confirmMigration, /NOT EXISTS \([\s\S]*?FROM public\.admin_users au WHERE au\.user_id = v_uid/i);
  assert.match(hardenMigration, /SECURITY INVOKER/);
  assert.match(hardenMigration, /REVOKE ALL ON FUNCTION public\.confirm_provider_product_review/);
  assert.match(hardenMigration, /GRANT EXECUTE ON FUNCTION public\.confirm_provider_product_review/);
});


test("provider price sync applies confirmed prices per configuration and recalculates the catalog starting price", () => {
  assert.match(provider, /data-provider-config-price-usd/);
  assert.match(provider, /data-provider-config-price-nio/);
  assert.match(provider, /catalog_price_usd: variant\.price_usd/);
  assert.match(priceSyncMigration, /v_config_price_usd/);
  assert.match(priceSyncMigration, /jsonb_build_object\('price_usd', v_config_price_usd\)/);
  assert.match(priceSyncMigration, /price_usd = CASE/);
  assert.match(priceSyncMigration, /price_nio = CASE/);
  assert.match(priceSyncMigration, /min\(CASE/);
  assert.match(priceSyncMigration, /SECURITY INVOKER/);
  assert.doesNotMatch(priceSyncMigration, /price_usd = v_provider_price_usd/i);
});

test("scanner opens the selected product review before matching rendered configuration rows", () => {
  const start = provider.indexOf("function openReviewFromScan(");
  const end = provider.indexOf("\n  let savingReview", start);
  assert.ok(start >= 0 && end > start, "scanner provider bridge must exist");
  const bridge = provider.slice(start, end);
  assert.ok(bridge.indexOf("openReview(productId)") >= 0);
  assert.ok(bridge.indexOf("openReview(productId)") < bridge.indexOf('document.querySelectorAll("#provider-review-variants'));
  assert.match(bridge, /matches\.length !== 1/);
  assert.match(bridge, /normalizeConfig\(row\.dataset\.colorName\) === colorKey/);
  assert.match(bridge, /is-jb-scanner-match/);
  assert.match(bridge, /El color[\\s\\S]*?no existe exactamente en JB Collections/);
  assert.match(bridge, /return failReview\(/);
  assert.match(bridge, /say\(reviewMessage, message, "error"\)/);
});
