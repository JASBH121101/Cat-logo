import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(new URL("./run-regression-suite.mjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/catalog-static-checks.yml", import.meta.url), "utf8");

const requiredTests = [
  "cache-key-change-guard.test.mjs", "dependency-audit.test.mjs", "migration-history-hygiene.test.mjs",
  "private-chat-mobile-layout.test.mjs", "private-chat-state-behavior.test.mjs", "ai-assistant-layout.test.mjs",
  "catalog-specifications-format.test.mjs", "public-commercial-readiness.test.mjs", "conversion-trust.test.mjs",
  "design-authenticity-audit.test.mjs", "design-quality-audit.test.mjs", "admin-notifications.test.mjs",
  "admin-panel-quality-audit.test.mjs", "admin-save-regression.test.mjs", "admin-product-form-workflow.test.mjs",
  "limited-edition-sections.test.mjs", "cloudflare-share.test.mjs", "cloudflare-download.test.mjs",
  "cloudflare-private-chat-push.test.mjs", "web-push.test.mjs", "cloudflare-assistant.test.mjs",
  "cloudflare-color-assistant.test.mjs", "admin-color-assistant.test.mjs", "admin-mobile-menu-stability.test.mjs",
  "admin-provider-price-sync.test.mjs", "provider-review-variants.test.mjs", "perfume-card-layout.test.mjs",
  "commercial-description-layout.test.mjs", "catalog-contact-channels.test.mjs", "private-chat-workflow.test.mjs",
  "private-chat-resume.test.mjs", "product-tag-formatting.test.mjs", "asset-cache-contract.test.mjs",
  "technology-gallery-layout.test.mjs", "technology-subcategory-filter.test.mjs",
];

test("parallel regression runner includes every existing CI test exactly once", () => {
  const occurrences = new Map();
  for (const match of runner.matchAll(/test\("(tests\/[a-z0-9-]+\.test\.mjs)"/g)) {
    occurrences.set(match[1], (occurrences.get(match[1]) || 0) + 1);
  }
  const expectedPaths = requiredTests.map(name => `tests/${name}`);
  const missing = expectedPaths.filter(path => !occurrences.has(path));
  const duplicated = [...occurrences].filter(([, count]) => count !== 1);
  const unexpected = [...occurrences.keys()].filter(path => !expectedPaths.includes(path));
  assert.deepEqual(missing, [], "no previously configured regression test may be silently dropped");
  assert.deepEqual(duplicated, [], "each test file should run once per full suite");
  assert.deepEqual(unexpected, [], "runner test inventory must be explicit and reviewed");
  assert.equal(occurrences.size, requiredTests.length);
});

test("parallel runner preserves module-mode flags and fails CI when any child test fails", () => {
  assert.match(runner, /--experimental-default-type=module/);
  assert.match(runner, /process\.exitCode = 1/);
  assert.match(runner, /No tests were skipped/);
  assert.match(runner, /Failing test files/);
  assert.match(workflow, /TEST_GROUP_CONCURRENCY: "4"/);
  assert.match(workflow, /node tests\/run-regression-suite\.mjs/);
});

test("CI caches Playwright browser and npm downloads between runs", () => {
  assert.match(workflow, /Cache npm package downloads[\s\S]*?actions\/cache@v4/);
  assert.match(workflow, /Cache Playwright Chromium[\s\S]*?actions\/cache@v4/);
  assert.match(workflow, /playwright-chromium-1\.64\.1/);
});
