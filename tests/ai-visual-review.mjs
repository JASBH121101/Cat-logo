import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getModelText, interpretModelResponse, recoverExplicitFindings, safeText } from "./ai-visual-review-utils.mjs";
import { buildExperienceAiCases, calculateExperienceScores } from "./personal-experience-qa-profile.mjs";

const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const ROOT = resolve("artifacts/production-visual-audit");
const MAX_IMAGE_BYTES = 5_200_000;
const QA_PROFILE = String(process.env.QA_PROFILE || "ecommerce").trim();
if (!["ecommerce", "personal-experience"].includes(QA_PROFILE)) throw new Error(`Unknown QA_PROFILE: ${QA_PROFILE}`);
const EXPERIENCE_PROFILE = QA_PROFILE === "personal-experience";
const CATALOG_CASES = [
  { page: "JB Collections — portada", viewport: "mobile-390", theme: "light", file: "home--mobile-390--light.png", focus: "header, navegación, hero, espacios vacíos, CTA y legibilidad en el primer viewport" },
  { page: "JB Collections — portada", viewport: "desktop-1365", theme: "dark", file: "home--desktop-1365--dark.png", focus: "uso del ancho, hero, jerarquía, navegación y llamadas a la acción" },
  { page: "JB TECH — catálogo", viewport: "mobile-390", theme: "dark", file: "technology--mobile-390--dark.png", focus: "densidad y alineación de tarjetas, fotografías, precios, filtros y botones" },
  { page: "JB TECH — catálogo", viewport: "desktop-1365", theme: "light", file: "technology--desktop-1365--light.png", focus: "consistencia de cuadrícula, espacios, filtros, escala de imágenes y jerarquía de tarjetas" },
  { page: "JB TECH — detalle de producto", viewport: "desktop-1365", theme: "light", file: "technology-detail--desktop-1365--light--viewport.png", focus: "protagonismo del producto, galería, espacio entre imagen e información, precio y contacto" },
  { page: "JB TECH — detalle de producto", viewport: "mobile-390", theme: "dark", file: "technology-detail--mobile-390--dark--viewport.png", focus: "galería móvil, legibilidad, orden vertical, controles y contenido que quede fuera de pantalla" },
  { page: "JB Parfums — catálogo", viewport: "mobile-390", theme: "light", file: "perfumery--mobile-390--light.png", focus: "legibilidad del banner, tarjetas, fotos de perfumes, categorías, precios y espaciado" },
  { page: "JB Parfums — catálogo", viewport: "desktop-1365", theme: "dark", file: "perfumery--desktop-1365--dark.png", focus: "consistencia de cuadrícula, protagonismo fotográfico, jerarquía del banner y uso del espacio" },
  { page: "JB Parfums — detalle de producto", viewport: "desktop-1365", theme: "dark", file: "perfumery-detail--desktop-1365--dark--viewport.png", focus: "protagonismo del frasco, galería, espacio entre imagen e información, precio y contacto" },
  { page: "JB Parfums — detalle de producto", viewport: "mobile-390", theme: "light", file: "perfumery-detail--mobile-390--light--viewport.png", focus: "tamaño del frasco, galería móvil, texto, precio, contacto y orden vertical" },
];
const CASES = EXPERIENCE_PROFILE ? buildExperienceAiCases() : CATALOG_CASES;
const analyses = [];
const errors = [];
const schemaExample = {
  visual_score: 0,
  ...(EXPERIENCE_PROFILE ? { narrative_score: 0 } : {}),
  overall_assessment: "Resumen basado en la captura.",
  strengths: [],
  issues: [{ severity: "medium", region: "zona concreta", evidence: "defecto visible", recommendation: "acción verificable", confidence: 0.75 }],
  manual_review_required: true,
  limitations: [],
};
const systemPrompt = EXPERIENCE_PROFILE ? [
  "Sos auditor senior de QA para experiencias narrativas e interactivas personales.",
  "Evalúa ÚNICAMENTE lo visible en la captura y el texto que aparece en ella. No asumas estados que no se muestran ni predigas la reacción de la persona destinataria.",
  "Puntúa visual_score por composición, jerarquía, tipografía, contraste, proporciones, espacios y legibilidad.",
  "Puntúa narrative_score por claridad del mensaje visible, continuidad con el estado mostrado, naturalidad, respeto, autonomía de quien visita y ausencia de presión emocional. No juzgues si la persona destinataria aceptará una invitación ni atribuyas emociones.",
  "Busca defectos concretos: contenido cortado, texto ilegible, controles ambiguos, estados confusos, espacios involuntarios, desalineación, elementos superpuestos y CTA cuyo propósito no se entienda.",
  "No confundas espacio negativo intencional con defecto. No inventes fallos funcionales que no puedan confirmarse en la captura.",
  "Devuelve SOLO JSON válido sin Markdown. Incluye visual_score y narrative_score de 0 a 100, overall_assessment, strengths, issues y limitations. issues=[] si no hay defecto concreto; máximo 3 incidencias distintas, sin repeticiones.",
  "Cada incidencia requiere severity (critical/high/medium/low), region, evidence, recommendation y confidence 0-1.",
  "Las puntuaciones son estimaciones subjetivas y requieren revisión humana. No declares que la experiencia es perfecta.",
].join(" ") : [
  "Sos auditor QA visual senior de ecommerce. Evalúa ÚNICAMENTE lo visible en la captura adjunta.",
  "Busca: hero o producto poco protagonista, espacios desproporcionados, tarjetas inconsistentes, cuadrículas demasiado densas o vacías, texto pequeño/ilegible, jerarquía confusa, alineación rota, filtros poco visibles, elementos cortados/desbordados, solapamientos y contraste insuficiente.",
  "No confundas espacio negativo intencional con defecto. No inventes fallos funcionales, datos ocultos ni propongas cambios en base de datos.",
  "Devuelve SOLO JSON válido sin Markdown. Usa las claves del esquema del usuario. issues=[] si no hay defecto concreto; máximo 3 incidencias distintas. Sin repeticiones. Cada incidencia requiere severity (critical/high/medium/low), region, evidence, recommendation y confidence 0-1.",
  "Usa critical solo si bloquea claramente el uso; high si contenido esencial queda inaccesible; medium para defectos claros de jerarquía/espaciado/legibilidad; low para pulido menor.",
  "visual_score es subjetivo, no una medición certificada. manual_review_required debe ser true. Nunca declares que todo el sitio está perfecto.",
].join(" ");

