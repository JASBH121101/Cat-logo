import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { classifyAxeImpact, classifyRuntimeError, groupRepeatedFindings } from "./visual-audit-policy.mjs";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const OUTPUT_DIR = resolve(ROOT, "artifacts/visual-audit");
const REPORT_JSON = resolve(ROOT, "visual-audit-report.json");
const REPORT_MD = resolve(ROOT, "visual-audit-report.md");
const VIEWPORTS = [
  { name: "mobile-390", width: 390, height: 844, mobile: true },
  { name: "desktop-1365", width: 1365, height: 900, mobile: false },
  { name: "desktop-capture-1648", width: 1648, height: 925, mobile: false },
  { name: "desktop-fullhd-1920", width: 1920, height: 1080, mobile: false },
];
const THEMES = ["light", "dark"];
const PAGES = [
  { name: "technology", path: "/tecnologia/", shell: ".site-header", title: ".hero h1, h1", fixture: "technology" },
  { name: "perfumery", path: "/perfumeria/", shell: ".site-header", title: "h1", fixture: "perfumery" },
  { name: "admin", path: "/admin.html", shell: ".admin-header", title: ".provider-page-heading h1, h1", fixture: "admin" },
  { name: "private-chat", path: "/mensajes.html", shell: ".private-chat-header", title: "#private-chat-title", fixture: "chat" },
];
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff",
};

let server;
let origin;
let browser;
const observations = [];
const findings = [];
const runtimeErrors = [];
const networkFailures = [];
const axeFindings = [];
const axeViolationGroups = new Map();
const screenshots = [];
const journeyResults = [];

function severityForOverflow(px) {
  if (px >= 24) return "critical";
  if (px >= 8) return "high";
  if (px > 2) return "medium";
  return "info";
}
function diagnose({ severity, page, theme, viewport, element, message, evidence }) {
  const text = `${message || ""} ${evidence || ""}`.toLowerCase();
  if (/desbordamiento horizontal/.test(text)) {
    return {
      code: "LAYOUT_OVERFLOW",
      hypothesis: "Un hijo de grid/flex o un elemento con ancho mínimo fijo excede el ancho disponible.",
      confidence: 0.86,
      nextCheck: "Usar los selectores y límites del reporte para localizar el primer elemento cuyo rectángulo rebasa el viewport; inspeccionar min-width, width, padding y texto largo.",
      likelyFiles: page === "technology" ? ["technology-visual-refresh.css", "styles.css"] :
        page === "perfumery" ? ["perfumeria.css", "styles.css"] :
        page === "admin" ? ["admin-private-chat.css", "admin-workflow.css", "styles.css"] : ["private-chat.css"],
    };
  }
  if (/tarjeta de confianza|hero-trust-copy/.test(text)) {
    return {
      code: "NESTED_SELECTOR_COLLISION",
      hypothesis: "Una regla CSS amplia aplica a un wrapper de texto estilos pensados para un chip o etiqueta.",
      confidence: 0.95,
      nextCheck: "Comparar computedStyle del wrapper interior con su tarjeta; restringir la regla decorativa al hijo directo y volver a validar ambos temas.",
      likelyFiles: ["technology-visual-refresh.css", "tests/technology-gallery-layout.test.mjs", "tests/visual-audit.test.mjs"],
    };
  }
  if (/encabezado principal no visible/.test(text)) {
    return {
      code: "SHELL_VISIBILITY",
      hypothesis: "El selector no coincide con el HTML actual o una clase/estilo mantiene el encabezado oculto.",
      confidence: 0.82,
      nextCheck: "Inspeccionar DOM final, clases hidden, display/visibility y geometría del encabezado en el mismo viewport.",
      likelyFiles: ["admin.html", "mensajes.html", "tecnologia/index.html", "perfumeria/index.html"],
    };
  }
  if (/axe|wcag|contrast|button-name|label/.test(text)) {
    return {
      code: "ACCESSIBILITY_REVIEW",
      hypothesis: "El DOM puede carecer de un nombre accesible, etiqueta asociada o contraste suficiente.",
      confidence: 0.74,
      nextCheck: "Abrir el nodo exacto reportado; verificar nombre accesible, asociación label/control y contraste calculado antes de cambiar CSS.",
      likelyFiles: ["admin-accessibility.css", "admin-private-chat.css", "private-chat.css", "technology-visual-refresh.css", "perfumeria.css"],
    };
  }
  if (/error de javascript|runtime/.test(text)) {
    const likelyEnvironment = /fetch|network|failed to load|blockedbyclient|supabase|aborted/i.test(text);
    return {
      code: likelyEnvironment ? "RUNTIME_OR_BLOCKED_DEPENDENCY" : "RUNTIME_EXCEPTION",
      hypothesis: likelyEnvironment
        ? "El error podría depender de una API o recurso externo que esta prueba está bloqueando deliberadamente; hay que separarlo de un fallo de JavaScript real."
        : "Una excepción de ejecución puede haber detenido una parte del montaje o de los eventos.",
      confidence: likelyEnvironment ? 0.62 : 0.80,
      nextCheck: "Revisar primero el archivo y la primera línea de la excepción; repetir el escenario con dependencias simuladas y después confirmar el flujo conectado por separado.",
      likelyFiles: page === "admin" ? ["admin.js", "admin-provider.js"] :
        page === "private-chat" ? ["private-chat.js", "functions/api/private-chat.js"] : ["app.js", "perfumeria.js", "config.js"],
    };
  }
  return {
    code: "NEEDS_TRIAGE",
    hypothesis: "La evidencia no coincide con una firma conocida; no conviene aplicar una reparación automática.",
    confidence: 0.45,
    nextCheck: "Inspeccionar captura, selector, estilos calculados y traza completa. Crear primero una prueba mínima que reproduzca el comportamiento.",
    likelyFiles: [],
  };
}
function addFinding({ severity, page, theme, viewport, element, message, evidence, recommendation, blocking = false }) {
  const finding = { severity, page, theme, viewport, element, message, evidence, recommendation, blocking };
  finding.diagnosis = diagnose(finding);
  findings.push(finding);
}

