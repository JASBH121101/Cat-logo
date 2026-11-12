import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const html = read("admin.html");
const admin = read("admin.js");
const polish = read("fiverr-demo-ui-polish.css");

test("admin text fields contain no sample placeholders", () => {
  assert.doesNotMatch(html, /\splaceholder\s*=/i);
  assert.doesNotMatch(admin, /\splaceholder\s*=/i);
  assert.doesNotMatch(admin, /\.placeholder\s*=/i);
  assert.doesNotMatch(admin, /placeholder\s*:\s*["']/i);
});

test("required labels receive red asterisks while optional fields remain unmarked", () => {
  assert.match(admin, /input\[required\], select\[required\], textarea\[required\]/);
  assert.match(admin, /if \(!control \|\| label\.querySelector\("\.required-mark"\)\) return/);
  assert.match(admin, /requiredFieldObserver\.observe\(document\.body/);
  assert.match(polish, /\.required-mark[\s\S]*color:\s*#dc2626/i);
  assert.match(polish, /html\[data-theme="dark"\][\s\S]*\.required-mark[\s\S]*color:\s*#ff8293/i);
});

test("permissions layout defines readable spacing, wrapping and a mobile single-column grid", () => {
  assert.match(polish, /\.team-permission-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(polish, /\.team-permission-copy\s*\{[\s\S]*display:\s*grid/);
  assert.match(polish, /overflow-wrap:\s*anywhere/);
  assert.match(polish, /@media\s*\(max-width:\s*760px\)[\s\S]*\.team-permission-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("secondary and destructive buttons have explicit colors in light and dark themes", () => {
  for (const theme of ["light", "dark"]) {
    assert.ok(polish.includes('html[data-theme="' + theme + '"] body.admin-body .button-secondary'));
    assert.ok(polish.includes('html[data-theme="' + theme + '"] body.admin-body .button-outline'));
    assert.ok(polish.includes('html[data-theme="' + theme + '"] body.admin-body .admin-product-buttons .admin-icon-button.danger'));
  }
});

test("the dedicated theme polish stylesheet loads after the existing admin CSS", () => {
  assert.match(html, /admin-gopartners-scanner\.css[\s\S]*fiverr-demo-ui-polish\.css\?v=20261112-demo-dual-theme1/);
  assert.match(html, /admin\.js\?v=20261112-fiverr-demo-ui-polish1/);
});