function userPrompt(item, retry) {
  return [
    `Audita la superficie pública ${item.page}. Estado: ${item.state || "vista general"}. Viewport ${item.viewport}; tema ${item.theme}.`,
    `Enfoque específico: ${item.focus}.`,
    EXPERIENCE_PROFILE
      ? "Evalúa por separado la calidad visual y el texto/narrativa que realmente se ve. Considera claridad, tono respetuoso, autonomía y ausencia de presión; no hagas predicciones sobre sentimientos ni resultados personales."
      : "Prioridad: jerarquía visual clara, fotografías nítidas y sin deformación, contenido legible, composición equilibrada y espacio útil.",
    "No infieras lo que no puede confirmarse con una sola captura.",
    retry ? "La respuesta anterior no fue JSON válido. Devuelve ahora únicamente un objeto JSON parseable, sin texto introductorio ni frases repetidas." : "",
    "Esquema orientativo; usa datos reales y no copies valores de ejemplo:", JSON.stringify(schemaExample),
  ].filter(Boolean).join("\n");
}

async function callModel(item, bytes, attempt) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(ACCOUNT_ID)}/ai/run/${MODEL}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 75_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST", headers: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt(item, attempt > 1) }],
        image: `data:image/png;base64,${bytes.toString("base64")}`,
        max_tokens: EXPERIENCE_PROFILE ? 900 : 650, temperature: 0, top_p: 0.85, repetition_penalty: 1.15, frequency_penalty: 0.45,
        seed: 20261029 + CASES.indexOf(item),
      }),
    });
    const bodyText = await response.text();
    let payload;
    try { payload = JSON.parse(bodyText); } catch { payload = { raw_response: bodyText.slice(0, 2500) }; }
    if (!response.ok || payload.success === false) {
      const reason = Array.isArray(payload.errors) ? payload.errors.map((e) => safeText(e.message || e.code || "unknown", 300)).join("; ") : `HTTP ${response.status}`;
      throw new Error(`Cloudflare Workers AI request failed: ${reason}`);
    }
    const output = getModelText(payload) || safeText(payload.raw_response, 2500);
    if (!output) throw new Error("Cloudflare response contained no model text.");
    return output;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Cloudflare Workers AI request timed out after 75 seconds.");
    throw error;
  } finally { clearTimeout(timer); }
}

