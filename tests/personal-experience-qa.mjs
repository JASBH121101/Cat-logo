import assert from "node:assert/strict";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { PERSONAL_EXPERIENCE_PROFILE } from "./personal-experience-qa-profile.mjs";

const BASE_URL = new URL(process.env.EXPERIENCE_AUDIT_URL || PERSONAL_EXPERIENCE_PROFILE.defaultUrl);
if (BASE_URL.protocol !== "https:" || BASE_URL.hostname !== "jasbh121101.github.io" || BASE_URL.pathname !== "/Declaraci-n/") throw new Error("Experience audit is restricted to the canonical HTTPS Declaraci-n GitHub Pages URL.");
const OUT_DIR = resolve("artifacts/production-visual-audit");
const results = [];
const journeys = [];
const findings = [];
const runtimeErrors = [];
const blockedWrites = [];
const axeGroups = new Map();
let axeScanCount = 0;
let browser;

function safeText(value, max = 700) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}
function filename(state, viewport) {
  return `experience--${state}--${viewport}.png`;
}
async function recordJourney(viewport, name, action) {
  try {
    await action();
    journeys.push({ viewport: viewport.name, name, passed: true, evidence: "La acción terminó y el estado esperado fue verificado." });
  } catch (error) {
    journeys.push({ viewport: viewport.name, name, passed: false, evidence: safeText(error?.message || error) });
  }
}
async function assertActiveScreen(page, id) {
  await page.locator(`#${id}.active`).waitFor({ state: "visible", timeout: 7000 });
  const activeCount = await page.locator(".screen.active").count();
  assert.equal(activeCount, 1, "Debe existir exactamente una pantalla activa.");
}
async function collectMetrics(page) {
  return page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 &&
        rect.width > 0 && rect.height > 0;
    };
    const root = document.documentElement;
    const body = document.body;
    const width = Math.max(root.scrollWidth, body.scrollWidth);
    const viewportWidth = innerWidth;
    const active = document.querySelector(".screen.active");
    const controls = [...document.querySelectorAll(".screen.active button,.screen.active a,[role=button]")].filter(visible);
    const images = [...document.querySelectorAll(".screen.active img")].filter(visible);
    const labels = element => (
      element.getAttribute("aria-label") || element.innerText || element.textContent ||
      element.getAttribute("title") || element.querySelector("img")?.alt || ""
    ).replace(/\s+/g, " ").trim();
    return {
      title: document.title,
      activeScreen: active?.id || null,
      viewport: { width: viewportWidth, height: innerHeight },
      document: { width, height: Math.max(root.scrollHeight, body.scrollHeight) },
      horizontalOverflow: Math.max(0, width - viewportWidth),
      activeText: (active?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 2800),
      controls: controls.map(element => {
        const rect = element.getBoundingClientRect();
        return { label: labels(element).slice(0, 150), width: Math.round(rect.width), height: Math.round(rect.height), tag: element.tagName.toLowerCase() };
      }),
      smallTouchTargets: controls.filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width < 36 || rect.height < 36;
      }).length,
      images: images.map(image => ({
        alt: image.getAttribute("alt"),
        loaded: image.complete && image.naturalWidth > 0,
        naturalWidth: image.naturalWidth || 0,
        naturalHeight: image.naturalHeight || 0,
      })),
      heading: active?.querySelector("h1,h2")?.innerText?.trim() || null,
    };
  });
}
async function capture(page, viewport, state, screenId) {
  await assertActiveScreen(page, screenId);
  await page.waitForTimeout(180);
  const metrics = await collectMetrics(page);
  const shot = filename(state, viewport.name);
  await page.screenshot({ path: resolve(OUT_DIR, shot), fullPage: true, animations: "disabled" });
  let axeViolations = [];
  try {
    const axe = await new AxeBuilder({ page }).analyze();
    axeScanCount += 1;
    axeViolations = axe.violations;
    for (const violation of axe.violations) {
      const current = axeGroups.get(violation.id) || {
        id: violation.id, impact: violation.impact || "minor", description: safeText(violation.description, 300),
        help: safeText(violation.help, 300), helpUrl: violation.helpUrl || "", occurrences: 0,
        affectedNodes: new Set(),
      };
      current.occurrences += 1;
      for (const node of violation.nodes || []) {
        const selector = (node.target || []).join(", ");
        current.affectedNodes.add(selector || safeText(node.html, 180));
      }
      axeGroups.set(violation.id, current);
    }
  } catch (error) {
    runtimeErrors.push({ viewport: viewport.name, type: "axe-scan-failed", message: safeText(error?.message || error) });
  }
  results.push({ page: state, viewport: viewport.name, screenshot: shot, metrics, axeViolations: axeViolations.length });
  if (metrics.horizontalOverflow >= 8) {
    findings.push({ severity: metrics.horizontalOverflow >= 24 ? "high" : "medium", page: state, viewport: viewport.name,
      type: "horizontal-overflow", evidence: `La página excede el viewport por ${metrics.horizontalOverflow}px.`,
      recommendation: "Localizar el elemento que rebasa el ancho disponible y corregir grid, flex, min-width o padding; no ocultar el problema con overflow-x:hidden." });
  }
  if (metrics.images.some(image => !image.loaded)) {
    findings.push({ severity: "medium", page: state, viewport: viewport.name, type: "image-load",
      evidence: "Una o más imágenes visibles no terminaron de cargar.", recommendation: "Verificar ruta, formato, respuesta HTTP y fallback de la imagen." });
  }
  return metrics;
}

