import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const provider = readFileSync(new URL("../admin-provider.js", import.meta.url), "utf8");
const admin = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const providerCss = readFileSync(new URL("../admin-provider.css", import.meta.url), "utf8");
const workflowCss = readFileSync(new URL("../admin-workflow.css", import.meta.url), "utf8");
const snapshotMigration = readFileSync(new URL("../supabase/migrations/20261028221500_provider_variant_review_snapshot.sql", import.meta.url), "utf8");

test("supplier review collects provider availability for every configuration and color", () => {
  assert.match(html, /id="provider-review-variants-section"/);
  assert.match(html, /id="provider-review-variants"/);
  assert.match(provider, /function providerVariantReviewGroups\(product, savedSnapshot\)/);
  assert.match(provider, /data-provider-config-availability/);
  assert.match(provider, /data-provider-color-availability/);
  assert.match(provider, /provider_variant_snapshot: variantSnapshot/);
  assert.match(provider, /const unconfirmedVariantStatus = variantSnapshot\.some/);
  assert.match(provider, /if \(overallAvailability === "unknown" \|\| unconfirmedVariantStatus\)/);
  assert.match(html, /Confirmar revisión/);
});

test("supplier review history persists each snapshot without automatically changing public products", () => {
  assert.match(snapshotMigration, /provider_variant_snapshot jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(snapshotMigration, /NEW\.provider_variant_snapshot/);
  assert.match(provider, /select\("provider_name,provider_product_id,provider_url,provider_price_usd,provider_price_nio,provider_availability,review_notes,provider_variant_snapshot,reviewed_at"\)/);
  assert.match(provider, /providerVariantSnapshotHistoryHTML\(row\.provider_variant_snapshot\)/);
  assert.match(provider, /Los precios públicos se conservaron sin cambios/);
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
