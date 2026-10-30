import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reviewer = readFileSync(new URL("./ai-visual-review.mjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/catalog-static-checks.yml", import.meta.url), "utf8");

test("AI reviewer optimizes oversized screenshots without modifying original evidence files", () => {
  assert.ok(reviewer.includes('import sharp from "sharp"'));
  assert.ok(reviewer.includes("async function prepareVisionImage"));
  assert.ok(reviewer.includes(".jpeg({ quality: variant.quality"));
  assert.ok(reviewer.includes("imageOptimized"));
  assert.ok(reviewer.includes("original evidence screenshots remain unchanged"));
  assert.ok(workflow.includes("sharp@0.35.5"));
});

test("model requests have bounded transient retries and a targeted validation correction", () => {
  assert.ok(reviewer.includes("requestAttempt <= 3"));
  assert.ok(reviewer.includes("response.status === 429"));
  assert.ok(reviewer.includes("correctionReason"));
  assert.ok(reviewer.includes("Corrige específicamente este problema"));
  assert.ok(reviewer.includes("httpRetryAttempts"));
});

test("AI output contract avoids fabricated example findings and placeholder zero scores", () => {
  assert.ok(reviewer.includes("No uses 0 como marcador de puntuación"));
  assert.ok(reviewer.includes("issues como lista vacía"));
  assert.ok(reviewer.includes("overall_assessment debe tener como máximo 45 palabras"));
  assert.ok(reviewer.includes("confidence es opcional"));
});