function recoverReview(text, reason) {
  const result = recoverExplicitFindings(text);
  if (!result.issues.length) return { review: null, duplicates: result.duplicateSentenceCount };
  return {
    duplicates: result.duplicateSentenceCount,
    review: {
      visual_score: null,
      overall_assessment: "Se recuperó una observación explícita de prosa no estructurada; no equivale a una revisión JSON validada.",
      strengths: [], issues: result.issues, manual_review_required: true,
      limitations: ["Hallazgo recuperado automáticamente: verificarlo contra la captura antes de cambiar código.", safeText(reason, 300)],
    },
  };
}

async function review(item) {
  const bytes = await readFile(resolve(ROOT, item.file));
  if (!bytes.length) throw new Error("Screenshot is empty.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`Screenshot exceeds the ${MAX_IMAGE_BYTES} byte safeguard.`);
  const firstText = await callModel(item, bytes, 1);
  const first = interpretModelResponse(firstText);
  let text = firstText, parsed = first, attempts = 1, retryError = null;
  if (first.status !== "structured") {
    try {
      const secondText = await callModel(item, bytes, 2);
      attempts = 2;
      const second = interpretModelResponse(secondText);
      if (second.status === "structured") { text = secondText; parsed = second; }
      else {
        text = secondText;
        const recovery = recoverReview([firstText, secondText].join("\n"), `JSON inválido tras dos intentos: ${second.reason || first.reason || "formato no reconocido"}`);
        parsed = { status: recovery.review ? "recovered" : "invalid", reason: second.reason || first.reason, review: recovery.review, duplicateSentenceCount: recovery.duplicates };
      }
    } catch (error) { retryError = safeText(error.message, 500); }
  }
  let recovery = null;
  if (parsed.status !== "structured" && !parsed.review) recovery = recoverReview(text, parsed.reason || "Formato de respuesta inválido.");
  const reviewData = parsed.review || recovery?.review || null;
  const parseStatus = parsed.status === "structured" ? "structured" : reviewData ? "recovered" : "invalid";
  return {
    ...item, imageBytes: bytes.length, model: MODEL, parseStatus, attempts, parseReason: parseStatus === "structured" ? null : safeText(parsed.reason || "Model response was not valid JSON", 400),
    duplicateSentenceCount: parsed.duplicateSentenceCount || recovery?.duplicates || 0, review: reviewData,
    rawResponseExcerpt: safeText(text, 1800), ...(retryError ? { retryError } : {}),
  };
}

function makeSummary() {
  const count = (status) => analyses.filter((a) => a.parseStatus === status).length;
  return {
    requestedScreenshots: CASES.length, apiResponses: analyses.length,
    reviewedScreenshots: count("structured") + count("recovered"),
    structuredReviews: count("structured"), recoveredReviews: count("recovered"), invalidResponses: count("invalid"), failedReviews: errors.length,
    reportedIssues: analyses.reduce((sum, a) => sum + (a.review?.issues?.length || 0), 0),
    repeatedSentencesRemoved: analyses.reduce((sum, a) => sum + (a.duplicateSentenceCount || 0), 0),
    manualReviewRequired: analyses.filter((a) => a.parseStatus !== "structured" || a.review?.manual_review_required !== false).length,
  };
}

function markdown(report) {
  const s = report.summary;
  const lines = [EXPERIENCE_PROFILE ? "# Declaraci-n — revisión de experiencia personal con IA" : "# JB Collections — revisión visual con IA", "", `- Estado: **${report.status}**`, `- Modelo: \`${MODEL}\``,
    `- Capturas solicitadas: ${s.requestedScreenshots}`, `- Respuestas API: ${s.apiResponses}`, `- JSON validados: ${s.structuredReviews}`,
    `- Recuperadas de prosa (requieren revisión): ${s.recoveredReviews}`, `- Respuestas inválidas: ${s.invalidResponses}`,
    `- Errores de solicitud: ${s.failedReviews}`, `- Incidencias concretas: ${s.reportedIssues}`, `- Frases repetidas eliminadas: ${s.repeatedSentencesRemoved}`,
    `- Capturas que requieren revisión manual: ${s.manualReviewRequired}`, "",
    "> Cero incidencias no prueba que el diseño esté perfecto. Solo respuestas JSON válidas cuentan como revisión estructurada; toda recuperación de prosa necesita revisión humana.", "", "## Detalle por captura", ""];
  if (!report.analyses.length) lines.push("No se obtuvieron respuestas de la IA.", "");
  for (const a of report.analyses) {
    lines.push(`### ${a.page} — ${a.viewport} — ${a.theme}`, "", `- Captura: \`${a.file}\``, `- Estado: **${a.parseStatus}**`, `- Intentos: ${a.attempts}`, "- Revisión manual requerida: **sí**");
    if (a.parseReason) lines.push(`- Motivo: ${a.parseReason}`);
    if (a.retryError) lines.push(`- Error del segundo intento: ${a.retryError}`);
    if (a.review) {
      lines.push("", a.review.overall_assessment || "Sin resumen.", "", `- Puntuación visual orientativa: ${Number.isFinite(a.review.visual_score) ? a.review.visual_score + "/100" : "no validada"}`);
      if (EXPERIENCE_PROFILE) lines.push(`- Puntuación narrativa orientativa: ${Number.isFinite(a.review.narrative_score) ? a.review.narrative_score + "/100" : "no disponible"}`);
      for (const issue of a.review.issues || []) lines.push(`- **[${issue.severity.toUpperCase()}] ${issue.region}** — ${issue.evidence} Recomendación: ${issue.recommendation} Confianza orientativa: ${Math.round(issue.confidence * 100)}%.`);
      if (!a.review.issues?.length) lines.push("- La respuesta estructurada no enumera incidencias; verificar visualmente antes de darla por limpia.");
      for (const limitation of a.review.limitations || []) lines.push(`- Limitación: ${safeText(limitation, 300)}`);
    } else lines.push("", "**No se acepta como evaluación válida**; el formato no se pudo verificar y no cuenta como resultado limpio.", "", "> " + safeText(a.rawResponseExcerpt, 1200).replace(/\n/g, "\n> "));
    lines.push("");
  }
  if (report.errors.length) lines.push("## Errores de solicitud", "", ...report.errors.map((e) => `- ${e.page} / ${e.viewport} / ${e.theme}: ${safeText(e.message, 500)}`), "");
  lines.push("## Salvaguardas", "", "- Modo solo lectura: no se edita código, catálogo, pedidos ni datos de producción.", "- La IA no corrige código automáticamente ni decide por sí sola sobre calidad subjetiva.", "- Puntuación y confianza son estimaciones, no probabilidades calibradas.", "- Respuestas sin JSON válido nunca aparecen como aprobación limpia.", "");
  return lines.join("\n");
}

async function writeExperienceEvaluation(aiStatus) {
  let evidence = { summary: {} };
  try { evidence = JSON.parse(await readFile(resolve(ROOT, "personal-experience-qa-report.json"), "utf8")); } catch {}
  const evaluation = calculateExperienceScores(evidence, analyses);
  const labels = [
    ["functionality", "Funcionamiento", "Recorridos y controles comprobados por Playwright."],
    ["visual", "Diseño visual", "Promedio de valoraciones visuales estructuradas del modelo."],
    ["narrative", "Experiencia narrativa", "Valoración asistida del contenido y tono visible; no predice la reacción personal."],
    ["adaptability", "Adaptabilidad", "Estados sin desbordamiento en los viewports examinados."],
    ["accessibility", "Accesibilidad", "Violaciones Axe únicas, ponderadas por severidad."],
  ];
  const bar = value => Number.isFinite(value) ? "█".repeat(Math.round(value / 10)) + "░".repeat(10 - Math.round(value / 10)) : "Pendiente de evidencia";
  const dimensions = labels.map(([key, label, source]) => ({
    key, label, source, score: evaluation.dimensions[key],
    display: Number.isFinite(evaluation.dimensions[key]) ? `${evaluation.dimensions[key]}/100` : "Pendiente",
    bar: bar(evaluation.dimensions[key]),
  }));
  const strengths = [...new Set(analyses.flatMap(item => item.review?.strengths || []))].slice(0, 12);
  const issueMap = new Map();
  for (const item of analyses) for (const issue of item.review?.issues || []) {
    const key = [issue.severity, issue.region, issue.evidence].join("|").toLowerCase();
    if (!issueMap.has(key)) issueMap.set(key, { ...issue, screenshots: [] });
    issueMap.get(key).screenshots.push(`${item.state || item.page} / ${item.viewport}`);
  }
  const issues = [...issueMap.values()].slice(0, 20);
  const result = {
    generatedAt: new Date().toISOString(), profile: "personal-experience",
    targetUrl: evidence.targetUrl || process.env.EXPERIENCE_AUDIT_URL || null,
    status: evaluation.complete && aiStatus === "completed" ? "completed" : "partial",
    aiReviewStatus: aiStatus, model: MODEL, summary: evaluation, dimensions, strengths, issues,
    evidenceSummary: evidence.summary || {},
    limitations: [
      "El total es la media aritmética de cinco dimensiones y solo aparece cuando las cinco tienen evidencia.",
      "Funcionamiento, adaptabilidad y accesibilidad proceden de comprobaciones automatizadas; visual y narrativa son estimaciones asistidas por IA.",
      "Una puntuación alta no garantiza una reacción positiva ni sustituye una revisión humana.",
      "La auditoría no reproduce audio y no modifica la página evaluada.",
    ],
  };
  await writeFile(resolve(ROOT, "experience-qa-evaluation.json"), JSON.stringify(result, null, 2), "utf8");
  const lines = [
    "# Declaraci-n — informe de evaluación", "",
    `- Estado: **${result.status}**`,
    `- URL: ${result.targetUrl || "No registrada"}`,
    `- Modelo: \`${MODEL}\``,
    `- Resultado global: **${Number.isFinite(evaluation.overall) ? evaluation.overall + "/100" : "Pendiente — faltan dimensiones con evidencia"}**`,
    "", "| Dimensión | Resultado | Indicador | Fuente de evaluación |", "|---|---:|---|---|",
    ...dimensions.map(item => `| **${item.label}** | ${item.display} | ${item.bar} | ${item.source} |`),
    "", "## Lo que está funcionando", "",
    ...(strengths.length ? strengths.map(item => `- ${safeText(item, 300)}`) : ["Aún no hay fortalezas confirmadas por una respuesta estructurada de IA."]),
    "", "## Hallazgos y recomendaciones", "",
    ...(issues.length ? issues.map(item => `- **[${item.severity.toUpperCase()}] ${safeText(item.region, 180)}** — ${safeText(item.evidence, 500)} Recomendación: ${safeText(item.recommendation, 500)} (confianza orientativa: ${Math.round(item.confidence * 100)}%; capturas: ${item.screenshots.join(", ")}).`) : ["No hay incidencias visuales/narrativas estructuradas confirmadas. La ausencia de incidencias no equivale a una aprobación automática."]),
    "", "## Evidencia de funcionamiento y accesibilidad", "",
    `- Recorridos: ${evidence.summary?.journeyPassed ?? "—"}/${evidence.summary?.journeyChecks ?? "—"} correctos.`,
    `- Escenarios evaluados: ${evidence.summary?.scenarios ?? "—"}.`,
    `- Escenarios con desbordamiento: ${evidence.summary?.overflowScenarios ?? "—"}.`,
    `- Violaciones Axe únicas: ${evidence.summary?.axeUniqueViolations ?? "—"}.`,
    "", "## Criterio de puntuación y límites", "", evaluation.scoringNote,
    ...result.limitations.map(item => `- ${item}`), "",
  ];
  await writeFile(resolve(ROOT, "experience-qa-evaluation.md"), lines.join("\n"), "utf8");
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, [
      "## Declaraci-n — informe de evaluación", "",
      `**Resultado global:** ${Number.isFinite(evaluation.overall) ? evaluation.overall + "/100" : "Pendiente de evidencia"} · **Estado:** ${result.status}`,
      "", "| Dimensión | Resultado | Indicador |", "|---|---:|---|",
      ...dimensions.map(item => `| ${item.label} | ${item.display} | ${item.bar} |`),
      "", "### Hallazgos principales", "",
      ...(issues.length ? issues.slice(0, 5).map(item => `- **[${item.severity.toUpperCase()}] ${item.region}** — ${item.evidence} Recomendación: ${item.recommendation}`) : ["No hay hallazgos estructurados. La revisión humana sigue siendo necesaria."]),
      "", "> La puntuación global solo se presenta con cinco dimensiones completas. Es una referencia heurística, no una certificación ni una predicción interpersonal.", "",
    ].join("\n") + "\n", "utf8");
  }
  console.log(`Personal experience QA evaluation: ${result.status}; overall=${evaluation.overall ?? "pending"}; dimensions=${evaluation.availableDimensions}/5`);
}

