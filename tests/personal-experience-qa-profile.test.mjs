import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSONAL_EXPERIENCE_PROFILE,
  buildExperienceAiCases,
  calculateEvidenceScores,
  calculateExperienceScores,
} from "./personal-experience-qa-profile.mjs";

test("personal experience profile is separate from the commerce audit and covers all narrative and response states", () => {
  assert.equal(PERSONAL_EXPERIENCE_PROFILE.id, "personal-experience");
  assert.deepEqual(PERSONAL_EXPERIENCE_PROFILE.states.map(item => item.id), [
    "welcome", "music", "question-1", "question-2", "question-3", "clue", "reveal", "letter", "response-conversation", "response-thanks",
  ]);
  assert.equal(buildExperienceAiCases().length, 20);
  assert.ok(buildExperienceAiCases().every(item => item.file.startsWith("experience--")));
});

test("evidence scores are calculated only from measured journey, viewport and Axe evidence", () => {
  const scores = calculateEvidenceScores({
    summary: {
      journeyChecks: 10, journeyPassed: 9,
      scenarios: 12, overflowScenarios: 2,
      axeScans: 12, axeByImpact: { critical: 0, serious: 1, moderate: 2, minor: 1 },
    },
  });
  assert.deepEqual(scores, { functionality: 90, adaptability: 83, accessibility: 68 });
});

test("unexecuted journey steps count against the functionality score", () => {
  const scores = calculateEvidenceScores({
    summary: {
      journeyChecks: 4, journeyExpectedChecks: 8, journeyPassed: 4,
      scenarios: 4, overflowScenarios: 0, axeScans: 4, axeByImpact: {},
    },
  });
  assert.equal(scores.functionality, 50);
});

test("overall experience score remains unavailable until all five dimensions have evidence", () => {
  const partial = calculateExperienceScores({
    summary: { journeyChecks: 4, journeyExpectedChecks: 4, journeyPassed: 4, scenarios: 4, overflowScenarios: 0, axeScans: 4, axeByImpact: {} },
  }, [{ parseStatus: "structured", review: { visual_score: 88, narrative_score: null } }]);
  assert.equal(partial.overall, null);
  assert.equal(partial.availableDimensions, 4);
  assert.equal(partial.complete, false);
});

test("complete experience score is the documented arithmetic mean", () => {
  const result = calculateExperienceScores({
    summary: { journeyChecks: 10, journeyPassed: 10, scenarios: 10, overflowScenarios: 1, axeScans: 10, axeByImpact: {} },
  }, [
    { parseStatus: "structured", review: { visual_score: 88, narrative_score: 82 } },
    { parseStatus: "structured", review: { visual_score: 92, narrative_score: 86 } },
  ]);
  assert.deepEqual(result.dimensions, { functionality: 100, visual: 90, narrative: 84, adaptability: 90, accessibility: 100 });
  assert.equal(result.overall, 93);
  assert.equal(result.manualReviewRequired, true);
});

test("invalid or recovered model prose cannot contribute to subjective dimensions", () => {
  const result = calculateExperienceScores(
    { summary: { journeyChecks: 1, journeyPassed: 1, scenarios: 1, overflowScenarios: 0, axeScans: 1, axeByImpact: {} } },
    [{ parseStatus: "recovered", review: { visual_score: 99, narrative_score: 99 } }]
  );
  assert.equal(result.dimensions.visual, null);
  assert.equal(result.dimensions.narrative, null);
});
