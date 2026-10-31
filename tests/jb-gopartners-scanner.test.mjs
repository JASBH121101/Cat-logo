import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchScannerCandidate, normalizeScannerKey, scannerDuplicateGroups, scannerSessionReviewable, scannerSessionStatus } from "../admin-gopartners-scanner.js";
import { groundScannerProducts, onRequestPost as handleScannerPost } from "../functions/api/jb-gopartners-scan.js";

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
  const api = source.indexOf('fetch("https://jb-collections.pages.dev/api/jb-gopartners-scan"', finish);
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

test("OCR grounding recovers a product when Gemini returns the wrong observation index", () => {
  const diagnostics = {};
  const result = groundScannerProducts([{
    source_observation: 7, product_name: "POCO X8 Pro Max", model: "X8 Pro Max",
    evidence: "POCO X8 Pro Max", price_usd: 245
  }], [{ index: 1, text: "POCO X8 Pro Max US$ 245" }], diagnostics);
  assert.equal(result.length, 1);
  assert.equal(result[0].source_observation, 1);
  assert.equal(result[0].price_usd, 245);
  assert.equal(diagnostics.source_index_recovered, 1);
});

test("OCR grounding tolerates one character misread in a long product identity but still validates prices exactly", () => {
  const source = "POCO X8 Pro M4x | 12 GB RAM | 256 GB | Negro | US$ 245.00";
  const [product] = groundScannerProducts([{
    source_observation: 1,
    product_name: "POCO X8 Pro Max",
    brand: "POCO",
    model: "X8 Pro Max",
    ram: "12 GB",
    storage: "256 GB",
    color: "Negro",
    price_usd: 245,
    price_nio: 245,
    evidence: source
  }], [{ index: 1, text: source }]);
  assert.ok(product);
  assert.equal(product.product_name, "POCO X8 Pro Max");
  assert.ok(product.approximate_fields.includes("product_name"));
  assert.equal(product.ram, "12 GB");
  assert.equal(product.price_usd, 245);
  assert.equal(product.price_nio, null);
  assert.ok(product.notes.some(note => /pequeña diferencia OCR/.test(note)));
});

test("OCR preview exposes the exact locally recognized screen text without HTML injection", () => {
  const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../admin-gopartners-scanner.js", import.meta.url), "utf8");
  assert.match(html, /id="jb-gp-scan-ocr-preview"/);
  assert.match(html, /id="jb-gp-scan-ocr-content"/);
  assert.match(source, /function renderOcrPreview\(observations\)/);
  assert.match(source, /text\.textContent = item\.text/);
  assert.match(source, /Ver texto reconocido/);
});

