import assert from "node:assert/strict";
import test from "node:test";
import { analyzeProductComposition } from "./visual-composition-quality-policy.mjs";

const layout = (extra = {}) => ({
  visible: true, selector: "#dialog-image", productName: "Producto de prueba",
  frameWidth: 560, frameHeight: 620, imageWidth: 190, imageHeight: 250,
  imageFrameRatio: 0.30, imageAreaRatio: 0.13,
  leftColumnRatio: 1.7, rightColumnRatio: 1, rightContentDensity: 0.8,
  ...extra,
});

test("client-eye audit flags a product image that underuses its gallery frame", () => {
  const findings = analyzeProductComposition([layout()], { viewportWidth: 1365, mobile: false });
  assert.ok(findings.some(f => f.code === "PRODUCT_IMAGE_UNDERUTILIZED"));
  assert.ok(findings.every(f => f.blocking === false));
  assert.ok(findings.some(f => /190×250px/.test(f.evidence)));
});

test("client-eye audit flags imbalanced detail columns without demanding equal columns", () => {
  const findings = analyzeProductComposition([layout()], { viewportWidth: 1365, mobile: false });
  assert.ok(findings.some(f => f.code === "PRODUCT_DETAIL_COLUMN_IMBALANCE"));
  assert.ok(findings.every(f => /Revisar|Evaluar/.test(f.recommendation)));
});

test("mobile uses a different image threshold and ignores hidden or invalid layouts", () => {
  const findings = analyzeProductComposition([
    layout({ visible: false }),
    layout({ frameWidth: 0 }),
    layout({ imageFrameRatio: 0.35, imageAreaRatio: 0.2, leftColumnRatio: null, rightColumnRatio: null }),
  ], { viewportWidth: 390, mobile: true });
  assert.ok(findings.some(f => f.code === "PRODUCT_IMAGE_UNDERUTILIZED"));
  assert.ok(!findings.some(f => f.code === "PRODUCT_DETAIL_COLUMN_IMBALANCE"));
});

test("well-proportioned product photography does not trigger image-utilization findings", () => {
  const findings = analyzeProductComposition([
    layout({ imageFrameRatio: 0.72, imageAreaRatio: 0.42, leftColumnRatio: 1.4, rightColumnRatio: 1 }),
  ], { viewportWidth: 1365, mobile: false });
  assert.deepEqual(findings, []);
});
