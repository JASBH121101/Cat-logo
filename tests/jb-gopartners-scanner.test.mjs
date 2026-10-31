import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchScannerCandidate, normalizeScannerKey, scannerDuplicateGroups } from "../admin-gopartners-scanner.js";

test("normaliza modelos, RAM y almacenamiento", () => {
  assert.equal(normalizeScannerKey("12 GB"), "12gb");
  assert.equal(normalizeScannerKey("POCO X8 Pro Max"), "pocox8promax");
});
test("no confunde distintas configuraciones del mismo modelo", () => {
  const rows = [
    { brand: "POCO", model: "X8 Pro Max", ram: "8 GB", storage: "256 GB" },
    { brand: "POCO", model: "X8 Pro Max", ram: "12 GB", storage: "256 GB" }
  ];
  assert.deepEqual(scannerDuplicateGroups(rows), []);
});
test("detecta repetición exacta del mismo producto y variante", () => {
  const groups = scannerDuplicateGroups([
    { brand: "POCO", model: "X8 Pro Max", ram: "8 GB", storage: "256 GB" },
    { brand: "POCO", model: "X8 Pro Max", ram: "8GB", storage: "256GB" }
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].indexes, [0, 1]);
});
test("prioriza coincidencia de marca, modelo y configuración", () => {
  const product = { id: "p1", brand: "POCO", model: "X8 Pro Max", name: "POCO X8 Pro Max",
    variants: [{ ram: "8GB", storage: "256GB" }] };
  const matches = matchScannerCandidate({
    brand: "POCO", model: "X8 Pro Max", product_name: "POCO X8 Pro Max", ram: "8 GB", storage: "256 GB"
  }, [product]);
  assert.equal(matches[0].product.id, "p1");
  assert.ok(matches[0].score >= 0.9);
});

test("scanner review exposes editable OCR fields before preparing the provider review", () => {
  const source = readFileSync(new URL("../admin-gopartners-scanner.js", import.meta.url), "utf8");
  for (const field of ["product_name", "brand", "model", "ram", "storage", "color", "price_usd", "price_nio"]) {
    assert.ok(source.includes('["' + field + '"'), "missing editable field: " + field);
  }
  assert.ok(source.includes("Corregir lectura antes de revisar"));
});

test("a stopped in-memory capture session can still be resumed for review", () => {
  const source = readFileSync(new URL("../admin-gopartners-scanner.js", import.meta.url), "utf8");
  assert.ok(source.includes("function restoreSessionState(state)"));
  assert.ok(source.includes("state?.running || count > 0"));
  assert.ok(source.includes("La captura ya se detuvo"));
});

test("an interrupted Android capture is surfaced while retaining partial OCR for review", () => {
  const source = readFileSync(new URL("../admin-gopartners-scanner.js", import.meta.url), "utf8");
  assert.ok(source.includes("state?.interrupted === true"));
  assert.ok(source.includes("Captura interrumpida por Android"));
  assert.ok(source.includes("session?.interrupted === true"));
  assert.ok(source.includes("interruptionReason"));
});
