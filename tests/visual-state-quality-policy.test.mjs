import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDialogQuality } from "./visual-state-quality-policy.mjs";

test("flags oversized dialogs with measurements and advisory recommendations", () => {
  const findings = analyzeDialogQuality([
    { selector: "#provider-review-dialog", title: "Revisar proveedor", visible: true, width: 990, height: 820, controlCount: 8, minimumControlHeight: 36 },
  ], { viewportWidth: 1000, viewportHeight: 900 });
  assert.deepEqual(findings.map(item => item.code), ["DIALOG_NEAR_FULL_WIDTH", "DIALOG_NEAR_FULL_HEIGHT"]);
  assert.equal(findings.every(item => item.blocking === false), true);
  assert.match(findings[0].evidence, /99%/);
  assert.match(findings[1].recommendation, /campos redundantes/);
});

test("flags undersized controls but ignores closed or reasonably sized dialogs", () => {
  const findings = analyzeDialogQuality([
    { selector: "#closed", visible: false, width: 1000, height: 900, controlCount: 5, minimumControlHeight: 20 },
    { selector: "#normal", visible: true, width: 640, height: 500, controlCount: 5, minimumControlHeight: 36 },
    { selector: "#compact-controls", visible: true, width: 640, height: 500, controlCount: 3, minimumControlHeight: 28 },
  ], { viewportWidth: 1000, viewportHeight: 900 });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "DIALOG_CONTROL_TOO_SMALL");
});

test("empty and missing dialog collections produce no findings", () => {
  assert.deepEqual(analyzeDialogQuality([]), []);
  assert.deepEqual(analyzeDialogQuality(null), []);
});
