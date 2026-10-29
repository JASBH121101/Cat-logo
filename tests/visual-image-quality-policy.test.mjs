import assert from "node:assert/strict";
import test from "node:test";
import { analyzeImageOccupancy } from "./visual-image-quality-policy.mjs";

const layout = (overrides = {}) => ({
  visible: true,
  selector: ".dialog-main-image",
  productName: "Teléfono de prueba",
  imageOccupancy: {
    status: "measured",
    confidence: 0.9,
    imageWidth: 600,
    imageHeight: 900,
    foregroundWidthRatio: 0.37,
    foregroundHeightRatio: 0.77,
    foregroundAreaRatio: 0.285,
    foregroundPixelRatio: 0.19,
  },
  ...overrides,
});

test("flags a product that is tiny inside an otherwise correctly sized image element", () => {
  const finding = analyzeImageOccupancy([
    layout({ imageOccupancy: {
      status: "measured", confidence: 0.9, imageWidth: 600, imageHeight: 900,
      foregroundWidthRatio: 0.09, foregroundHeightRatio: 0.12, foregroundAreaRatio: 0.0108,
    } }),
  ]);
  assert.equal(finding.length, 1);
  assert.equal(finding[0].code, "PRODUCT_SUBJECT_UNDERUTILIZED");
  assert.equal(finding[0].severity, "high");
  assert.equal(finding[0].blocking, false);
  assert.match(finding[0].evidence, /9% × 12%/);
  assert.match(finding[0].recommendation, /fotografía original/);
});

test("does not report a subject that occupies a healthy part of the source image", () => {
  assert.deepEqual(analyzeImageOccupancy([layout()]), []);
});

test("does not mislabel cross-origin, blank, or low-confidence image analysis as a pass", () => {
  assert.deepEqual(analyzeImageOccupancy([
    layout({ imageOccupancy: { status: "unavailable", reason: "canvas-cross-origin" } }),
    layout({ imageOccupancy: { status: "inconclusive", confidence: 0.2 } }),
    layout({ imageOccupancy: {
      status: "measured", confidence: 0.3, foregroundWidthRatio: 0.03,
      foregroundHeightRatio: 0.03, foregroundAreaRatio: 0.0009,
    } }),
  ]), []);
});

test("ignores hidden layouts and invalid ratios without throwing", () => {
  assert.deepEqual(analyzeImageOccupancy([
    layout({ visible: false }),
    layout({ imageOccupancy: { status: "measured", confidence: 0.9, foregroundAreaRatio: NaN } }),
  ]), []);
  assert.deepEqual(analyzeImageOccupancy(null), []);
});