async function auditViewport(viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.mobile,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", error => runtimeErrors.push({
    viewport: viewport.name, type: "pageerror", message: safeText(error.message), stack: safeText(error.stack, 1400),
  }));
  page.on("requestfailed", request => {
    const method = request.method().toUpperCase();
    const failure = request.failure()?.errorText || "unknown";
    if (["GET", "HEAD", "OPTIONS"].includes(method) && !/ERR_ABORTED/i.test(failure)) {
      try {
        if (new URL(request.url()).origin === BASE_URL.origin) runtimeErrors.push({
          viewport: viewport.name, type: "first-party-request", message: safeText(`${request.url()} — ${failure}`),
        });
      } catch {}
    }
  });
  await page.route("**/*", async route => {
    const request = route.request();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method().toUpperCase())) {
      blockedWrites.push({ viewport: viewport.name, method: request.method(), url: request.url() });
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  try {
    const response = await page.goto(BASE_URL.href, { waitUntil: "domcontentloaded", timeout: 30000 });
    assert.ok(response?.ok(), `La página respondió con estado HTTP ${response?.status() ?? "desconocido"}.`);
    await assertActiveScreen(page, "welcome");
    await capture(page, viewport, "welcome", "welcome");

    await recordJourney(viewport, "inicio-a-pantalla-de-musica", async () => {
      await page.locator("#begin-button").click();
      await assertActiveScreen(page, "music-screen");
    });
    if (await page.locator("#music-screen.active").count()) await capture(page, viewport, "music", "music-screen");

    await recordJourney(viewport, "continuar-sin-reproducir-musica", async () => {
      await page.locator("#music-no").click();
      await assertActiveScreen(page, "question-screen");
      assert.ok(await page.locator("#answer-list button").count() >= 2, "Las alternativas deben renderizarse.");
    });
    if (await page.locator("#question-screen.active").count()) {
      await capture(page, viewport, "question-1", "question-screen");
      for (let index = 0; index < 3; index += 1) {
        const previous = await page.locator("#question-title").innerText();
        await recordJourney(viewport, `responder-pregunta-${index + 1}`, async () => {
          const answers = page.locator("#answer-list button");
          assert.ok(await answers.count() >= 2, "La pregunta debe ofrecer alternativas.");
          await answers.first().click();
          if (index < 2) {
            await page.waitForFunction(previousTitle => document.querySelector("#question-title")?.innerText !== previousTitle, previous, { timeout: 5000 });
            await capture(page, viewport, `question-${index + 2}`, "question-screen");
          } else {
            await page.locator("#clue-screen.active").waitFor({ state: "visible", timeout: 5000 });
          }
        });
      }
    }

    if (await page.locator("#clue-screen.active").count()) {
      await capture(page, viewport, "clue", "clue-screen");
      await recordJourney(viewport, "pista-a-revelacion", async () => {
        await page.locator("#clue-continue").click();
        await assertActiveScreen(page, "reveal-screen");
      });
    }
    if (await page.locator("#reveal-screen.active").count()) {
      await capture(page, viewport, "reveal", "reveal-screen");
      await recordJourney(viewport, "revelacion-a-carta", async () => {
        await page.locator("#letter-button").click();
        await assertActiveScreen(page, "letter-screen");
      });
    }
    if (await page.locator("#letter-screen.active").count()) {
      const before = await page.locator("#closing-note").innerText();
      await capture(page, viewport, "letter", "letter-screen");
      await recordJourney(viewport, "opcion-de-conversacion", async () => {
        await page.locator("#response-yes").click();
        await page.waitForFunction(previous => document.querySelector("#closing-note")?.innerText !== previous, before, { timeout: 3000 });
        assert.equal(await page.locator("#letter-screen.active").count(), 1, "La opción no debe navegar fuera de la experiencia.");
      });
      if (await page.locator("#letter-screen.active").count()) await capture(page, viewport, "response-conversation", "letter-screen");
      await recordJourney(viewport, "opcion-de-agradecimiento", async () => {
        await page.locator("#response-thanks").click();
        await assert.equal(await page.locator("#response-thanks").innerText(), "Gracias por leer 🌹");
        await capture(page, viewport, "response-thanks", "letter-screen");
      });
      const href = await page.locator("#response-yes").getAttribute("href");
      if (href && /tiktok\.com\/?$/i.test(href)) {
        findings.push({ severity: "medium", page: "letter", viewport: viewport.name, type: "generic-response-destination",
          evidence: "La acción de conversar conserva un enlace genérico a la portada de TikTok, no a un destino de contacto específico.",
          recommendation: "Sustituirlo por el destino de contacto correcto o por una acción claramente explicada; comprobar que el texto no prometa abrir un canal distinto." });
      }
    }
  } catch (error) {
    runtimeErrors.push({ viewport: viewport.name, type: "journey-aborted", message: safeText(error?.stack || error) });
  } finally {
    await context.close();
  }
}

