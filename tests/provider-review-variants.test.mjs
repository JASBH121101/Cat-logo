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
  assert.match(provider, /if \(unconfirmedVariantStatus\)/);
  assert.match(provider, /aggregateProviderAvailability\(variantSnapshot/);
  assert.match(html, /Confirmar revisión/);
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

test("supplier review removes duplicate general price and availability inputs", () => {
  assert.doesNotMatch(html, /id="provider-review-price-usd"/);
  assert.doesNotMatch(html, /id="provider-review-price-nio"/);
  assert.doesNotMatch(html, /id="provider-review-availability"/);
  assert.match(html, /id="provider-review-name"/);
  assert.match(html, /data-provider-config-price-usd/);
  assert.match(html, /data-provider-config-price-nio/);
  assert.match(html, /data-provider-config-availability/);
  assert.match(html, /data-provider-color-availability/);
  assert.match(provider, /provider_price_usd: previous\.provider_price_usd \?\? null/);
  assert.match(provider, /provider_price_nio: previous\.provider_price_nio \?\? null/);
});

test("overall provider availability is derived from configuration and color statuses", () => {
  assert.match(provider, /function aggregateProviderAvailability\(snapshot, fallback = "unknown"\)/);
  assert.match(provider, /if \(statuses\.includes\("available"\)\) return "available"/);
  assert.match(provider, /if \(statuses\.includes\("on_order"\)\) return "on_order"/);
});
