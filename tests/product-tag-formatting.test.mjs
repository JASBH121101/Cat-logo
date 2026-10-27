import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("custom product tags preserve acronym capitalization such as 3D", () => {
  const match = app.match(/function formatCustomProductTag\(value\) \{[\s\S]*?^\}/m);
  assert.ok(match, "custom-tag formatter must exist");
  const formatCustomProductTag = vm.runInNewContext("(" + match[0] + ")");
  assert.equal(formatCustomProductTag("Diseño 3d"), "Diseño 3D");
  assert.equal(formatCustomProductTag("diseño 3D"), "Diseño 3D");
  assert.equal(formatCustomProductTag("Arquitectura"), "Arquitectura");
  assert.match(app, /rawTagLabels\.get\(tag\) \|\| tag/);
});

test("generated specification labels remain suppressible", () => {
  assert.match(app, /function isGeneratedSpecificationLabel\(label\)/);
  assert.match(app, /isGeneratedSpecificationLabel\(key\)/);
});
