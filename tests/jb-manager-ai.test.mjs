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
  assert.match(endpoint, /No afirmés que guardaste, cambiaste o publicaste datos/);
  assert.match(endpoint, /Toda modificación debe presentarse como propuesta/);
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