async function runJourney(page, scenario, name, action) {
  try {
    const evidence = await action();
    journeyResults.push({ name, page: scenario.page, viewport: scenario.viewport, theme: scenario.theme, passed: true, evidence: evidence || "Acción completada" });
    console.log(`[JOURNEY PASS] ${scenario.page} :: ${name}`);
  } catch (error) {
    const evidence = error?.message || String(error);
    journeyResults.push({ name, page: scenario.page, viewport: scenario.viewport, theme: scenario.theme, passed: false, evidence });
    addFinding({
      severity: "critical", page: scenario.page, theme: scenario.theme, viewport: scenario.viewport,
      element: name, message: "Recorrido de interfaz no completado",
      evidence, recommendation: "Revisar que el control exista, tenga listener activo y mantenga el estado esperado; reproducirlo con el navegador y los errores de consola visibles.",
      blocking: true,
    });
    console.error(`[JOURNEY FAIL] ${scenario.page} :: ${name} :: ${evidence}`);
  }
}

function escMarkdown(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}
function fixtureScript(pageName) {
  return `
    (() => {
      const svg = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#d7deeb"/></svg>');
      if (${JSON.stringify(pageName)} === "technology") {
        const grid = document.querySelector("#product-grid");
        if (grid) grid.innerHTML = [
          ["Xiaomi Redmi Note 15 Pro Max 5G", "12 GB RAM / 512 GB", "$ 489"],
          ["Samsung Galaxy Ultra Gaming Edition", "16 GB RAM / 1 TB", "$ 1,090"]
        ].map(([name, capacity, price]) => '<article class="product-card"><div class="product-image"><img alt="" src="' + svg + '"></div><div class="product-card-content"><div class="product-card-badges"><span class="product-badge">DISPONIBLE</span></div><h3>' + name + '</h3><p class="product-card-capacity">' + capacity + '</p><div class="product-price-label">Precio</div><div class="product-price">' + price + '</div><div class="product-actions"><a class="buy-button product-view-button" href="#audit-fixture">Ver producto ↗</a></div></div></article>').join("");
      }
      if (${JSON.stringify(pageName)} === "technology") {
        // Exercise one-item desktop states in all tag showcases, not just the main catalog grid.
        const showcases = [
          ["featured-section", "featured-grid", "Productos exclusivos"],
          ["limited-edition-section", "limited-edition-grid", "Colección especial"],
          ["high-performance-section", "high-performance-grid", "Alto rendimiento"],
          ["quality-price-section", "quality-price-grid", "Calidad precio"],
          ["top-gaming-section", "top-gaming-grid", "Top Gaming"]
        ];
        for (const [sectionId, gridId, title] of showcases) {
          const section = document.getElementById(sectionId);
          const showcaseGrid = document.getElementById(gridId);
          if (!section || !showcaseGrid) continue;
          section.classList.remove("hidden");
          showcaseGrid.innerHTML = '<article class="product-card"><div class="product-image"><img alt="" src="' + svg + '"></div><div class="product-card-content"><div class="product-card-badges"><span class="product-badge">EDICIÓN ESPECIAL</span></div><h3>' + title + ' · Producto de prueba</h3><p class="product-card-capacity">12 GB RAM / 512 GB</p><div class="product-price-label">Precio desde</div><div class="product-price">US$ 489</div><div class="product-actions"><a class="buy-button product-view-button" href="#audit-fixture">Ver producto ↗</a></div></div></article>';
        }
      }
      if (${JSON.stringify(pageName)} === "perfumery") {
        const grid = document.querySelector("#product-grid-nicho");
        if (grid) grid.innerHTML = [
          ["Arabian Oud Signature Elixir", "Eau de Parfum · 100 ml", "$ 89"],
          ["Madrinas Cayo Odisea Collection", "Extrait de Parfum · 80 ml", "$ 112"]
        ].map(([name, meta, price]) => '<article class="product-card perfume-product-card"><div class="product-image perfume-product-image"><img alt="" src="' + svg + '"></div><div class="product-card-content perfume-product-card-content"><h3>' + name + '</h3><div class="perfume-product-meta">' + meta + '</div><div class="perfume-product-price">' + price + '</div><div class="product-actions"><a class="button perfume-view-button" href="#audit-fixture">Ver producto ↗</a></div></div></article>').join("");
      }
      if (${JSON.stringify(pageName)} === "admin") {
        // Synthetic authenticated-shell state for layout testing only; no login/API call is performed.
        document.body.classList.add("admin-dashboard-active");
        document.getElementById("login-panel")?.classList.add("hidden");
        document.getElementById("dashboard")?.classList.remove("hidden");
        document.querySelectorAll("[data-admin-panel]").forEach(panel => {
          panel.classList.toggle("hidden", panel.dataset.adminPanel !== "messages");
        });
        const thread = document.getElementById("private-chat-admin-thread");
        const selected = document.getElementById("private-chat-admin-selected");
        if (thread) thread.hidden = false;
        if (selected) selected.hidden = false;
        const messages = document.getElementById("private-chat-admin-messages");
        if (messages) messages.innerHTML = '<article class="private-chat-admin-message is-customer"><p>Hola, necesito registrar mi pedido y confirmar la configuración del equipo.</p><small>Cliente · ejemplo de prueba</small></article><article class="private-chat-admin-message is-admin"><p>Claro, te ayudo a verificar el producto antes de registrar el pedido.</p><small>Asesor · ejemplo de prueba</small></article>';
        const reply = document.getElementById("private-chat-admin-reply-form");
        if (reply) reply.hidden = false;
        const selectedCard = document.getElementById("private-chat-admin-selected");
        if (selectedCard) selectedCard.hidden = false;
        const title = document.getElementById("private-chat-admin-thread-title");
        if (title) title.textContent = "Consulta de prueba · JB TECH";
        const meta = document.getElementById("private-chat-admin-thread-meta");
        if (meta) meta.textContent = "Datos sintéticos · simulación visual";
        document.querySelectorAll(".private-chat-admin-security-note").forEach(el => el.hidden = false);
      }
      if (${JSON.stringify(pageName)} === "chat") {
        const app = document.getElementById("private-chat-app");
        if (app) app.hidden = false;
        for (const id of ["private-chat-choice-panel", "private-chat-consent-panel", "private-chat-thread", "private-chat-composer"]) {
          const element = document.getElementById(id);
          if (element) element.hidden = false;
        }
        const messages = document.getElementById("private-chat-messages");
        if (messages) messages.innerHTML = '<article class="private-chat-message is-assistant"><p>¡Hola! Este es un mensaje sintético para comprobar la lectura y el ajuste del chat.</p></article><article class="private-chat-message is-customer"><p>Quisiera confirmar el precio y la disponibilidad del producto.</p></article>';
        const loading = document.getElementById("private-chat-loading");
        if (loading) loading.hidden = true;
      }
    })();
  `;
}

