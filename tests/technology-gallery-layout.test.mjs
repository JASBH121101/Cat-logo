import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync("tecnologia/index.html", "utf8");
const css = readFileSync("technology-visual-refresh.css", "utf8");
const app = readFileSync("app.js", "utf8");

test("technology page loads the gallery fix after legacy style sheets", () => {
  const styles = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+>/g)].map(match => match[0]);
  assert.ok(styles.length > 0, "page should declare stylesheets");
  assert.match(styles.at(-1), /technology-visual-refresh\.css\?v=20261026-product-gallery-fix3/);
  assert.match(html, /app\.js\?v=20261026-product-gallery-fix3/);
});

test("detail gallery styles target the real product-detail-page DOM", () => {
  assert.match(css, /body\.technology-catalog\.product-detail-active #product-detail-page #dialog-image/);
  assert.match(css, /body\.technology-catalog\.product-detail-active #product-detail-page:not\(\.hidden\) \.dialog-layout/);
});

test("single-image products do not reserve a row for absent thumbnails or empty arrow rails", () => {
  assert.match(css, /#dialog-image:not\(:has\(\.dialog-gallery-thumbs\)\)\s*\{\s*grid-template-rows:minmax\(0,1fr\)/);
  assert.match(css, /\.dialog-gallery-main:not\(:has\(\.dialog-gallery-nav\)\)\s*\{\s*grid-template-columns:minmax\(0,1fr\)/);
});

test("gallery images fit within the frame without cropping and respond on mobile", () => {
  assert.match(css, /\.dialog-main-image\s*\{[\s\S]*?object-fit:contain !important/);
  assert.match(css, /@media \(max-width:760px\)\s*\{[\s\S]*?product-detail-active #product-detail-page #dialog-image/);
  assert.match(css, /html\[data-theme="dark"\][\s\S]*?dialog-main-image\s*\{\s*mix-blend-mode:normal !important/);
});

test("failed images get a fallback and thumbnail selection keeps accessible alt text current", () => {
  assert.match(app, /Gallery resilience: broken full-size images/);
  assert.match(app, /dialog-image-load-error/);
  assert.match(app, /mainImage\.alt = photoLabel/);
  assert.match(app, /thumbnail\.hidden = true/);
});
