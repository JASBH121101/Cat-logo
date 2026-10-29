import assert from "node:assert/strict";
import test from "node:test";
import { classifyRuntimeError } from "./visual-audit-policy.mjs";

test("isolated requests blocked deliberately by the test policy are diagnostic, not failures", () => {
  for (const message of [
    "net::ERR_BLOCKED_BY_CLIENT",
    "Request was interrupted by the audit route",
  ]) {
    const result = classifyRuntimeError(message, {
      source: "network-request",
      externalDependency: true,
      blockedByPolicy: true,
      resourceType: "image",
    });
    assert.equal(result.category, "external_dependency_blocked_by_audit");
    assert.equal(result.blocking, false);
    assert.equal(result.severity, "info");
  }
});

test("uncaught exceptions block even when their message resembles a network error", () => {
  for (const message of [
    "TypeError: Failed to fetch",
    "TypeError: Network request failed",
    "ReferenceError: renderCatalog is not defined",
    "SyntaxError: Unexpected token",
    "Error: Cannot update product state",
  ]) {
    const result = classifyRuntimeError(message, { source: "pageerror" });
    assert.equal(result.category, "uncaught_javascript_exception", message);
    assert.equal(result.severity, "critical", message);
    assert.equal(result.blocking, true, message);
  }
});

test("first-party resource failures block the audit", () => {
  const result = classifyRuntimeError("net::ERR_CONNECTION_REFUSED", {
    source: "network-request",
    externalDependency: false,
    resourceType: "script",
  });
  assert.equal(result.category, "first_party_resource_failure");
  assert.equal(result.blocking, true);
  assert.equal(result.severity, "critical");
});

test("failed external essential assets block unless the test explicitly blocked them", () => {
  for (const resourceType of ["document", "stylesheet", "script"]) {
    const result = classifyRuntimeError("net::ERR_NAME_NOT_RESOLVED", {
      source: "network-request",
      externalDependency: true,
      blockedByPolicy: false,
      resourceType,
    });
    assert.equal(result.category, "external_essential_resource_failure");
    assert.equal(result.blocking, true, resourceType);
  }
});

test("nonessential external dependency failures are reported separately", () => {
  const result = classifyRuntimeError("TypeError: Failed to fetch", {
    source: "network-request",
    externalDependency: true,
    blockedByPolicy: false,
    resourceType: "fetch",
  });
  assert.equal(result.category, "external_dependency_or_network");
  assert.equal(result.severity, "medium");
  assert.equal(result.blocking, false);
});

test("ordinary console diagnostics do not become uncaught-exception failures", () => {
  const handled = classifyRuntimeError("TypeError: optional feature unavailable", { source: "console" });
  assert.equal(handled.category, "console_diagnostic");
  assert.equal(handled.blocking, false);

  const uncaught = classifyRuntimeError("Uncaught SyntaxError: Unexpected token", { source: "console" });
  assert.equal(uncaught.category, "uncaught_javascript_exception");
  assert.equal(uncaught.blocking, true);
});


test("Axe critical and serious impacts block while moderate and minor stay reviewable", async () => {
  const { classifyAxeImpact } = await import("./visual-audit-policy.mjs");
  assert.deepEqual(classifyAxeImpact("critical"), { severity: "high", blocking: true });
  assert.deepEqual(classifyAxeImpact("serious"), { severity: "high", blocking: true });
  assert.deepEqual(classifyAxeImpact("moderate"), { severity: "medium", blocking: false });
  assert.deepEqual(classifyAxeImpact("minor"), { severity: "low", blocking: false });
  assert.deepEqual(classifyAxeImpact(null), { severity: "medium", blocking: false });
});