test("visual audit measures responsive layouts in both themes and emits diagnostic evidence", { timeout: 180000 }, async t => {
  await mkdir(OUTPUT_DIR, { recursive: true });
  server = createServer(async (req, res) => {
    try {
      const requestPath = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
      const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
      const filePath = resolve(ROOT, relativePath);
      if (!(filePath === ROOT || filePath.startsWith(ROOT + sep))) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      const info = await stat(filePath).catch(() => null);
      const resolvedPath = info?.isDirectory() ? resolve(filePath, "index.html") : filePath;
      const body = await readFile(resolvedPath);
      res.writeHead(200, { "content-type": CONTENT_TYPES[extname(resolvedPath)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
    }
  });
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  const contexts = new Map();
  t.after(async () => {
    await Promise.all([...contexts.values()].map(context => context.close().catch(() => {})));
    await browser?.close();
    await new Promise(resolveClose => server?.close(resolveClose));
  });

  for (const site of PAGES) {
    for (const viewport of VIEWPORTS) {
      let context = contexts.get(viewport.name);
      if (!context) {
        context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
          isMobile: viewport.mobile,
          reducedMotion: "reduce",
        });
        contexts.set(viewport.name, context);
      }
      for (const theme of THEMES) {
        const page = await context.newPage();
        const pageErrors = [];
        page.on("pageerror", error => pageErrors.push({
          source: "pageerror", message: error.message, stack: error.stack || "",
        }));
        page.on("console", msg => {
          if (msg.type() === "error" && /uncaught|syntaxerror|referenceerror|typeerror/i.test(msg.text())) {
            pageErrors.push({ source: "console", message: msg.text(), stack: "" });
          }
        });
        page.on("requestfailed", request => {
          let requestedUrl;
          try {
            requestedUrl = new URL(request.url());
          } catch {
            return;
          }
          if (requestedUrl.protocol === "data:" || requestedUrl.protocol === "blob:") return;
          const externalDependency = requestedUrl.origin !== origin;
          const errorText = request.failure()?.errorText || "Unknown network error";
          const blockedByPolicy = externalDependency && /ERR_BLOCKED_BY_CLIENT|blocked by client/i.test(errorText);
          const resourceType = request.resourceType();
          const classification = classifyRuntimeError(errorText, {
            source: "network-request", externalDependency, blockedByPolicy, resourceType,
          });
          const failure = {
            page: site.name, theme, viewport: viewport.name, host: requestedUrl.host,
            resourceType, error: errorText, blockedByPolicy, ...classification,
          };
          networkFailures.push(failure);
          if (classification.blocking) {
            addFinding({
              severity: classification.severity, page: site.name, theme, viewport: viewport.name,
              element: "resource:" + requestedUrl.host + "/" + resourceType,
              message: "Fallo de carga de recurso esencial",
              evidence: requestedUrl.host + " (" + resourceType + "): " + errorText,
              recommendation: classification.rationale,
              blocking: true,
            });
          }
        });
        // Keep the audit deterministic and read-only: local first-party assets are allowed.
        // Remote APIs and non-allowlisted hosts are blocked; cdn.jsdelivr.net is the only
        // explicitly allowed external host needed to initialize the UI module.
        await page.route("**/*", route => {
          const url = new URL(route.request().url());
          if (url.origin === origin || url.protocol === "data:" || url.protocol === "blob:") return route.continue();
          // Load only the pinned/known CDN module needed to initialize the UI.
          // Database/API hosts remain blocked so tests cannot mutate customer data.
          if (url.hostname === "cdn.jsdelivr.net") return route.continue();
          return route.abort("blockedbyclient");
        });
        const gotoResponse = await page.goto(origin + site.path, { waitUntil: "domcontentloaded", timeout: 15000 });
        assert.ok(gotoResponse?.ok(), `${site.path} must serve successfully in the local browser fixture`);
        await page.evaluate(themeValue => {
          document.documentElement.setAttribute("data-theme", themeValue);
          document.body.dataset.visualAuditFixture = "true";
        }, theme);
        await page.addScriptTag({ content: fixtureScript(site.fixture) });
        await page.waitForTimeout(280);
        // Re-assert the intended theme after page scripts initialize from shared localStorage.
        // Keep toggle metadata in sync so a journey always changes to the opposite theme.
        await page.evaluate(themeValue => {
          document.documentElement.setAttribute("data-theme", themeValue);
          try { localStorage.setItem("ct-catalog-theme", themeValue); } catch {}
          const toggle = document.getElementById("private-chat-theme-toggle");
          if (toggle) {
            const nextTheme = themeValue === "dark" ? "light" : "dark";
            toggle.dataset.nextTheme = nextTheme;
            toggle.setAttribute("aria-pressed", String(themeValue === "dark"));
            toggle.setAttribute("aria-label", nextTheme === "dark" ? "Cambiar al tema oscuro" : "Cambiar al tema claro");
            toggle.setAttribute("title", nextTheme === "dark" ? "Cambiar al tema oscuro" : "Cambiar al tema claro");
            toggle.textContent = themeValue === "dark" ? "☀" : "☾";
          }
        }, theme);

        const snapshot = await page.evaluate(({ pageName, viewportName, themeName }) => {
          const rectData = element => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
              left: Math.round(rect.left), top: Math.round(rect.top),
              right: Math.round(rect.right), bottom: Math.round(rect.bottom),
              width: Math.round(rect.width), height: Math.round(rect.height),
              display: style.display, visibility: style.visibility,
              color: style.color, background: style.backgroundColor,
              fontSize: style.fontSize, lineHeight: style.lineHeight,
              overflowX: style.overflowX, overflowY: style.overflowY,
              padding: style.padding, borderWidth: style.borderTopWidth, radius: style.borderTopLeftRadius,
            };
          };
          const isVisible = el => {
            const s = getComputedStyle(el), r = el.getBoundingClientRect();
            return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
          };
          const root = document.documentElement;
          const docWidth = Math.max(root.scrollWidth, document.body.scrollWidth);
          const viewportWidth = window.innerWidth;
          const shellSelector = pageName === "technology" || pageName === "perfumery"
            ? ".site-header" : pageName === "admin" ? ".admin-header" : ".private-chat-header";
          const shell = document.querySelector(shellSelector);
          const title = document.querySelector(pageName === "technology" ? ".hero h1" : pageName === "admin" ? "#admin-section-messages h1, .dashboard-top h1, h1" : "h1");
          const visibleGrids = [...document.querySelectorAll(".product-grid, .featured-grid, .private-chat-admin-layout, .private-chat-card")].filter(isVisible);
          const products = [...document.querySelectorAll("#product-grid .product-card, #product-grid-nicho .product-card")].filter(isVisible);
          const trustCards = [...document.querySelectorAll(".hero-trust-item")].filter(isVisible).map(card => {
            const copy = card.querySelector(".hero-trust-copy");
            return { card: rectData(card), copy: copy ? rectData(copy) : null, text: copy?.innerText || "" };
          });
          const showcaseLayouts = pageName === "technology"
            ? [...document.querySelectorAll(".featured-grid")].filter(isVisible).map(grid => {
                const gridRect = grid.getBoundingClientRect();
                const section = grid.closest("section") || grid.parentElement || grid;
                const sectionRect = section.getBoundingClientRect();
                const cards = [...grid.querySelectorAll(":scope > .product-card")].filter(isVisible);
                const cardRect = cards.length === 1 ? cards[0].getBoundingClientRect() : null;
                // Measure against the visible section, not just the grid: a left-pinned card can look centered in its own narrow track.
                const sectionCenter = (sectionRect.left + sectionRect.right) / 2;
                const cardCenter = cardRect ? (cardRect.left + cardRect.right) / 2 : null;
                return {
                  id: grid.id, left: Math.round(gridRect.left), right: Math.round(gridRect.right),
                  width: Math.round(gridRect.width),
                  sectionLeft: Math.round(sectionRect.left), sectionRight: Math.round(sectionRect.right),
                  sectionWidth: Math.round(sectionRect.width), cardCount: cards.length,
                  cardLeft: cardRect ? Math.round(cardRect.left) : null,
                  cardRight: cardRect ? Math.round(cardRect.right) : null,
                  cardWidth: cardRect ? Math.round(cardRect.width) : null,
                  centerOffset: cardCenter === null ? null : Math.round(Math.abs(cardCenter - sectionCenter))
                };
              })
            : [];
          const keyText = [...document.querySelectorAll("h1, h2, h3, .hero-trust-copy, .private-chat-privacy, .private-chat-footer-note, .private-chat-admin-security-note, button, .buy-button")]
            .filter(isVisible).slice(0, 70).map(el => ({
              selector: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""),
              text: (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 100),
              ...rectData(el),
              clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight,
            }));
          return {
            page: pageName, theme: themeName, viewport: viewportName, viewportWidth,
            documentWidth: docWidth, horizontalOverflow: Math.max(0, docWidth - viewportWidth),
            shell: shell && isVisible(shell) ? rectData(shell) : null,
            title: title && isVisible(title) ? rectData(title) : null,
            visibleMajorRegions: visibleGrids.length,
            productCards: products.length,
            trustCards,
            showcaseLayouts,
            keyText,
          };
        }, { pageName: site.name, viewportName: viewport.name, themeName: theme });

        observations.push(snapshot);
        for (const runtimeError of pageErrors) {
          const error = runtimeError.message || String(runtimeError);
          const classification = classifyRuntimeError(error, {
            source: runtimeError.source || "pageerror",
            stack: runtimeError.stack || "",
          });
          runtimeErrors.push({
            page: site.name, theme, viewport: viewport.name,
            source: runtimeError.source || "pageerror", error,
            stack: runtimeError.stack || "", ...classification,
          });
          addFinding({
            severity: classification.severity, page: site.name, theme, viewport: viewport.name, element: "runtime",
            message: classification.blocking
              ? "Excepción JavaScript no controlada"
              : classification.category === "console_diagnostic"
                ? "Diagnóstico de consola no confirmado como excepción"
                : "Error de dependencia/red en la auditoría aislada",
            evidence: error,
            recommendation: classification.rationale + " " +
              (classification.blocking
                ? "Localizar el primer archivo y corregir la excepción antes de publicar."
                : "Conservar el diagnóstico y confirmar por separado cualquier flujo conectado que dependa de este servicio."),
            blocking: classification.blocking,
          });
        }
        if (snapshot.horizontalOverflow >= 8) {
          addFinding({
            severity: severityForOverflow(snapshot.horizontalOverflow), page: site.name, theme, viewport: viewport.name, element: "document",
            message: viewport.mobile ? "Desbordamiento horizontal en móvil" : "Desbordamiento horizontal en escritorio",
            evidence: `Documento ${snapshot.documentWidth}px para viewport ${snapshot.viewportWidth}px; exceso ${snapshot.horizontalOverflow}px.`,
            recommendation: "Inspeccionar los elementos que exceden el viewport; corregir anchuras mínimas, padding, grid/flex y texto largo. No ocultar el problema con overflow-x:hidden.",
            blocking: snapshot.horizontalOverflow >= 24,
          });
        }
        if (site.name === "technology" && !viewport.mobile) {
          for (const layout of snapshot.showcaseLayouts) {
            if (layout.cardCount === 1 && (layout.centerOffset > 10 || layout.cardWidth > 680)) {
              const tooWide = layout.cardWidth > 680;
              addFinding({
                severity: "high", page: site.name, theme, viewport: viewport.name,
                element: "#" + layout.id,
                message: tooWide
                  ? "Tarjeta única de sección destacada demasiado ancha en escritorio"
                  : "Tarjeta única de sección destacada descentrada en escritorio",
                evidence: `Ancho de tarjeta: ${layout.cardWidth}px; desplazamiento del centro: ${layout.centerOffset}px; ancho del grid: ${layout.width}px.`,
                recommendation: "Limitar la tarjeta individual a un ancho de lectura equilibrado y centrarla; conservar el grid habitual cuando hay varias tarjetas.",
                blocking: true,
              });
            }
          }
        }
        if (!snapshot.shell || snapshot.shell.height <= 0) {
          addFinding({
            severity: "critical", page: site.name, theme, viewport: viewport.name, element: "header",
            message: "Encabezado principal no visible",
            evidence: "El selector de encabezado esperado no produjo un rectángulo visible.",
            recommendation: "Revisar la estructura HTML, la visibilidad condicional y las reglas de tema.",
            blocking: true,
          });
        }
        if (site.name === "technology" && viewport.mobile) {
          for (const card of snapshot.trustCards) {
            const copy = card.copy;
            const outer = card.card;
            if (!copy || copy.right > outer.right - 3 || copy.left < outer.left - 1 ||
                copy.padding !== "0px" || copy.borderWidth !== "0px" ||
                copy.radius !== "0px" || copy.background !== "rgba(0, 0, 0, 0)") {
              addFinding({
                severity: "critical", page: site.name, theme, viewport: viewport.name, element: ".hero-trust-copy",
                message: "Texto interno de tarjeta de confianza no respeta la geometría de la tarjeta",
                evidence: `Tarjeta derecha=${outer.right}px; texto derecha=${copy?.right ?? "ausente"}px; padding=${copy?.padding ?? "ausente"}; borde=${copy?.borderWidth ?? "ausente"}; radio=${copy?.radius ?? "ausente"}.`,
                recommendation: "Limitar estilos de chip al selector hijo directo de la tarjeta y normalizar el wrapper de texto; revisar ambas paletas.",
                blocking: true,
              });
            }
          }
          if (snapshot.trustCards.length !== 4) {
            addFinding({
              severity: "high", page: site.name, theme, viewport: viewport.name, element: ".hero-trust",
              message: "La sección de confianza no contiene exactamente cuatro tarjetas visibles",
              evidence: `Tarjetas detectadas: ${snapshot.trustCards.length}.`,
              recommendation: "Comprobar estructura del hero y reglas responsive de la rejilla.",
            });
          }
        }

        // Axe is a diagnostic signal here, not a false pass/fail: report all violations
        // and only gate layout/runtime regressions whose measurements are deterministic.
        if (viewport.mobile) {
          try {
            const axe = await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
              .analyze();
            for (const violation of axe.violations) {
              const targets = violation.nodes
                .map(node => (node.target || []).join(" "))
                .filter(Boolean)
                .sort();
              const fingerprint = `${site.name}|${violation.id}|${targets.join("|")}`;
              const existingGroup = axeViolationGroups.get(fingerprint);
              if (existingGroup) {
                existingGroup.finding.occurrences += 1;
                if (!existingGroup.finding.themes.includes(theme)) existingGroup.finding.themes.push(theme);
                if (!existingGroup.finding.viewports.includes(viewport.name)) existingGroup.finding.viewports.push(viewport.name);
                existingGroup.reportFinding.occurrences = existingGroup.finding.occurrences;
                existingGroup.reportFinding.themes = existingGroup.finding.themes;
                existingGroup.reportFinding.viewports = existingGroup.finding.viewports;
                continue;
              }
              const impactClassification = classifyAxeImpact(violation.impact);
              const axeFinding = {
                severity: impactClassification.severity,
                page: site.name, theme, viewport: viewport.name, rule: violation.id, impact: violation.impact,
                themes: [theme], viewports: [viewport.name], occurrences: 1, targets,
                message: violation.help, evidence: `${violation.nodes.length} nodo(s): ${String(violation.nodes[0]?.target?.join(" ") || "selector no disponible")}`,
                recommendation: violation.description + " Referencia: " + violation.helpUrl,
              };
              axeFinding.diagnosis = diagnose(axeFinding);
              const reportFinding = {
                ...axeFinding, element: axeFinding.rule, blocking: impactClassification.blocking,
              };
              axeViolationGroups.set(fingerprint, { finding: axeFinding, reportFinding });
              axeFindings.push(axeFinding);
              findings.push(reportFinding);
            }
          } catch (error) {
            addFinding({
              severity: "medium", page: site.name, theme, viewport: viewport.name, element: "axe",
              message: "Auditoría de accesibilidad no pudo finalizar", evidence: error.message,
              recommendation: "Comprobar que el DOM estaba estable y revisar los errores de la herramienta antes de interpretar el resultado.",
            });
          }
        }

        const screenshotName = `${site.name}--${viewport.name}--${theme}.png`;
        const screenshotPath = resolve(OUTPUT_DIR, screenshotName);
        await page.screenshot({ path: screenshotPath, fullPage: false, animations: "disabled" });
        screenshots.push(screenshotName);

        // Smoke-test real UI events while the APIs are blocked/read-only.
        // These tests exercise controls and state changes, not order creation in Supabase.
        if (viewport.mobile && theme === "light") {
          const scenario = { page: site.name, viewport: viewport.name, theme };
          if (site.name === "technology") {
            await runJourney(page, scenario, "technology-brand-filter-keyboard-and-toggle", async () => {
              const control = page.locator("#brand-filter-toggle");
              const menu = page.locator("#brand-filter-menu");
              const search = page.locator("#brand-filter-search");
              assert.equal(await control.count(), 1, "technology brand-filter button must exist");
              await control.click();
              assert.equal(await control.getAttribute("aria-expanded"), "true");
              assert.equal(await menu.evaluate(el => el.hidden), false);
              assert.equal(await page.evaluate(() => document.activeElement?.id), "brand-filter-search",
                "opening the filter must move focus to its search field");
              await page.keyboard.press("Escape");
              assert.equal(await control.getAttribute("aria-expanded"), "false");
              assert.equal(await menu.evaluate(el => el.hidden), true);
              assert.equal(await page.evaluate(() => document.activeElement?.id), "brand-filter-toggle",
                "Escape must close the filter and return focus to its trigger");
              await control.click();
              await search.fill("samsung");
              assert.equal(await search.inputValue(), "samsung");
              await control.click();
              assert.equal(await control.getAttribute("aria-expanded"), "false");
              return "El filtro abre con foco accesible, Escape cierra y devuelve el foco; el buscador acepta texto y el botón puede cerrarlo.";
            });
            await runJourney(page, scenario, "technology-theme-toggle", async () => {
              const toggle = page.locator("[data-theme-toggle]");
              await toggle.waitFor({ state: "visible", timeout: 3000 });
              const before = await page.locator("html").getAttribute("data-theme");
              await toggle.click();
              await page.waitForFunction(previous => document.documentElement.getAttribute("data-theme") !== previous, before, { timeout: 3000 });
              return "El control cambia el tema aplicado al documento.";
            });
          } else if (site.name === "perfumery") {
            await runJourney(page, scenario, "perfumery-brand-filter-keyboard-and-toggle", async () => {
              const control = page.locator("#perfume-brand-filter-toggle");
              const menu = page.locator("#perfume-brand-filter-menu");
              const search = page.locator("#perfume-brand-filter-search");
              assert.equal(await control.count(), 1, "perfume brand-filter button must exist");
              await control.click();
              assert.equal(await control.getAttribute("aria-expanded"), "true");
              assert.equal(await menu.evaluate(el => el.hidden), false);
              assert.equal(await page.evaluate(() => document.activeElement?.id), "perfume-brand-filter-search",
                "opening the filter must move focus to its search field");
              await page.keyboard.press("Escape");
              assert.equal(await control.getAttribute("aria-expanded"), "false");
              assert.equal(await menu.evaluate(el => el.hidden), true);
              assert.equal(await page.evaluate(() => document.activeElement?.id), "perfume-brand-filter-toggle",
                "Escape must close the filter and return focus to its trigger");
              await control.click();
              await search.fill("arab");
              assert.equal(await search.inputValue(), "arab");
              await control.click();
              assert.equal(await control.getAttribute("aria-expanded"), "false");
              return "El filtro abre con foco accesible, Escape cierra y devuelve el foco; el buscador acepta texto y el botón puede cerrarlo.";
            });
            await runJourney(page, scenario, "perfumery-theme-toggle", async () => {
              const toggle = page.locator("[data-theme-toggle]");
              await toggle.waitFor({ state: "visible", timeout: 3000 });
              const before = await page.locator("html").getAttribute("data-theme");
              await toggle.click();
              await page.waitForFunction(previous => document.documentElement.getAttribute("data-theme") !== previous, before, { timeout: 3000 });
              return "El control cambia el tema aplicado al documento.";
            });
          } else if (site.name === "admin") {
            await runJourney(page, scenario, "admin-navigation-to-messages", async () => {
              const control = page.locator('[data-admin-section="messages"]').first();
              assert.equal(await control.count(), 1, "navigation entry for private messaging must exist");
              await control.evaluate(el => el.click());
              const panel = page.locator('#admin-section-messages');
              assert.equal(await panel.evaluate(el => el.classList.contains("hidden")), false);
              assert.equal(await page.locator("#dashboard").evaluate(el => el.classList.contains("admin-section-focused")), true);
              return "La navegación muestra Mensajería y deja el panel en modo enfocado.";
            });
            await runJourney(page, scenario, "admin-mobile-sidebar-escape-and-backdrop", async () => {
              const toggle = page.locator("#admin-menu-toggle");
              const backdrop = page.locator("#admin-sidebar-backdrop");
              assert.equal(await toggle.count(), 1, "admin mobile sidebar toggle must exist");
              await toggle.click();
              assert.equal(await toggle.getAttribute("aria-expanded"), "true");
              assert.equal(await page.locator("body").evaluate(el => el.classList.contains("admin-sidebar-open")), true);
              assert.equal(await backdrop.evaluate(el => el.hidden), false);
              await page.keyboard.press("Escape");
              assert.equal(await toggle.getAttribute("aria-expanded"), "false");
              assert.equal(await page.locator("body").evaluate(el => el.classList.contains("admin-sidebar-open")), false);
              assert.equal(await backdrop.evaluate(el => el.hidden), true);
              await toggle.click();
              const outsideX = await page.evaluate(() => {
                const sidebar = document.getElementById("admin-sidebar");
                const rect = sidebar.getBoundingClientRect();
                return Math.max(2, Math.min(window.innerWidth - 2, Math.ceil(rect.right + 12)));
              });
              assert.ok(outsideX < 390, "test viewport must expose an area outside the mobile sidebar");
              await page.mouse.click(outsideX, 400);
              assert.equal(await toggle.getAttribute("aria-expanded"), "false");
              assert.equal(await backdrop.evaluate(el => el.hidden), true);
              return "El menú móvil sincroniza aria-expanded y bloqueo de scroll; Escape y un clic real fuera del cajón cierran el panel.";
            });
          } else if (site.name === "private-chat") {
            await runJourney(page, scenario, "private-chat-theme-toggle", async () => {
              const toggle = page.locator("#private-chat-theme-toggle");
              assert.equal(await toggle.count(), 1, "chat theme control must exist");
              const before = await page.locator("html").getAttribute("data-theme");
              await toggle.click();
              await page.waitForFunction(previous => document.documentElement.getAttribute("data-theme") !== previous, before, { timeout: 3000 });
              assert.notEqual(await toggle.getAttribute("aria-pressed"), null);
              return "El chat cambia de tema y mantiene el estado accesible aria-pressed.";
            });
            await runJourney(page, scenario, "private-chat-composer-input-behavior", async () => {
              const form = page.locator("#private-chat-composer");
              const input = page.locator("#private-chat-input");
              const send = page.locator("#private-chat-send");
              assert.equal(await form.evaluate(el => el.hidden), false, "fixture must expose the synthetic composer");
              assert.equal(await send.getAttribute("type"), "submit");
              assert.equal(await input.getAttribute("maxlength"), "1200");
              const message = "Mensaje sintético para probar el campo de respuesta.";
              await input.fill(message);
              assert.equal(await input.inputValue(), message);
              const styleHeight = await input.evaluate(el => el.style.height);
              assert.match(styleHeight, /^\d+(?:\.\d+)?px$/, "textarea should update its height on input");
              await input.fill("");
              assert.equal(await input.inputValue(), "");
              return "El compositor acepta y limpia texto de prueba, respeta maxlength y ajusta la altura sin enviar ninguna solicitud.";
            });
          }
        }
        await page.close();
      }
    }
  }

  const rank = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  findings.sort((a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0));
  const blockingFindings = findings.filter(item => item.blocking);
  const groupedFindings = groupRepeatedFindings(findings);
  const uniqueBlockingFindings = groupedFindings.filter(item => item.blocking);
  const groupedFindingOccurrences = groupedFindings.reduce((total, item) => total + item.occurrences, 0);
  const result = {
    generatedAt: new Date().toISOString(),
    matrix: { pages: PAGES.map(p => p.name), viewports: VIEWPORTS, themes: THEMES, combinations: observations.length },
    summary: {
      scenarios: observations.length, screenshotCount: screenshots.length,
      blockingFindings: blockingFindings.length, findings: findings.length,
      uniqueFindings: groupedFindings.length,
      uniqueBlockingFindings: uniqueBlockingFindings.length,
      groupedFindingOccurrences,
      runtimeErrors: runtimeErrors.length,
      blockingRuntimeErrors: runtimeErrors.filter(error => error.blocking).length,
      networkFailures: networkFailures.length,
      blockedExternalRequests: networkFailures.filter(failure => failure.blockedByPolicy).length,
      blockingResourceFailures: networkFailures.filter(failure => failure.blocking).length,
      journeyFailures: journeyResults.filter(journey => !journey.passed).length,
      axeViolations: axeFindings.length,
      axeViolationOccurrences: axeFindings.reduce((total, finding) => total + finding.occurrences, 0),
      blockingAxeViolations: axeFindings.filter(finding => classifyAxeImpact(finding.impact).blocking).length,
    },
    observations, findings, groupedFindings, axeFindings, runtimeErrors, networkFailures, screenshots, journeyResults,
    policy: {
      remoteApisReached: false,
      allowedExternalHosts: ["cdn.jsdelivr.net"],
      externalRequestsBlockedByPolicy: networkFailures.some(failure => failure.blockedByPolicy),
      blockingRule: "Uncaught application JavaScript exceptions, confirmed uncaught/syntax errors in the console, first-party resource failures, failed essential external document/script/stylesheet loads, critical/serious Axe violations, failed UI journeys, missing headers, technology trust-card geometry regressions, and horizontal overflow >=24px block CI. Requests blocked explicitly by the isolated test policy are reported separately and do not block.",
      note: "Local deterministic fixture. The browser route policy allows local assets and cdn.jsdelivr.net, and blocks Supabase plus other non-allowlisted hosts before a request reaches them. No Supabase session is created and no real data is mutated. This does not prove live production network behavior. An exception that says 'Failed to fetch' still blocks if it is an uncaught pageerror; expected blocked network requests are classified from requestfailed events instead.",
    },
  };
  await writeFile(REPORT_JSON, JSON.stringify(result, null, 2), "utf8");
  const md = [
    "# JB Collections — informe de auditoría visual",
    "",
    `- Escenarios: ${result.summary.scenarios} (${PAGES.length} páginas × ${VIEWPORTS.length} tamaños × ${THEMES.length} temas)`,
    `- Capturas generadas: ${screenshots.length}`,
    `- Recorridos de interfaz: ${journeyResults.filter(j => j.passed).length}/${journeyResults.length}; fallos: ${result.summary.journeyFailures}`,
    `- Hallazgos bloqueantes: ${blockingFindings.length}`,
    `- Hallazgos adicionales (ocurrencias): ${findings.length}`,
    `- Hallazgos únicos agrupados: ${groupedFindings.length}; bloqueantes únicos: ${uniqueBlockingFindings.length}; ocurrencias agrupadas: ${groupedFindingOccurrences}`,
    `- Errores JS: ${runtimeErrors.length}; bloqueantes: ${result.summary.blockingRuntimeErrors}`,
    `- Solicitudes fallidas: ${result.summary.networkFailures}; bloqueadas intencionadamente: ${result.summary.blockedExternalRequests}; recursos esenciales bloqueantes: ${result.summary.blockingResourceFailures}`,
    `- Violaciones Axe únicas detectadas en móvil: ${axeFindings.length}; ocurrencias por tema/escenario: ${result.summary.axeViolationOccurrences}; críticas/serias bloqueantes: ${result.summary.blockingAxeViolations}`,
    "",
    "## Hallazgos agrupados por causa",
    "",
    ...(groupedFindings.length ? groupedFindings.map((f, i) => `${i + 1}. **[${String(f.severity || "info").toUpperCase()}] ${f.page || "página"} / ${f.rule || f.code || f.category || f.element || "hallazgo"}** — ${f.message || f.evidence || "Sin descripción"}\n   - Ocurrencias: ${f.occurrences}; escenarios: ${f.scenarios.join(", ") || "no especificados"}\n   - Bloqueante: ${f.blocking ? "sí" : "no"}; confianza orientativa: ${Math.round((Number(f.confidence) || Number(f.diagnosis?.confidence) || 0) * 100)}%`) : ["No hay hallazgos agrupables."]),
    "",
    "## Hallazgos ordenados por gravedad",
    "",
...(findings.length ? findings.map((f, i) => `${i + 1}. **[${f.severity.toUpperCase()}] ${f.page} / ${f.theme} / ${f.viewport}** — ${f.message}\n   - Evidencia: ${escMarkdown(f.evidence)}\n   - Diagnóstico (${Math.round((f.diagnosis?.confidence || 0) * 100)}%): ${f.diagnosis?.hypothesis || "Sin hipótesis"}\n   - Siguiente verificación: ${f.diagnosis?.nextCheck || "Revisión manual"}\n   - Recomendación: ${escMarkdown(f.recommendation)}`) : ["No se activaron las reglas de diagnóstico configuradas. Esto no equivale a probar flujos de negocio autenticados."]),
    "",
    "## Resumen del diagnóstico", "",
    "- El sistema asigna códigos de causa probable, confianza orientativa, archivos candidatos y un siguiente paso de verificación.",
    "- La confianza es una heurística basada en la evidencia, no una probabilidad estadística ni una reparación automática.",
    "- Los hallazgos de accesibilidad son señales de revisión; no se corrigen ni se ocultan automáticamente.",
    "", "## Geometría observada",
    "",
    "| Página | Tema | Viewport | Ancho doc. | Exceso horizontal | Tarjetas producto |",
    "|---|---|---|---:|---:|---:|",
    ...observations.map(o => `| ${o.page} | ${o.theme} | ${o.viewport} | ${o.documentWidth}px | ${o.horizontalOverflow}px | ${o.productCards} |`),
    "",
    "## Recorridos de interfaz", "",
    ...(journeyResults.length ? journeyResults.map(j => `- ${j.passed ? "PASS" : "FAIL"} — ${j.page} / ${j.name}: ${escMarkdown(j.evidence)}`) : ["No se ejecutaron recorridos."]),
    "", "## Capturas",
    "",
    ...screenshots.map(file => `- ` + file),
    "",
    "## Alcance y límites",
    "",
    "- Todas las páginas se sirven desde una copia estática local; la prueba inserta productos y mensajes sintéticos para revisar geometría representativa.",
    "- La política permite recursos locales y el host cdn.jsdelivr.net; las peticiones a Supabase y a otros hosts externos no permitidos se abortan. No se autentica a un usuario ni se modifica Supabase.",
    "- Axe se usa como detector WCAG. Las violaciones críticas/serias bloquean CI; las moderadas/menores permanecen como diagnósticos revisables. El mismo hallazgo por regla y selectores se agrupa entre temas, conservando sus ocurrencias.",
    "- Los recursos externos bloqueados deliberadamente por la política de aislamiento se separan de los fallos de recursos esenciales; los errores de red no convierten automáticamente una excepción JavaScript no controlada en un falso positivo.",
    "- La puerta de bloqueo se aplica a regresiones geométricas deterministas especificadas en este test. La validación real de compras y de notificaciones necesita pruebas de integración separadas.",
    "",
  ].join("\n");
  await writeFile(REPORT_MD, md, "utf8");

  console.log(`VISUAL AUDIT: ${result.summary.scenarios} escenarios, ${screenshots.length} capturas, ${blockingFindings.length} bloqueantes, ${findings.length} hallazgos, ${axeFindings.length} violaciones Axe.`);
  console.log(`Informe: visual-audit-report.md; JSON: visual-audit-report.json; capturas: ${OUTPUT_DIR}`);
  for (const finding of findings.slice(0, 35)) {
    console.log(`[${finding.severity.toUpperCase()}] ${finding.page} / ${finding.theme} / ${finding.viewport} — ${finding.message} :: ${finding.evidence}`);
  }
  assert.equal(observations.length, PAGES.length * VIEWPORTS.length * THEMES.length, "each page must be measured in every viewport/theme combination");
  assert.equal(screenshots.length, observations.length, "every visual scenario must produce screenshot evidence");
  assert.equal(result.summary.blockingAxeViolations, 0, "critical/serious Axe violations block CI; see visual-audit-report.md");
  assert.equal(blockingFindings.length, 0, "critical deterministic layout/runtime/resource regressions block CI; see visual-audit-report.md");
});
