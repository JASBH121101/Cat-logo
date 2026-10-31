import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchScannerCandidate, normalizeScannerKey, scannerDuplicateGroups, scannerSessionReviewable, scannerSessionStatus } from "../admin-gopartners-scanner.js";
import { groundScannerProducts } from "../functions/api/jb-gopartners-scan.js";

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
  assert.ok(source.includes("scannerSessionReviewable(state)"));
  assert.ok(source.includes("scannerSessionStatus(state)"));
  assert.ok(source.includes("Captura interrumpida por Android"));
});


test("Android interruption preserves partial OCR observations for review", () => {
  const state = {
    running: false, processing: false, interrupted: true,
    interruptionReason: "Android detuvo o revocó el permiso de captura.",
    observationsCount: 3
  };
  assert.equal(scannerSessionReviewable(state), true);
  const message = scannerSessionStatus(state);
  assert.match(message, /Captura interrumpida por Android/);
  assert.match(message, /3 pantalla\(s\) parcial\(es\)/);
  assert.match(message, /revocó el permiso/);
});

test("stopped sessions with OCR observations remain reviewable without interruption", () => {
  assert.equal(scannerSessionReviewable({ running: false, processing: false, observationsCount: 2 }), true);
  assert.match(scannerSessionStatus({ running: false, observationsCount: 2 }), /listas para revisar/);
  assert.equal(scannerSessionReviewable({ running: false, processing: false, observationsCount: 0 }), false);
});

test("scanner listens for interrupted native sessions after returning from Go Partners", () => {
  const source = readFileSync(new URL("../admin-gopartners-scanner.js", import.meta.url), "utf8");
  assert.match(source, /state\?\.interrupted === true/);
  assert.match(source, /session\?\.interrupted === true/);
  assert.match(source, /interruptionReason/);
  assert.match(source, /if \(!native\) return;/);
});

test("scanner surfaces explicit light and dark theme tokens", () => {
  const css = readFileSync(new URL("../admin-gopartners-scanner.css", import.meta.url), "utf8");
  assert.match(css, /html\[data-theme="light"\] body\.admin-body \.jb-gp-scanner/);
  assert.match(css, /html\[data-theme="dark"\] body\.admin-body \.jb-gp-scanner/);
  assert.match(css, /\.jb-gp-scanner select/);
});


test("starting a new scan never clears a pending interrupted OCR session", () => {
  const source = readFileSync(new URL("../admin-gopartners-scanner.js", import.meta.url), "utf8");
  const start = source.indexOf("  async function start()");
  const finish = source.indexOf("  async function finish()", start);
  const startBlock = source.slice(start, finish);
  assert.ok(start >= 0 && finish > start);
  assert.ok(startBlock.indexOf("const pendingSession = await native.getScanState()") >= 0);
  assert.ok(startBlock.indexOf("scannerSessionReviewable(pendingSession)") <
    startBlock.indexOf("await native.clearScan()"));
});

test("OCR observations remain in native memory until a successful review is rendered", () => {
  const source = readFileSync(new URL("../admin-gopartners-scanner.js", import.meta.url), "utf8");
  const finish = source.indexOf("  async function finish()");
  const api = source.indexOf('fetch("/api/jb-gopartners-scan"', finish);
  const render = source.indexOf("renderReview();", api);
  const clearAfterReview = source.indexOf("const cleared = await native.clearScan()", render);
  assert.ok(finish >= 0 && api > finish && render > api);
  assert.ok(clearAfterReview > render, "OCR must only be cleared after analysis and review rendering succeed");
  assert.match(source, /recoverableSession = true/);
  assert.match(source, /El texto OCR sigue guardado temporalmente/);
  assert.match(source, /const cleared = await native\.clearScan\(\)/);
  assert.match(source, /cleared\?\.cleared !== true/);
});


test("discard confirms native deletion before clearing review state or reporting success", () => {
  const source = readFileSync(new URL("../admin-gopartners-scanner.js", import.meta.url), "utf8");
  const start = source.indexOf("  async function clearSession()");
  const end = source.indexOf("  startButton.addEventListener", start);
  const block = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(block, /state\?\.running === true \|\| state\?\.processing === true/);
  assert.match(block, /cleared\?\.cleared !== true/);
  assert.ok(block.indexOf("cleared?.cleared !== true") < block.indexOf("scanCandidates = []"));
  assert.match(block, /Los resultados no se consideran eliminados/);
});


test("unmatched Go Partners candidates can prepare a grouped new-product draft only after matching and duplicate review", () => {
  const source = readFileSync(new URL("../admin-gopartners-scanner.js", import.meta.url), "utf8");
  assert.match(source, /onPrepareNewProduct/);
  assert.match(source, /newProductGroups/);
  assert.match(source, /hasExistingMatch/);
  assert.match(source, /Preparar producto nuevo/);
  assert.match(source, /duplicate\.decision !== "same"/);
  assert.match(source, /price_usd: usd\.length && !usdHasMissing \? usd\[0\] : null/);
  assert.match(source, /color_hex: ""/);
  assert.match(source, /availability: "unknown"/);
  assert.match(source, /onPrepareNewProduct\(draft\)/);
});

