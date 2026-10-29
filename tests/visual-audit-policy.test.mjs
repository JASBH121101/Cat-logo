import assert from "node:assert/strict";
import test from "node:test";
import { auditFindingFingerprint, classifyRuntimeError, groupRepeatedFindings } from "./visual-audit-policy.mjs";

test("known isolated network failures remain diagnostic and non-blocking", () => {
  for (const message of ["TypeError: Failed to fetch", "net::ERR_BLOCKED_BY_CLIENT", "AbortError: The operation was aborted", "net::ERR_NAME_NOT_RESOLVED"]) {
    const result = classifyRuntimeError(message);
    assert.equal(result.category, "external_dependency_or_network", message);
    assert.equal(result.blocking, false, message);
    assert.ok(result.confidence >= 0.7 && result.confidence < 1, message);
  }
});
test("uncaught application exceptions block unless they match a known network signature", () => {
  for (const message of ["TypeError: Cannot read properties of null", "ReferenceError: renderCatalog is not defined", "SyntaxError: Unexpected token", "Error: Cannot update product state", "TypeError: Cannot read properties of undefined (reading 'fetch')"]) {
    const result = classifyRuntimeError(message);
    assert.equal(result.category, "uncaught_javascript_exception", message);
    assert.equal(result.severity, "critical", message);
    assert.equal(result.blocking, true, message);
    assert.ok(result.confidence >= 0.9, message);
  }
});
test("finding fingerprints normalize URLs and volatile numbers but preserve page and rule identity", () => {
  const first = auditFindingFingerprint({ page: "technology", rule: "color-contrast", target: [".card-123"], evidence: "Failed at https://example.test/item/123" });
  const second = auditFindingFingerprint({ page: "technology", rule: "color-contrast", target: [".card-456"], evidence: "Failed at https://example.test/item/456" });
  assert.equal(first, second);
  assert.notEqual(first, auditFindingFingerprint({ page: "perfumery", rule: "color-contrast", target: [".card-123"] }));
  assert.notEqual(first, auditFindingFingerprint({ page: "technology", rule: "button-name", target: [".card-123"] }));
});
test("repeated findings group across themes/viewports and preserve highest severity and blocking", () => {
  const grouped = groupRepeatedFindings([
    { page: "technology", rule: "color-contrast", target: [".price"], theme: "light", viewport: "mobile", severity: "medium", blocking: false },
    { page: "technology", rule: "color-contrast", target: [".price"], theme: "dark", viewport: "desktop", severity: "high", blocking: true },
    { page: "perfumery", rule: "color-contrast", target: [".price"], theme: "light", viewport: "mobile", severity: "medium", blocking: false },
  ]);
  assert.equal(grouped.length, 2);
  const tech = grouped.find(item => item.page === "technology");
  assert.equal(tech.occurrences, 2);
  assert.equal(tech.severity, "high");
  assert.equal(tech.blocking, true);
  assert.deepEqual(tech.scenarios, ["dark/desktop", "light/mobile"]);
});