test("scanner reports whether Gemini found no candidates or grounding rejected its candidates", () => {
  const source = readFileSync(new URL("../admin-gopartners-scanner.js", import.meta.url), "utf8");
  assert.match(source, /payload\.diagnostics/);
  assert.match(source, /candidates_received/);
  assert.match(source, /Gemini propuso/);
  assert.match(source, /Gemini no encontró una identidad de producto clara/);
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


test("JARVIS scanner requests overlay access once and resumes the scan after permission is granted", () => {
  const source = readFileSync(new URL("../admin-gopartners-scanner.js", import.meta.url), "utf8");
  assert.match(source, /native\.hasOverlayPermission\(\)/);
  assert.match(source, /native\.requestOverlayPermission\(\)/);
  assert.match(source, /pendingOverlayPermission = true/);
  assert.match(source, /Al regresar, JARVIS iniciará el escaneo automáticamente/);
  assert.match(source, /document\.addEventListener\("visibilitychange"/);
});

test("floating confirmation automatically returns to JB Manager and starts review", () => {
  const source = readFileSync(new URL("../admin-gopartners-scanner.js", import.meta.url), "utf8");
  const nativeOverlay = readFileSync(new URL("../mobile/native-android/GoPartnersOverlayService.java", import.meta.url), "utf8");
  const nativePlugin = readFileSync(new URL("../mobile/native-android/GoPartnersScannerPlugin.java", import.meta.url), "utf8");
  assert.match(nativeOverlay, /GoPartnersScanSession\.requestFinishFromOverlay\(\)/);
  assert.match(nativeOverlay, /Finalizar y revisar/);
  assert.match(nativeOverlay, /PendingIntent\.getActivity/);
  assert.match(nativePlugin, /finishRequested/);
  assert.match(source, /state\?\.finishRequested === true/);
  assert.match(source, /void finish\(\)/);
  assert.match(source, /await native\.stopScan\(\)/);
});

test("scanner overlay is installed with the Android special permission and service declaration", () => {
  const workflow = readFileSync(new URL("../.github/workflows/build-jb-manager-android.yml", import.meta.url), "utf8");
  const overlay = readFileSync(new URL("../mobile/native-android/GoPartnersOverlayService.java", import.meta.url), "utf8");
  assert.match(workflow, /GoPartnersOverlayService\.java/);
  assert.match(workflow, /android\.permission\.SYSTEM_ALERT_WINDOW/);
  assert.match(workflow, /GoPartnersOverlayService/);
  assert.match(overlay, /Settings\.canDrawOverlays/);
  assert.match(overlay, /TYPE_APPLICATION_OVERLAY/);
});

test("Go Partners scanner controls are embedded in the Copilot conversation", () => {
  const html = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
  const chatStart = html.indexOf('<section class="jb-manager-ai-chat"');
  const scannerStart = html.indexOf('id="jb-gp-scanner"');
  const promptsStart = html.indexOf('class="jb-manager-ai-prompts"');
  assert.ok(chatStart >= 0 && scannerStart > chatStart && promptsStart > scannerStart);
  assert.equal((html.match(/id="jb-gp-scanner"/g) || []).length, 1);
  assert.equal((html.match(/id="jb-gp-scan-start"/g) || []).length, 1);
});


test("APK scanner sends OCR text to the authenticated Cloudflare endpoint, not local WebView routes", () => {
  const source = readFileSync(new URL("../admin-gopartners-scanner.js", import.meta.url), "utf8");
  const endpoint = readFileSync(new URL("../functions/api/jb-gopartners-scan.js", import.meta.url), "utf8");
  assert.match(source, /fetch\("https:\/\/jb-collections\.pages\.dev\/api\/jb-gopartners-scan"/);
  assert.match(endpoint, /https:\/\/localhost/);
  assert.match(endpoint, /Authorization: "Bearer " \+ token/);
});


test("capture service does not stop the overlay while creating its notification channel", () => {
  const source = readFileSync(new URL("../mobile/native-android/GoPartnersCaptureService.java", import.meta.url), "utf8");
  const channelStart = source.indexOf("private void createNotificationChannel()");
  const channelEnd = source.indexOf("private Notification buildNotification()", channelStart);
  const shutdownStart = source.indexOf("private synchronized void finishShutdown()");
  const shutdownEnd = source.indexOf("@Override", shutdownStart);
  const channelBlock = source.slice(channelStart, channelEnd);
  const shutdownBlock = source.slice(shutdownStart, shutdownEnd);
  assert.ok(channelStart >= 0 && channelEnd > channelStart);
  assert.doesNotMatch(channelBlock, /stopService\(new Intent\(this, GoPartnersOverlayService\.class\)\)/);
  assert.match(shutdownBlock, /stopService\(new Intent\(this, GoPartnersOverlayService\.class\)\)/);
});

test("scanner uses current Gemini 3.8 structured output and retries without schema if Google rejects it", async () => {
  const originalFetch = globalThis.fetch;
  const evidence = "POCO X8 Pro Max | 12 GB RAM | 256 GB | Negro | US$ 245.00";
  const attempts = [];
  const generated = {
    products: [{
      source_observation: 1,
      product_name: "POCO X8 Pro Max",
      brand: "POCO",
      model: "X8 Pro Max",
      category: "",
      catalog_type: "technology",
      ram: "12 GB",
      storage: "256 GB",
      color: "Negro",
      price_usd: 245,
      price_nio: null,
      confidence: 1,
      evidence,
      notes: []
    }],
    session_notes: []
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "scanner-admin" }), { status: 200 });
    }
    if (url.includes("/rest/v1/admin_users")) {
      return new Response(JSON.stringify([{ user_id: "scanner-admin" }]), { status: 200 });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      attempts.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      if (attempts.length === 1) {
        return new Response(JSON.stringify({
          error: { status: "INVALID_ARGUMENT", message: "Test schema rejection" }
        }), { status: 400 });
      }
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(generated) }] } }]
      }), { status: 200 });
    }
    throw new Error("Unexpected scanner request: " + url);
  };

  try {
    const request = new Request("https://jb-collections.pages.dev/api/jb-gopartners-scan", {
      method: "POST",
      headers: {
        Origin: "https://localhost",
        Authorization: "Bearer scanner-test-token",
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.0.2.101"
      },
      body: JSON.stringify({ observations: [{ index: 1, capturedAt: "2026-10-31T14:00:00Z", text: evidence }] })
    });
    const response = await handleScannerPost({ request, env: { GEMINI_API_KEY: "scanner-test-key" } });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.products[0].price_usd, 245);
    assert.equal(attempts.length, 2);
    assert.match(attempts[0].url, /models\/gemini-3\.8-flash:generateContent$/);
    assert.equal(attempts[0].headers["x-goog-api-key"], "scanner-test-key");
    assert.doesNotMatch(attempts[0].url, /[?&]key=/);
    assert.equal(attempts[0].body.generationConfig.responseFormat.text.mimeType, "APPLICATION_JSON");
    assert.equal(attempts[1].body.generationConfig.responseMimeType, "application/json");
    assert.equal(attempts[1].body.generationConfig.responseFormat, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanner falls back to Gemini 3.6 when Gemini 3.8 is temporarily unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const evidence = "Samsung Galaxy A56 | 8 GB RAM | 256 GB | US$ 310";
  const calls = [];
  const generated = { products: [], session_notes: [] };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "scanner-admin" }), { status: 200 });
    }
    if (url.includes("/rest/v1/admin_users")) {
      return new Response(JSON.stringify([{ user_id: "scanner-admin" }]), { status: 200 });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      calls.push({ url, body: JSON.parse(init.body) });
      if (url.includes("gemini-3.8-flash")) {
        return new Response(JSON.stringify({
          error: { status: "UNAVAILABLE", message: "Model temporarily unavailable" }
        }), { status: 503 });
      }
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(generated) }] } }]
      }), { status: 200 });
    }
    throw new Error("Unexpected scanner request: " + url);
  };
  try {
    const request = new Request("https://jb-collections.pages.dev/api/jb-gopartners-scan", {
      method: "POST",
      headers: {
        Origin: "https://localhost",
        Authorization: "Bearer scanner-test-token",
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.0.2.102"
      },
      body: JSON.stringify({ observations: [{ index: 1, text: evidence }] })
    });
    const response = await handleScannerPost({ request, env: { GEMINI_API_KEY: "scanner-test-key" } });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /gemini-3\.8-flash/);
    assert.match(calls[1].url, /gemini-3\.6-flash/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanner classifies Gemini access failures and returns a safe diagnostic", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "scanner-admin" }), { status: 200 });
    }
    if (url.includes("/rest/v1/admin_users")) {
      return new Response(JSON.stringify([{ user_id: "scanner-admin" }]), { status: 200 });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      return new Response(JSON.stringify({
        error: { status: "PERMISSION_DENIED", message: "API key was rejected" }
      }), { status: 403 });
    }
    throw new Error("Unexpected scanner request: " + url);
  };
  try {
    const request = new Request("https://jb-collections.pages.dev/api/jb-gopartners-scan", {
      method: "POST",
      headers: {
        Origin: "https://localhost",
        Authorization: "Bearer scanner-test-token",
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.0.2.103"
      },
      body: JSON.stringify({ observations: [{ index: 1, text: "POCO X8 Pro Max 12 GB RAM 256 GB" }] })
    });
    const response = await handleScannerPost({ request, env: { GEMINI_API_KEY: "scanner-test-key" } });
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.error, "gemini_api_access_denied");
    assert.match(payload.detail, /HTTP 403/);
    assert.match(payload.detail, /PERMISSION_DENIED/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("Android OCR does not discard changed screens using a sparse pixel hash", () => {
  const source = readFileSync(new URL("../mobile/native-android/GoPartnersCaptureService.java", import.meta.url), "utf8");
  assert.doesNotMatch(source, /bitmapHash|lastFrameHash|CRC32/);
  assert.match(source, /MIN_FRAME_INTERVAL_MS/);
  assert.match(source, /recognizer\.process\(InputImage\.fromBitmap\(frame, 0\)\)/);
  assert.match(source, /normalized\.equals\(lastRecognizedText\)/);
  assert.match(source, /duplicate recognized text is filtered after ML Kit/i);
});


test("OCR grounding reads configuration and price far below the product title on a detail screen", () => {
  const source = [
    "Go Partners",
    "Notificación: recibimos tu récord policial; el equipo lo revisa en 1 a 2 días",
    "Apple iPhone 18 Pro Max Esim",
    ...Array.from({ length: 14 }, (_, index) => "Información adicional de la ficha " + (index + 1)),
    "MEMORIA",
    "256GB",
    "COLOR",
    "Glacier",
    "PRECIO",
    "$1649",
    "C$ 61,013",
    "DISPONIBLE"
  ].join("\\n");
  const [product] = groundScannerProducts([{
    source_observation: 1,
    product_name: "Apple iPhone 18 Pro Max Esim",
    brand: "Apple",
    model: "iPhone 18 Pro Max Esim",
    category: "",
    catalog_type: "technology",
    ram: "",
    storage: "256GB",
    color: "Glacier",
    price_usd: 1649,
    price_nio: 61013,
    availability: "available",
    confidence: 1,
    evidence: "Apple iPhone 18 Pro Max Esim"
  }], [{ index: 1, text: source }]);
  assert.ok(product);
  assert.equal(product.storage, "256GB");
  assert.equal(product.color, "Glacier");
  assert.equal(product.price_usd, 1649);
  assert.equal(product.price_nio, 61013);
  assert.equal(product.availability, "available");
});

test("OCR grounding distinguishes Bajo pedido from Disponible and does not invent a price", () => {
  const source = "Apple iPhone 18 Pro Max Esim\\n512GB\\nGlacier\\nBAJO PEDIDO\\nA confirmar";
  const [product] = groundScannerProducts([{
    source_observation: 1,
    product_name: "Apple iPhone 18 Pro Max Esim",
    brand: "Apple",
    model: "iPhone 18 Pro Max Esim",
    storage: "512GB",
    color: "Glacier",
    price_usd: null,
    price_nio: null,
    availability: "on_request",
    evidence: "Apple iPhone 18 Pro Max Esim"
  }], [{ index: 1, text: source }]);
  assert.ok(product);
  assert.equal(product.availability, "on_request");
  assert.equal(product.price_usd, null);
  assert.equal(product.price_nio, null);
});

test("OCR grounding prioritizes No disponible over the substring Disponible", () => {
  const source = "Apple iPhone 18 Pro Max Esim\\n256GB\\nNo disponible";
  const [product] = groundScannerProducts([{
    source_observation: 1,
    product_name: "Apple iPhone 18 Pro Max Esim",
    model: "iPhone 18 Pro Max Esim",
    storage: "256GB",
    availability: "available",
    evidence: "Apple iPhone 18 Pro Max Esim"
  }], [{ index: 1, text: source }]);
  assert.ok(product);
  assert.equal(product.availability, "unavailable");
});