async function appendStepSummary(report) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const s = report.summary;
  await appendFile(process.env.GITHUB_STEP_SUMMARY, ["## Revisión visual con IA", "", `**Estado: ${report.status}** — \`${MODEL}\``, "",
    "| Métrica | Resultado |", "|---|---:|", `| Capturas solicitadas | ${s.requestedScreenshots} |`, `| Respuestas API | ${s.apiResponses} |`,
    `| JSON validados | ${s.structuredReviews} |`, `| Recuperadas de prosa | ${s.recoveredReviews} |`, `| Respuestas inválidas | ${s.invalidResponses} |`,
    `| Errores de solicitud | ${s.failedReviews} |`, `| Incidencias concretas | ${s.reportedIssues} |`, `| Frases duplicadas eliminadas | ${s.repeatedSentencesRemoved} |`, "",
    "> El estado del job no equivale a una aprobación visual. Consultá el artefacto para evidencia por captura.", ""].join("\n") + "\n", "utf8");
}

await mkdir(ROOT, { recursive: true });
if (!ACCOUNT_ID || !API_TOKEN) {
  const status = { status: "skipped", reason: "AI review credentials are not configured", required: ["CLOUDFLARE_ACCOUNT_ID repository variable", "CLOUDFLARE_API_TOKEN repository secret"], note: "No screenshot was sent to an AI service." };
  await writeFile(resolve(ROOT, "ai-visual-review-status.json"), JSON.stringify(status, null, 2), "utf8");
  await writeFile(resolve(ROOT, "ai-visual-review-status.md"), "# AI visual review\n\nStatus: **not run**. Configure `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. No screenshot was sent to an AI service.\n", "utf8");
  console.log("AI visual review skipped: credentials are not configured.");
  if (EXPERIENCE_PROFILE) await writeExperienceEvaluation("not-run");
} else {
  for (const item of CASES) {
    try { analyses.push(await review(item)); }
    catch (error) { errors.push({ page: item.page, viewport: item.viewport, theme: item.theme, screenshot: item.file, message: safeText(error.message, 800) }); }
  }
  const summary = makeSummary();
  const allStructured = summary.structuredReviews === CASES.length && errors.length === 0;
  const useful = summary.reviewedScreenshots > 0;
  const report = { generatedAt: new Date().toISOString(), status: allStructured ? "completed" : useful ? "partial" : analyses.length ? "needs_manual_review" : "failed", model: MODEL,
    reviewType: "advisory multimodal visual critique; JSON schema validation, one retry, repetition deduplication, safe prose recovery",
    summary, analyses, errors,
    safety: "advisory multimodal visual critique; never auto-edit code. Findings are advisory. Invalid prose is retried and never silently counted as a clean pass. No code or production data is modified." };
  await writeFile(resolve(ROOT, "ai-visual-review-report.json"), JSON.stringify(report, null, 2), "utf8");
  await writeFile(resolve(ROOT, "ai-visual-review-report.md"), markdown(report), "utf8");
  await appendStepSummary(report);
  if (EXPERIENCE_PROFILE) await writeExperienceEvaluation(report.status);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`AI visual review status: ${report.status}; inspect ai-visual-review-report.md for per-screenshot results.`);
}
