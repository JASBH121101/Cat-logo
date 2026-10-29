import assert from "node:assert/strict";
import test from "node:test";
import { classifyRuntimeError } from "./visual-audit-policy.mjs";

test("known network failures from isolated static runs are reported but do not block", () => {
  for (const message of [
    "TypeError: Failed to fetch",
    "net::ERR_BLOCKED_BY_CLIENT",
    "AbortError: The operation was aborted",
    "net::ERR_NAME_NOT_RESOLVED",
  ]) {
    assert.deepEqual(classifyRuntimeError(message), {
      category: "external_dependency_or_network",
      severity: "medium",
      blocking: false,
      rationale: "La auditoría estática bloquea APIs externas; comprobar por separado si el flujo falla con el servicio conectado.",
    });
  }
});

test("uncaught application exceptions block the quality gate", () => {
  for (const message of [
    "TypeError: Cannot read properties of null",
    "ReferenceError: renderCatalog is not defined",
    "SyntaxError: Unexpected token",
    "Error: Cannot update product state",
  ]) {
    const result = classifyRuntimeError(message);
    assert.equal(result.category, "uncaught_javascript_exception", message);
    assert.equal(result.severity, "critical", message);
    assert.equal(result.blocking, true, message);
  }
});