test("Go Partners new-product preparation blocks conflicting prices within one configuration", () => {
  const source = readFileSync(new URL("../admin-gopartners-scanner.js", import.meta.url), "utf8");
  assert.match(source, /usd\.length > 1 \|\| nio\.length > 1/);
  assert.match(source, /tiene precios distintos entre colores\/capturas/);
  assert.match(source, /No se guardó nada/);
});


test("scanner never carries a supplier price across color rows when OCR missed another price", () => {
  const source = readFileSync(new URL("../admin-gopartners-scanner.js", import.meta.url), "utf8");
  assert.match(source, /usdHasMissing/);
  assert.match(source, /nioHasMissing/);
  assert.match(source, /usd\.length && !usdHasMissing \? usd\[0\] : null/);
  assert.match(source, /nio\.length && !nioHasMissing \? nio\[0\] : null/);
});


test("OCR grounding keeps only fields visible in the matching supplier observation", () => {
  const evidence = "POCO X8 Pro Max | 12 GB RAM | 256 GB | Negro | US$ 245.00";
  const observations = [{ index: 1, text: "Catálogo del proveedor\n" + evidence }];
  const [product] = groundScannerProducts([{
    source_observation: 1,
    product_name: "POCO X8 Pro Max",
    brand: "POCO",
    model: "X8 Pro Max",
    category: "Celulares",
    catalog_type: "technology",
    ram: "12 GB",
    storage: "256 GB",
    color: "Negro",
    price_usd: 245,
    price_nio: 245,
    confidence: 1,
    evidence
  }], observations);

  assert.ok(product);
  assert.equal(product.product_name, "POCO X8 Pro Max");
  assert.equal(product.brand, "POCO");
  assert.equal(product.model, "X8 Pro Max");
  assert.equal(product.ram, "12 GB");
  assert.equal(product.storage, "256 GB");
  assert.equal(product.color, "Negro");
  assert.equal(product.category, "");
  assert.equal(product.price_usd, 245);
  assert.equal(product.price_nio, null);
  assert.ok(product.unverified_fields.includes("category"));
  assert.ok(product.unverified_fields.includes("price_nio"));
  assert.ok(product.grounded_fields.includes("price_usd"));
  assert.equal(product.confidence, product.grounded_fields.length / product.attempted_fields.length);
});

test("OCR grounding removes invented RAM, color and prices instead of trusting model confidence", () => {
  const evidence = "POCO X8 Pro Max | 12 GB RAM | 256 GB | Negro | US$ 245.00";
  const [product] = groundScannerProducts([{
    source_observation: 1,
    product_name: "POCO X8 Pro Max",
    brand: "POCO",
    model: "X8 Pro Max",
    ram: "16 GB",
    storage: "256 GB",
    color: "Azul",
    price_usd: 299,
    confidence: 1,
    evidence
  }], [{ index: 1, text: evidence }]);

  assert.ok(product);
  assert.equal(product.ram, "");
  assert.equal(product.storage, "256 GB");
  assert.equal(product.color, "");
  assert.equal(product.price_usd, null);
  assert.ok(product.unverified_fields.includes("ram"));
  assert.ok(product.unverified_fields.includes("color"));
  assert.ok(product.unverified_fields.includes("price_usd"));
  assert.ok(product.notes.some(note => /precio USD/.test(note)));
});

test("OCR grounding rejects candidates whose source observation does not exist", () => {
  const result = groundScannerProducts([{
    source_observation: 7, product_name: "POCO X8 Pro Max", model: "X8 Pro Max",
    evidence: "POCO X8 Pro Max", price_usd: 245
  }], [{ index: 1, text: "POCO X8 Pro Max US$ 245" }]);
  assert.deepEqual(result, []);
});

test("OCR grounding replaces a fabricated citation with a source excerpt around the model", () => {
  const source = "Producto destacado: POCO X8 Pro Max · 12 GB RAM · 256 GB · US$ 245.00";
  const [product] = groundScannerProducts([{
    source_observation: 1, product_name: "POCO X8 Pro Max", brand: "POCO",
    model: "X8 Pro Max", ram: "12 GB", storage: "256 GB", price_usd: 245,
    evidence: "POCO X8 Pro Max · US$ 999.99"
  }], [{ index: 1, text: source }]);

  assert.ok(product);
  assert.notEqual(product.evidence, "POCO X8 Pro Max · US$ 999.99");
  assert.match(product.evidence, /POCO X8 Pro Max/);
  assert.equal(product.price_usd, 245);
});

test("voice replies remain opt-in and automatically switch off when the app is backgrounded", () => {
  const source = readFileSync(new URL("../admin-ai.js", import.meta.url), "utf8");
  assert.match(source, /let speechEnabled = false/);
  assert.match(source, /!speechEnabled \|\| document\.hidden/);
  assert.match(source, /if \(document\.hidden\) \{[\s\S]*setSpeechEnabled\(false\)/);
  assert.match(source, /window\.addEventListener\("pagehide",[\s\S]*setSpeechEnabled\(false\)/);
});
