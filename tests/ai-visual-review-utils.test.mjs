import test from "node:test";
import assert from "node:assert/strict";
import { classifyCloudflareFailure, deduplicateIssues, getModelText, interpretModelResponse, recoverExplicitFindings, validateReview } from "./ai-visual-review-utils.mjs";
const review = { visual_score: 72, overall_assessment: "Ficha entendible, con separación amplia entre galería y texto.", strengths: ["Jerarquía clara"], issues: [{ severity: "medium", region: "espaciado / composición", evidence: "Separación amplia entre imagen e información.", recommendation: "Medir el espacio y reducirlo si no es intencional.", confidence: 0.78 }], manual_review_required: true, limitations: ["Una captura"] };
test("extracts Cloudflare response", () => assert.equal(getModelText({ result: { response: " hola " } }), "hola"));
test("validates structured review and always requires human review", () => { const x = validateReview({ ...review, manual_review_required: false }); assert.equal(x.valid, true); assert.equal(x.review.manual_review_required, true); });
test("accepts an optional narrative score for personal-experience reviews", () => { const x = validateReview({ ...review, narrative_score: 84 }); assert.equal(x.valid, true); assert.equal(x.review.narrative_score, 84); });
test("rejects an out-of-range narrative score", () => assert.equal(validateReview({ ...review, narrative_score: 101 }).valid, false));
test("rejects malformed issues rather than declaring a clean result", () => assert.equal(validateReview({ ...review, issues: [{ severity: "wow" }] }).valid, false));
test("parses fenced and preambled JSON", () => assert.equal(interpretModelResponse("Resultado:\n```json\n" + JSON.stringify(review) + "\n```").status, "structured"));
test("deduplicates repeating prose and recovers explicit defect once", () => { const text = Array(25).fill("El espacio vacío entre la imagen y el texto parece desperdiciado.").join(" "); const x = recoverExplicitFindings(text); assert.equal(x.issues.length, 1); assert.equal(x.duplicateSentenceCount, 24); });
test("does not treat positive claims as defects", () => { const x = interpretModelResponse("No se observan problemas visibles. La jerarquía es clara."); assert.equal(x.status, "invalid"); assert.equal(x.issues.length, 0); });
test("deduplicates structured issues", () => assert.equal(deduplicateIssues([review.issues[0], review.issues[0]]).length, 1));

test("extracts object-shaped structured responses from Cloudflare", () => {
  assert.equal(getModelText({ result: { response: { visual_score: 80, issues: [] } } }), '{"visual_score":80,"issues":[]}');
});
test("allows omitted or null confidence without inventing a confidence value", () => {
  for (const confidence of [undefined, null]) {
    const item = { ...review.issues[0] };
    if (confidence === undefined) delete item.confidence;
    else item.confidence = confidence;
    const result = validateReview({ ...review, issues: [item] });
    assert.equal(result.valid, true);
    assert.equal(result.review.issues[0].confidence, null);
  }
});
test("rejects zero as an unscored placeholder instead of treating it as a real score", () => {
  assert.equal(validateReview({ ...review, visual_score: 0 }).valid, false);
  assert.equal(validateReview({ ...review, narrative_score: 0 }).valid, false);
});
test("accepts null scores when the screenshot does not provide enough evidence", () => {
  const result = validateReview({ ...review, visual_score: null, narrative_score: null });
  assert.equal(result.valid, true);
  assert.equal(result.review.visual_score, null);
  assert.equal(result.review.narrative_score, null);
});
test("rejects non-integer scores instead of silently rounding them", () => {
  assert.equal(validateReview({ ...review, visual_score: 74.5 }).valid, false);
});

test("Cloudflare daily neuron exhaustion is classified as a permanent account-wide stop", () => {
  const result = classifyCloudflareFailure({
    status: 429,
    payload: { errors: [{ code: 3036, message: "You have used up your daily free allocation of 10,000 neurons." }] },
  });
  assert.deepEqual(result, { kind: "daily_quota_exhausted", retryable: false });
});
test("Cloudflare daily quota text is detected even when no internal error code is supplied", () => {
  const result = classifyCloudflareFailure({ status: 429, bodyText: "You have used up your daily free allocation of 10,000 neurons." });
  assert.equal(result.kind, "daily_quota_exhausted");
  assert.equal(result.retryable, false);
});
test("temporary Workers AI capacity errors remain retryable", () => {
  const result = classifyCloudflareFailure({
    status: 429,
    payload: { errors: [{ code: 3040, message: "Capacity temporarily exceeded, please try again." }] },
  });
  assert.deepEqual(result, { kind: "capacity_temporarily_exceeded", retryable: true });
});
test("parser prefers the fenced JSON response after explanatory model prose", () => {
  const text = ["Analysis text.", "JSON Response:", String.fromCharCode(96).repeat(3) + "json", JSON.stringify(review), String.fromCharCode(96).repeat(3)].join(String.fromCharCode(10));
  assert.equal(interpretModelResponse(text).status, "structured");
});

test("recovers concrete findings and their next-sentence recommendations from model prose", () => {
  const prose = [
    "**Issues:**",
    "* **Legibilidad:** Algunas partes del texto son difíciles de leer debido a la falta de contraste entre el texto y el fondo.",
    "Esto puede resolverse aumentando el contraste y utilizando una tipografía más legible.",
    "* **Composición:** La página tiene demasiado espacio vacío en la parte superior.",
    "Se puede mejorar reorganizando el contenido y reduciendo ese espacio.",
  ].join(String.fromCharCode(10));
  const result = recoverExplicitFindings(prose);
  assert.equal(result.issues.length, 2);
  assert.equal(result.issues[0].confidence, null);
  assert.match(result.issues[0].recommendation, /aumentando el contraste/);
  assert.match(result.issues[1].recommendation, /reorganizando el contenido/);
});
