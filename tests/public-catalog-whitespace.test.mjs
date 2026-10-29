import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright";

const css = readFileSync(new URL("../technology-visual-refresh.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../tecnologia/index.html", import.meta.url), "utf8");

test("public technology catalog trims excess vertical spacing without affecting behavior", () => {
  assert.match(html, /technology-visual-refresh\.css\?v=20261029-larger-product-gallery1/);
  assert.match(css, /JB TECH · Auditoría de espacio público/);
  assert.match(css, /\.catalog-section\s*\{[^}]*padding-top:\s*clamp\(38px, 4\.2vw, 58px\)/s);
  assert.match(css, /@media \(min-width: 1200px\)[\s\S]*?padding: clamp\(38px, 3\.6vw, 54px\) clamp\(18px, 1\.8vw, 30px\) 44px !important/);
  assert.match(css, /\.technology-promo-banner\s*\{[^}]*margin-top:\s*24px/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.catalog-section\s*\{[^}]*padding:\s*30px 16px 34px/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.catalog-extra-filters\s*\{[^}]*padding:\s*12px/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.budget-filter-bar\s*\{[^}]*padding:\s*12px/s);
});

test("public technology spacing values stay compact across mobile and desktop breakpoints", () => {
  assert.match(css, /@media \(min-width: 761px\)[\s\S]*?\.catalog-section\s*\{[^}]*padding-top:\s*clamp\(38px, 4\.2vw, 58px\)[^}]*padding-bottom:\s*44px/s);
  assert.match(css, /@media \(min-width: 761px\)[\s\S]*?\.technology-promo-banner\s*\{[^}]*margin-top:\s*24px[^}]*margin-bottom:\s*0/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.catalog-section\s*\{[^}]*padding:\s*30px 16px 34px/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.filter-row\s*\{[^}]*margin-top:\s*15px[^}]*margin-bottom:\s*10px/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.catalog-extra-filters\s*\{[^}]*padding:\s*12px/s);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.budget-filter-bar\s*\{[^}]*padding:\s*12px/s);
});
