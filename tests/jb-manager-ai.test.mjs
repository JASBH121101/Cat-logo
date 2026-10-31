import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("admin.html", root), "utf8");
const admin = await readFile(new URL("admin.js", root), "utf8");
const assistant = await readFile(new URL("admin-ai.js", root), "utf8");
const css = await readFile(new URL("admin-ai.css", root), "utf8");
const endpoint = await readFile(new URL("functions/api/jb-manager-ai.js", root), "utf8");

test("JB Manager AI is a reachable authenticated admin workspace", () => {
  assert.match(html, /data-admin-section="ai"/);
  assert.match(html, /data-admin-panel="ai"/);
  assert.match(html, /id="jb-ai-floating-launcher"/);
  assert.match(html, /id="jb-ai-voice"/);
  assert.match(admin, /initJbManagerAI/);
  assert.match(admin, /jbManagerAI\?\.setAuthenticatedUser\(user\)/);
  assert.match(admin, /jbManagerAI\?\.clearSession\(\)/);
  assert.match(css, /\.jb-manager-ai-workspace/);
  assert.match(css, /\.jb-ai-floating-launcher/);
});

test("JB Manager AI requests the native Android microphone permission and keeps a text fallback", () => {
  assert.match(assistant, /nativeVoicePlugin\(\)/);
  assert.match(assistant, /native\.checkPermission\(\)/);
  assert.match(assistant, /native\.requestPermission\(\)/);
  assert.match(assistant, /permission\?\.permanentlyDenied/);
  assert.match(assistant, /native\.startListening\(\{ language: "es-NI" \}\)/);
  assert.match(assistant, /native\.addListener\("partialResult"/);
  assert.match(assistant, /native\.addListener\("result"/);
  assert.match(assistant, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/);
  assert.match(assistant, /recognition\.lang = "es-NI"/);
  assert.match(assistant, /recognition\.onresult/);
  assert.match(assistant, /Dictado listo\. Revisá el texto y presioná enviar/);
  assert.match(assistant, /form\.addEventListener\("submit"/);
  assert.doesNotMatch(assistant, /recognition\.onresult[\s\S]{0,800}sendMessage\(/);
  assert.doesNotMatch(assistant, /native\.addListener\(["']result["'][\s\S]{0,400}sendMessage\(/);
});

test("Gemini endpoint verifies Supabase identity and admin membership before calling the model", () => {
  const authCheck = endpoint.indexOf("async function authorizeAdmin");
  const modelCall = endpoint.indexOf("generativelanguage.googleapis.com");
  assert.ok(authCheck >= 0 && modelCall > authCheck);
  assert.match(endpoint, /\/auth\/v1\/user/);
  assert.match(endpoint, /\/rest\/v1\/admin_users/);
  assert.match(endpoint, /if \(!user\) return response\(403/);
  assert.match(endpoint, /env\.GEMINI_API_KEY/);
  assert.match(endpoint, /rateLimited\(request\)/);
  assert.match(endpoint, /request_too_large/);
});

test("Gemini cannot write to the catalog and all changes remain proposals", () => {
  assert.match(endpoint, /No afirmés que guardaste, cambiaste, publicaste, enviaste o ejecutaste acciones/);
  assert.match(endpoint, /Toda modificación de catálogo es solo una propuesta/);
  assert.doesNotMatch(endpoint, /\/rest\/v1\/products/);
  assert.doesNotMatch(endpoint, /service_role/i);
  assert.doesNotMatch(assistant, /supabase\.from\(["']products["']\)\.(insert|update|upsert|delete)/);
  assert.match(assistant, /No se realizó ningún cambio en el catálogo/);
});

test("assistant sends only bounded catalog context and renders model text safely", () => {
  assert.match(assistant, /slice\(0, 80\)/);
  assert.match(assistant, /products:\s*catalogContext\(getProducts\(\)\)/);
  assert.match(endpoint, /JSON\.stringify\(context\)/);
  assert.match(assistant, /paragraph\.textContent = text/);
  assert.match(endpoint, /slice\(0, 80\)/);
  assert.match(endpoint, /cleanText\(parsed\.message, 1800\)/);
});


test("JB Copilot textarea auto-expands for typing, prompts, and speech transcripts", () => {
  assert.match(assistant, /function resizeInput\(\)/);
  assert.match(assistant, /input\.addEventListener\("input", resizeInput\)/);
  assert.match(assistant, /resizeInput\(\);/);
  assert.match(assistant, /input\.scrollHeight/);
  assert.match(assistant, /input\.style\.overflowY/);
  assert.match(css, /resize:none/);
  assert.match(css, /max-height:176px/);
  assert.match(css, /overflow-y:hidden/);
});

test("JB Copilot renders missing fields as human-readable labels, not raw model keys", () => {
  assert.match(assistant, /Para continuar necesito:/);
  assert.match(assistant, /Precio del proveedor \(USD\)/);
  assert.match(assistant, /Configuración \(RAM y almacenamiento\)/);
  assert.match(assistant, /labels\[key\]/);
});


test("JB Copilot explains provider, session and service errors without a generic failure banner", () => {
  assert.match(assistant, /gemini_request_failed:/);
  assert.match(assistant, /gemini_unstructured_response:/);
  assert.match(assistant, /admin_verification_unavailable:/);
  assert.match(assistant, /No se hizo ningún cambio/);
  assert.match(assistant, /setStatus\(error\?\.message/);
});


test("JB Copilot supports natural conversation and prepares a structured product draft", () => {
  assert.match(endpoint, /asistente conversacional y operativo/);
  assert.match(endpoint, /productDraftSchema/);
  assert.match(endpoint, /product_draft: productDraft && productDraft\.name \? productDraft : null/);
  assert.match(endpoint, /No inventés modelo, especificaciones, RAM, almacenamiento, colores/);
  assert.match(endpoint, /Nunca calculés una moneda a partir de la otra/);
  assert.match(assistant, /onPrepareProductDraft/);
  assert.match(assistant, /Rellenar formulario/);
  assert.match(assistant, /no guarda, publica ni añade fotografías/);
  assert.match(admin, /onPrepareProductDraft: prepareProductDraft/);
  assert.match(admin, /async function prepareProductDraft/);
  assert.match(admin, /renderVariantRows\(variantRows\)/);
  assert.match(admin, /No se guardó, publicó ni asignó fotografías/);
  assert.match(admin, /showAdminSection\("add"\)/);
});

test("Product preparation uses the existing editor and never submits or writes directly", () => {
  const start = admin.indexOf("async function prepareProductDraft");
  const end = admin.indexOf("const PRODUCT_SUBCATEGORY_SUGGESTIONS", start);
  const preparation = admin.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(preparation, /clearEditor\(\)/);
  assert.match(preparation, /renderVariantRows\(variantRows\)/);
  assert.match(preparation, /scheduleProductDuplicateCheck\(\{ immediate: true \}\)/);
  assert.doesNotMatch(preparation, /\.submit\(|supabase\.from\(["']products["']\)/);
});


test("JB Copilot allows the Capacitor Android origin and handles blocked microphone requests", () => {
  assert.match(endpoint, /"https:\/\/localhost"/);
  assert.match(endpoint, /export async function onRequestOptions/);
  assert.match(endpoint, /export async function onRequestPost/);
  assert.match(assistant, /VOICE_PERMISSION_TIMEOUT/);
  assert.match(assistant, /native\.openAppSettings\(\)/);
  assert.match(assistant, /Abrir permisos del micrófono/);
  assert.match(css, /\.jb-ai-permission-settings/);
});


const jbAiEndpoint = await import(
  "data:text/javascript;base64," + Buffer.from(endpoint, "utf8").toString("base64")
);

test("JB Copilot CORS preflight accepts GitHub Pages and the Android Capacitor origin", async () => {
  for (const origin of ["https://jasbh121101.github.io", "https://localhost"]) {
    const request = new Request("https://jb-collections.pages.dev/api/jb-manager-ai", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type"
      }
    });
    const response = await jbAiEndpoint.onRequestOptions({ request });
    assert.equal(response.status, 204, origin);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
    assert.match(response.headers.get("Access-Control-Allow-Methods") || "", /POST/);
    assert.match(response.headers.get("Access-Control-Allow-Headers") || "", /Authorization/i);
  }
});

test("JB Copilot POST handler is reached and returns authentication_required, not 405", async () => {
  const request = new Request("https://jb-collections.pages.dev/api/jb-manager-ai", {
    method: "POST",
    headers: {
      Origin: "https://localhost",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message: "diagnostic" })
  });
  const response = await jbAiEndpoint.onRequestPost({ request, env: {} });
  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.equal(payload.error, "authentication_required");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://localhost");
});


test("JB Copilot migrates to Gemini 3.8 Flash using header-based API key authentication", async () => {
  assert.ok(endpoint.includes('name: "gemini-3.8-flash"'));
  assert.match(endpoint, /"x-goog-api-key": env\.GEMINI_API_KEY/);
  assert.doesNotMatch(endpoint, /gemini-2\.5-flash/);
  assert.doesNotMatch(endpoint, /temperature:\s*0\.2/);

  const originalFetch = globalThis.fetch;
  let geminiRequest;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "test-admin" }), { status: 200 });
    }
    if (url.includes("/rest/v1/admin_users")) {
      return new Response(JSON.stringify([{ user_id: "test-admin" }]), { status: 200 });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiRequest = { url, headers: init.headers, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                message: "¡Hola! Estoy listo.",
                intent: "question",
                product_query: "",
                provider_price_usd: null,
                provider_price_nio: null,
                catalog_type: "technology",
                missing_fields: [],
                product_draft: null
              })
            }]
          }
        }]
      }), { status: 200 });
    }
    throw new Error("Unexpected test request: " + url);
  };

  try {
    const request = new Request("https://jb-collections.pages.dev/api/jb-manager-ai", {
      method: "POST",
      headers: {
        Origin: "https://localhost",
        Authorization: "Bearer test-admin-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: "Contame qué podés hacer en JB Manager." })
    });
    const response = await jbAiEndpoint.onRequestPost({
      request,
      env: { GEMINI_API_KEY: "test-only-key" }
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.assistant.message, "¡Hola! Estoy listo.");
    assert.match(geminiRequest.url, /models\/gemini-3\.8-flash:generateContent$/);
    assert.doesNotMatch(geminiRequest.url, /[?&]key=/);
    assert.equal(geminiRequest.headers["x-goog-api-key"], "test-only-key");
    assert.equal(geminiRequest.body.generationConfig.temperature, undefined);
    assert.equal(geminiRequest.body.generationConfig.responseFormat.text.mimeType, "APPLICATION_JSON");
    const schema = geminiRequest.body.generationConfig.responseFormat.text.schema;
    assert.equal(schema.type, "object");
    assert.deepEqual(schema.properties.provider_price_usd.type, ["number", "null"]);
    assert.deepEqual(schema.properties.product_draft.type, ["object", "null"]);
    assert.equal(schema.properties.product_draft.properties.variants.type, "array");
    assert.doesNotMatch(endpoint, /nullable\s*:/);
    assert.doesNotMatch(endpoint, /type:\s*"[A-Z]+"/);
    assert.equal(geminiRequest.body.generationConfig.responseMimeType, undefined);
    assert.equal(geminiRequest.body.generationConfig.responseSchema, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("JB Copilot classifies Gemini upstream access, billing and quota failures", async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    {
      status: 403,
      body: { error: { status: "PERMISSION_DENIED", message: "API key was rejected" } },
      expected: "gemini_api_access_denied"
    },
    {
      status: 400,
      body: { error: { status: "FAILED_PRECONDITION", message: "Billing is required for this project free tier" } },
      expected: "gemini_billing_required"
    },
    {
      status: 429,
      body: { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } },
      expected: "gemini_quota_exhausted"
    }
  ];

  try {
    for (const item of cases) {
      globalThis.fetch = async input => {
        const url = String(input);
        if (url.includes("/auth/v1/user")) {
          return new Response(JSON.stringify({ id: "test-admin" }), { status: 200 });
        }
        if (url.includes("/rest/v1/admin_users")) {
          return new Response(JSON.stringify([{ user_id: "test-admin" }]), { status: 200 });
        }
        if (url.includes("generativelanguage.googleapis.com")) {
          return new Response(JSON.stringify(item.body), { status: item.status });
        }
        throw new Error("Unexpected test request: " + url);
      };

      const request = new Request("https://jb-collections.pages.dev/api/jb-manager-ai", {
        method: "POST",
        headers: {
          Origin: "https://localhost",
          Authorization: "Bearer test-admin-token",
          "Content-Type": "application/json",
          "CF-Connecting-IP": "192.0.2.99"
        },
        body: JSON.stringify({ message: "Contame qué podés hacer en JB Manager." })
      });
      const response = await jbAiEndpoint.onRequestPost({
        request,
        env: { GEMINI_API_KEY: "test-only-key" }
      });
      const payload = await response.json();
      assert.equal(payload.error, item.expected, "HTTP " + item.status);
      assert.equal(typeof payload.detail, "string", "Gemini error diagnostic for HTTP " + item.status);
      assert.match(payload.detail, new RegExp(item.body.error.status));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("JB Copilot recovers its send controls and releases requests that never return", () => {
  assert.match(assistant, /function withRequestDeadline\(promise, timeoutMs, message\)/);
  assert.match(assistant, /supabase\.auth\.getSession\(\),\s*12000/);
  assert.match(assistant, /requestTimer = window\.setTimeout\(/);
  assert.match(assistant, /requestTimedOut = true/);
  assert.match(assistant, /requestController\?\.abort\(\)/);
  assert.match(assistant, /finally\s*\{[\s\S]{0,180}setBusy\(false\)/);
  assert.match(assistant, /La consulta tardó más de 45 segundos/);
  assert.match(assistant, /setBusy\(false\);\s*resizeInput\(\);/);
  assert.match(assistant, /clearSession\(\)\s*\{[\s\S]{0,120}setBusy\(false\)/);
});


test("JB Copilot retries simple JSON mode when Gemini rejects the full product schema", async () => {
  const originalFetch = globalThis.fetch;
  const geminiBodies = [];
  const assistantResult = {
    message: "¡Hola! Estoy listo para ayudarte.",
    intent: "question",
    product_query: "",
    provider_price_usd: null,
    provider_price_nio: null,
    catalog_type: "technology",
    missing_fields: [],
    product_draft: null
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "test-admin" }), { status: 200 });
    }
    if (url.includes("/rest/v1/admin_users")) {
      return new Response(JSON.stringify([{ user_id: "test-admin" }]), { status: 200 });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      const body = JSON.parse(init.body);
      geminiBodies.push(body);
      if (geminiBodies.length === 1) {
        return new Response(JSON.stringify({
          error: {
            code: 400,
            status: "INVALID_ARGUMENT",
            message: "Response schema is not supported for this request."
          }
        }), { status: 400 });
      }
      return new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text: JSON.stringify(assistantResult) }] }
        }]
      }), { status: 200 });
    }
    throw new Error("Unexpected test request: " + url);
  };

  try {
    const request = new Request("https://jb-collections.pages.dev/api/jb-manager-ai", {
      method: "POST",
      headers: {
        Origin: "https://localhost",
        Authorization: "Bearer test-admin-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: "Contame qué podés hacer en JB Manager." })
    });
    const response = await jbAiEndpoint.onRequestPost({
      request,
      env: { GEMINI_API_KEY: "test-only-key" }
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.assistant.message, assistantResult.message);
    assert.equal(geminiBodies.length, 2);
    assert.equal(geminiBodies[0].generationConfig.responseFormat.text.mimeType, "APPLICATION_JSON");
    assert.ok(geminiBodies[0].generationConfig.responseFormat.text.schema);
    assert.equal(geminiBodies[1].generationConfig.responseMimeType, "application/json");
    assert.equal(geminiBodies[1].generationConfig.responseSchema, undefined);
    assert.equal(geminiBodies[1].generationConfig.responseFormat, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("JB Copilot fails over from an overloaded Gemini 3.8 model to stable Flash", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const assistantResult = {
    message: "¡Hola! Ya estoy disponible.",
    intent: "question",
    product_query: "",
    provider_price_usd: null,
    provider_price_nio: null,
    catalog_type: "technology",
    missing_fields: [],
    product_draft: null
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "test-admin" }), { status: 200 });
    }
    if (url.includes("/rest/v1/admin_users")) {
      return new Response(JSON.stringify([{ user_id: "test-admin" }]), { status: 200 });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      if (calls.length === 1) {
        return new Response(JSON.stringify({
          error: {
            code: 503,
            status: "UNAVAILABLE",
            message: "This model is currently experiencing high demand."
          }
        }), { status: 503 });
      }
      return new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text: JSON.stringify(assistantResult) }] }
        }]
      }), { status: 200 });
    }
    throw new Error("Unexpected test request: " + url);
  };

  try {
    const request = new Request("https://jb-collections.pages.dev/api/jb-manager-ai", {
      method: "POST",
      headers: {
        Origin: "https://localhost",
        Authorization: "Bearer test-admin-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: "Contame qué podés hacer en JB Manager." })
    });
    const result = await jbAiEndpoint.onRequestPost({
      request,
      env: { GEMINI_API_KEY: "test-only-key" }
    });
    const payload = await result.json();

    assert.equal(result.status, 200);
    assert.equal(payload.assistant.message, assistantResult.message);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /models\/gemini-3\.8-flash:generateContent$/);
    assert.match(calls[1].url, /models\/gemini-3\.6-flash:generateContent$/);
    assert.equal(calls[0].body.generationConfig.responseFormat.text.schema.type, "object");
    assert.equal(calls[1].body.generationConfig.responseMimeType, "application/json");
    assert.equal(calls[1].body.generationConfig.responseSchema, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("JB Copilot falls back to Flash-Lite when both primary Flash models are unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const modelCalls = [];
  const assistantResult = {
    message: "¡Hola! Estoy listo.",
    intent: "question",
    product_query: "",
    provider_price_usd: null,
    provider_price_nio: null,
    catalog_type: "technology",
    missing_fields: [],
    product_draft: null
  };

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "test-admin" }), { status: 200 });
    if (url.includes("/rest/v1/admin_users")) return new Response(JSON.stringify([{ user_id: "test-admin" }]), { status: 200 });
    if (url.includes("generativelanguage.googleapis.com")) {
      modelCalls.push(url);
      if (modelCalls.length < 3) {
        return new Response(JSON.stringify({
          error: { code: 503, status: "UNAVAILABLE", message: "High demand" }
        }), { status: 503 });
      }
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(assistantResult) }] } }]
      }), { status: 200 });
    }
    throw new Error("Unexpected test request: " + url);
  };

  try {
    const request = new Request("https://jb-collections.pages.dev/api/jb-manager-ai", {
      method: "POST",
      headers: {
        Origin: "https://localhost",
        Authorization: "Bearer test-admin-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: "Contame qué podés hacer en JB Manager." })
    });
    const result = await jbAiEndpoint.onRequestPost({
      request,
      env: { GEMINI_API_KEY: "test-only-key" }
    });
    const payload = await result.json();
    assert.equal(result.status, 200);
    assert.equal(payload.assistant.message, assistantResult.message);
    assert.equal(modelCalls.length, 3);
    assert.match(modelCalls[2], /models\/gemini-3\.5-flash-lite:generateContent$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("JB Copilot answers a simple greeting without depending on Gemini availability", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "test-admin" }), { status: 200 });
    if (url.includes("/rest/v1/admin_users")) return new Response(JSON.stringify([{ user_id: "test-admin" }]), { status: 200 });
    throw new Error("A simple greeting must not call Gemini: " + url);
  };

  try {
    const request = new Request("https://jb-collections.pages.dev/api/jb-manager-ai", {
      method: "POST",
      headers: {
        Origin: "https://localhost",
        Authorization: "Bearer test-admin-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: "¡Hola bro!" })
    });
    const result = await jbAiEndpoint.onRequestPost({ request, env: {} });
    const payload = await result.json();
    assert.equal(result.status, 200);
    assert.match(payload.assistant.message, /¡Hola!/);
    assert.match(payload.assistant.message, /¿Qué necesitás gestionar hoy/);
    assert.equal(payload.assistant.intent, "question");
    assert.ok(!calls.some(url => url.includes("generativelanguage.googleapis.com")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("JB Copilot accepts natural-language text or common reply aliases from Gemini", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "test-admin" }), { status: 200 });
    if (url.includes("/rest/v1/admin_users")) return new Response(JSON.stringify([{ user_id: "test-admin" }]), { status: 200 });
    if (url.includes("generativelanguage.googleapis.com")) {
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: "Puedo ayudarte con consultas y productos." }) }] } }]
      }), { status: 200 });
    }
    throw new Error("Unexpected test request: " + url);
  };

  try {
    const request = new Request("https://jb-collections.pages.dev/api/jb-manager-ai", {
      method: "POST",
      headers: {
        Origin: "https://localhost",
        Authorization: "Bearer test-admin-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: "Contame qué podés hacer en JB Manager." })
    });
    const result = await jbAiEndpoint.onRequestPost({ request, env: { GEMINI_API_KEY: "test-only-key" } });
    const payload = await result.json();
    assert.equal(result.status, 200);
    assert.equal(payload.assistant.message, "Puedo ayudarte con consultas y productos.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("JB Copilot never returns a successful generic answer for malformed model JSON", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "test-admin" }), { status: 200 });
    if (url.includes("/rest/v1/admin_users")) return new Response(JSON.stringify([{ user_id: "test-admin" }]), { status: 200 });
    if (url.includes("generativelanguage.googleapis.com")) {
      return new Response(JSON.stringify({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ intent: "question", product_query: "" }) }] } }]
      }), { status: 200 });
    }
    throw new Error("Unexpected test request: " + url);
  };

  try {
    const request = new Request("https://jb-collections.pages.dev/api/jb-manager-ai", {
      method: "POST",
      headers: {
        Origin: "https://localhost",
        Authorization: "Bearer test-admin-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: "Explicame cómo funciona el catálogo." })
    });
    const result = await jbAiEndpoint.onRequestPost({ request, env: { GEMINI_API_KEY: "test-only-key" } });
    const payload = await result.json();
    assert.equal(result.status, 502);
    assert.equal(payload.error, "gemini_unstructured_response");
    assert.match(payload.detail, /Campos recibidos/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
