import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const adminJs = readFileSync(new URL("../admin.js", import.meta.url), "utf8");

test("admin save and image-upload handlers use the declared preview guard", () => {
  assert.match(adminJs, /const IS_READ_ONLY_PREVIEW\s*=/);
  assert.doesNotMatch(
    adminJs,
    /\bIS_READ_ONLY_VERCEL_PREVIEW\b/,
    "A stale guard name must not throw a ReferenceError before the save handler reaches Supabase."
  );
  assert.match(adminJs, /form\?\.addEventListener\("submit", async event => \{\s*event\.preventDefault\(\);\s*if \(IS_READ_ONLY_PREVIEW\)/);
  assert.ok((adminJs.match(/IS_READ_ONLY_PREVIEW/g) || []).length >= 5);
});


test("provider review form uses JavaScript-controlled submission instead of dialog auto-close", () => {
  const adminHtml = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  const providerJs = readFileSync(new URL("../admin-provider.js", import.meta.url), "utf8");
  assert.match(adminHtml, /<form id="provider-review-form" class="provider-dialog-shell">/);
  assert.doesNotMatch(adminHtml, /<form id="provider-review-form" method="dialog"/);
  assert.match(providerJs, /reviewSaveButton\?\.addEventListener\("click", \(\) => \{ void saveReview\(\); \}\)/);
  assert.match(providerJs, /reviewForm\?\.addEventListener\("submit", event => \{\s*event\.preventDefault\(\);\s*void saveReview\(event\);\s*\}\)/);
  assert.match(adminHtml, /type="button" id="provider-review-save"/);
  assert.match(providerJs, /async function saveReview\(event\)[\s\S]*?event\?\.preventDefault\?\.\(\)/);
  assert.match(providerJs, /supabase\.from\("product_provider_status"\)\.upsert/);
});


test("provider review form omits unused supplier SKU and URL fields", () => {
  const adminHtml = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  const providerJs = readFileSync(new URL("../admin-provider.js", import.meta.url), "utf8");
  assert.doesNotMatch(adminHtml, /id="provider-review-(?:id|url)"/);
  assert.doesNotMatch(adminHtml, /ID o SKU del proveedor|Enlace del producto en el proveedor/);
  assert.doesNotMatch(providerJs, /\$\("#provider-review-(?:id|url)"\)/);
  assert.match(providerJs, /provider_product_id: previous\.provider_product_id \?\? null/);
  assert.match(providerJs, /provider_url: previous\.provider_url \?\? null/);
});


test("provider review dialog follows light and dark theme colors on web and APK", () => {
  const css = readFileSync(new URL("../admin-provider.css", import.meta.url), "utf8");
  assert.match(css, /html\[data-theme="dark"\] \.provider-dialog\s*\{[\s\S]*?background:\s*#0e1930\s*!important/);
  assert.match(css, /html\[data-theme="dark"\] \.provider-dialog \.provider-dialog-fields label > span\s*\{[\s\S]*?color:\s*#e8efff\s*!important/);
  assert.match(css, /html\[data-theme="light"\] \.provider-dialog\s*\{[\s\S]*?background:\s*#ffffff\s*!important/);
});
