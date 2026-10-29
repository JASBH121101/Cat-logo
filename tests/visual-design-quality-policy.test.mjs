import assert from "node:assert/strict";
import test from "node:test";
import { analyzeVerticalRhythm } from "./visual-design-quality-policy.mjs";

const region = (selector, top, bottom, extra = {}) => ({
  selector, top, bottom, height: bottom - top, textLength: 180, ...extra,
});

test("client-eye audit flags unusually large desktop whitespace with actionable evidence", () => {
  const findings = analyzeVerticalRhythm([
    region("section.hero", 0, 460),
    region("section.featured", 720, 1120),
  ], { viewportWidth: 1365, mobile: false });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "VISUAL_WHITESPACE_RHYTHM");
  assert.equal(findings[0].measuredGap, 260);
  assert.equal(findings[0].blocking, false);
  assert.match(findings[0].recommendation, /margin\/padding/);
  assert.match(findings[0].evidence, /260px/);
});

test("client-eye audit tolerates normal spacing and short pages", () => {
  assert.deepEqual(analyzeVerticalRhythm([
    region("section.hero", 0, 460),
    region("section.featured", 520, 900),
  ], { viewportWidth: 1365, mobile: false }), []);
  assert.deepEqual(analyzeVerticalRhythm([region("section.only", 0, 400)]), []);
});

test("mobile uses a tighter threshold and findings stay advisory", () => {
  const findings = analyzeVerticalRhythm([
    region("section.hero", 0, 300),
    region("section.cards", 500, 800),
  ], { viewportWidth: 390, mobile: true });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].measuredGap, 200);
  assert.equal(findings[0].blocking, false);
  assert.equal(findings[0].severity, "medium");
});

test("invalid and contentless regions do not create whitespace false positives", () => {
  const findings = analyzeVerticalRhythm([
    region("section.hero", 0, 300),
    region("div.empty", 500, 800, { textLength: 0 }),
    region("section.cards", 850, 1100),
  ], { viewportWidth: 1365, mobile: false });
  assert.equal(findings.length, 0);
});