await mkdir(OUT_DIR, { recursive: true });
browser = await chromium.launch({ headless: true });
try {
  for (const viewport of PERSONAL_EXPERIENCE_PROFILE.viewports) await auditViewport(viewport);
} finally {
  await browser.close();
}

const axeByImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
const axeFindings = [...axeGroups.values()].map(item => {
  const impact = ["critical", "serious", "moderate", "minor"].includes(item.impact) ? item.impact : "minor";
  axeByImpact[impact] += 1;
  return { ...item, affectedNodes: [...item.affectedNodes].slice(0, 30) };
});
const journeyPassed = journeys.filter(item => item.passed).length;
const report = {
  generatedAt: new Date().toISOString(),
  profile: PERSONAL_EXPERIENCE_PROFILE.id,
  title: PERSONAL_EXPERIENCE_PROFILE.title,
  targetUrl: BASE_URL.href,
  mode: "read-only browser audit",
  summary: {
    scenarios: results.length,
    screenshots: results.length,
    journeyChecks: journeys.length,
    journeyPassed,
    journeyFailures: journeys.length - journeyPassed,
    overflowScenarios: results.filter(item => item.metrics.horizontalOverflow >= 8).length,
    runtimeErrors: runtimeErrors.length,
    axeScans: axeScanCount,
    axeUniqueViolations: axeFindings.length,
    axeViolationOccurrences: axeFindings.reduce((sum, item) => sum + item.occurrences, 0),
    axeByImpact,
    blockedWriteRequests: blockedWrites.length,
  },
  results, journeys, findings, axeFindings, runtimeErrors, blockedWrites,
  limitations: [
    "La música no se reproduce durante esta auditoría; se valida la pantalla y el flujo de continuar sin música.",
    "La experiencia se prueba con dos tamaños de viewport y un recorrido de respuestas sintéticas.",
    "Axe detecta problemas WCAG automatizables, pero no sustituye una evaluación completa de accesibilidad.",
    "La auditoría no puede medir la respuesta emocional ni anticipar la reacción de la persona destinataria.",
  ],
};
const dimensionRows = [
  ["Funcionamiento", "Se calcula con los recorridos ejecutados y sus pasos correctos."],
  ["Diseño visual", "Se completa con la revisión visual de IA sobre las capturas."],
  ["Experiencia narrativa", "Se completa con la valoración de claridad, continuidad y tono del contenido visible."],
  ["Adaptabilidad", "Se calcula con el desbordamiento medido en cada viewport/estado."],
  ["Accesibilidad", "Se calcula con las violaciones Axe únicas por severidad."],
];
const lines = [
  "# Declaraci-n — auditoría Personal Experience QA", "",
  `- Fecha: ${report.generatedAt}`,
  `- URL evaluada: ${report.targetUrl}`,
  `- Estados capturados: ${report.summary.screenshots}`,
  `- Viewports: ${PERSONAL_EXPERIENCE_PROFILE.viewports.map(item => item.name).join(", ")}`,
  `- Recorridos: ${journeyPassed}/${journeys.length} correctos; ${report.summary.journeyFailures} fallidos`,
  `- Escenarios con desbordamiento: ${report.summary.overflowScenarios}`,
  `- Errores runtime: ${report.summary.runtimeErrors}`,
  `- Violaciones Axe únicas: ${report.summary.axeUniqueViolations} (${report.summary.axeViolationOccurrences} ocurrencias)`,
  `- Solicitudes de escritura bloqueadas: ${report.summary.blockedWriteRequests}`, "",
  "## Dimensiones de evaluación", "",
  "| Dimensión | Fuente | Estado |", "|---|---|---|",
  ...dimensionRows.map(([name, source], index) => `| ${name} | ${source} | ${index === 0 || index === 3 || index === 4 ? "Evidencia recogida" : "Pendiente de IA"} |`),
  "", "## Recorridos funcionales", "",
  ...journeys.map(item => `- ${item.passed ? "PASS" : "FAIL"} — ${item.viewport} / ${item.name}: ${item.evidence}`),
  "", "## Hallazgos", "",
  ...(findings.length ? findings.map(item => `- **[${item.severity.toUpperCase()}] ${item.page} / ${item.viewport}** — ${item.evidence} Recomendación: ${item.recommendation}`) : ["No se generaron hallazgos deterministas adicionales."]),
  "", "## Accesibilidad (Axe)", "",
  ...(axeFindings.length ? axeFindings.map(item => `- **[${item.impact.toUpperCase()}] ${item.id}** — ${item.help}; ocurrencias: ${item.occurrences}; nodos: ${item.affectedNodes.join(", ")}`) : ["No se detectaron violaciones Axe en los estados capturados. Esto no demuestra accesibilidad completa."]),
  "", "## Salvaguardas y límites", "",
  ...report.limitations.map(item => `- ${item}`),
  "- Las solicitudes HTTP distintas de GET, HEAD y OPTIONS se bloquean; no se envían mensajes ni se modifican datos.",
  "- No se inicia la reproducción de audio ni se abre un destino externo.",
  "- Las puntuaciones finales se mostrarán únicamente cuando existan las cinco dimensiones; los datos incompletos no se transforman en un aprobado.",
  "",
];
await writeFile(resolve(OUT_DIR, "personal-experience-qa-report.json"), JSON.stringify(report, null, 2), "utf8");
await writeFile(resolve(OUT_DIR, "personal-experience-qa-report.md"), lines.join("\n"), "utf8");
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, [
    "## Personal Experience QA — Declaraci-n", "",
    `**Recorridos:** ${journeyPassed}/${journeys.length} · **Escenarios:** ${results.length} · **Overflow:** ${report.summary.overflowScenarios} · **Violaciones Axe:** ${axeFindings.length}`,
    "", "| Dimensión | Método |", "|---|---|", ...dimensionRows.map(([name, source]) => `| ${name} | ${source} |`),
    "", "> La puntuación global se mantiene pendiente hasta completar el análisis visual y narrativo de IA.", "",
  ].join("\n") + "\n", "utf8");
}
console.log(JSON.stringify(report.summary, null, 2));
assert.ok(results.length > 0, "No se capturó ningún estado de la experiencia.");
