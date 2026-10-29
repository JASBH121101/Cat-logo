import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import test, { after } from "node:test";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const SESSION_KEY = "jb-private-chat-session-token-v1";
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};

const server = createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  if (pathname === "/__chat-resume-test.html") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/chat-return.css?v=20261029-resume1">
<script>window.CATALOG_CONFIG = { publicCatalogUrl: location.origin };</script>
</head>
<body><main><h1>Catálogo de prueba</h1></main></body></html>`);
    return;
  }

  const filename = resolve(root, "." + pathname);
  if (!filename.startsWith(root + sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  readFile(filename, (error, bytes) => {
    if (error) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filename).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(bytes);
  });
});

await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListen);
});
const address = server.address();
assert.ok(address && typeof address === "object");
const origin = "http://127.0.0.1:" + address.port;

after(async () => {
  await new Promise(resolveClose => server.close(resolveClose));
});

async function openPage(browser, mode, token = "a".repeat(64)) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    // Keep storage clean between browser-context tests; tokens are seeded once page has an origin.
  });
  const statusRequests = [];
  await page.route("**/api/private-chat", async route => {
    let body = {};
    try { body = route.request().postDataJSON(); } catch {}
    statusRequests.push(body);
    if (mode === "expired") {
      await route.fulfill({
        status: 410,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "session_expired", message: "Sesión vencida" })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        conversation: { id: "chat-test", status: "declined_pending_delete", delete_after: new Date(Date.now() + 600000).toISOString() }
      })
    });
  });
  await page.goto(origin + "/__chat-resume-test.html", { waitUntil: "commit", timeout: 8000 });
  await page.setContent(`<!doctype html><html lang="es"><head><meta charset="utf-8">
    <script>window.CATALOG_CONFIG = { publicCatalogUrl: location.origin };</script>
    <style>body{font:16px system-ui}#jb-chat-resume-panel{position:fixed;right:10px;bottom:10px}</style>
    </head><body><main><h1>Catálogo de prueba</h1></main></body></html>`, { waitUntil: "domcontentloaded", timeout: 8000 });
  await page.evaluate(({ key, savedToken }) => localStorage.setItem(key, savedToken), { key: SESSION_KEY, savedToken: token });
  await page.addScriptTag({ path: resolve(root, "chat-return.js") });
  page.statusRequests = statusRequests;
  return page;
}

test("active private chat is recoverable from the catalog after closing its original tab", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const token = "b".repeat(64);
    const page = await openPage(browser, "active", token);
    await page.waitForSelector("#jb-chat-resume-panel", { timeout: 8000 });
    assert.ok(page.statusRequests.some(item => item.action === "status" && item.sessionToken === token), "the saved session must be checked with the status API");
    assert.equal(await page.locator("#jb-chat-resume-panel").getAttribute("aria-label"), "Retomar conversación privada");
    assert.equal(await page.locator("#jb-chat-resume-panel a").innerText(), "Retomar chat");
    assert.equal(await page.locator("#jb-chat-resume-panel a").getAttribute("href"), origin + "/mensajes.html");
    assert.equal(await page.locator("#jb-chat-resume-panel a").evaluate(a => new URL(a.href).search), "",
      "access tokens must not be placed in the recovery URL");
    const storage = await page.evaluate(key => ({
      local: localStorage.getItem(key),
      session: sessionStorage.getItem(key),
      panelWidth: document.getElementById("jb-chat-resume-panel").getBoundingClientRect().width,
      viewportWidth: innerWidth
    }), SESSION_KEY);
    assert.equal(storage.local, token);
    assert.equal(storage.session, token);
    assert.ok(storage.panelWidth <= storage.viewportWidth, "resume control must fit on a mobile viewport");

    page.on("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Olvidar este dispositivo" }).click();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), SESSION_KEY), null);
    await page.waitForSelector("#jb-chat-resume-panel", { state: "detached" });
    await page.close();
  } finally {
    await browser.close();
  }
});

test("expired chat access is cleared and no dead return button is shown", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await openPage(browser, "expired", "c".repeat(64));
    await page.waitForFunction(key => localStorage.getItem(key) === null, SESSION_KEY, { timeout: 8000 });
    assert.equal(await page.locator("#jb-chat-resume-panel").count(), 0);
    await page.close();
  } finally {
    await browser.close();
  }
});

test("all catalog entry points load the persistent private-chat return control", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const [file, prefix] of [["index.html", "./"], ["tecnologia/index.html", "../"], ["perfumeria/index.html", "../"]]) {
    const html = await readFile(new URL("../" + file, import.meta.url), "utf8");
    assert.match(html, new RegExp('chat-return\\.js\\?v=20261029-resume1'));
    assert.match(html, new RegExp('chat-return\\.css\\?v=20261029-resume1'));
    assert.ok(html.includes(prefix + "chat-return.js"));
  }
});
