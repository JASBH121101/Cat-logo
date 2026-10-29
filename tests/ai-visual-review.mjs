import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const API_TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const ROOT = resolve("artifacts/production-visual-audit");
const CASES = [
  { page: "JB TECH", viewport: "desktop-1365", theme: "light", file: "technology-detail--desktop-1365--light--viewport.png" },
  { page: "JB TECH", viewport: "mobile-390", theme: "dark", file: "technology-detail--mobile-390--dark--viewport.png" },
  { page: "JB Parfums", viewport: "desktop-1365", theme: "dark", file: "perfumery-detail--desktop-1365--dark--viewport.png" },
  { page: "JB Parfums", viewport: "mobile-390", theme: "light", file: "perfumery-detail--mobile-390--light--viewport.png" },
];
const analyses = [];
const errors = [];

function extractModelOutput(payload) {
  const result = payload?.result ?? payload;
  if (result && typeof result === "object" && !Array.isArray(result) &&
      (Array.isArray(result.issues) || typeof result.visual_score === "number")) return result;
  const candidate = typeof result?.response === "string" ? result.response
    : typeof result?.output_text === "string" ? result.output_text
    : typeof result?.result === "string" ? result.result
    : typeof result === "string" ? result
    : "";
  if (!candidate) throw new Error("AI response did not include structured text.");
  const cleaned = candidate.replace(/^`{3}(?:json)?/i, "").replace(/`{3}$/,"").trim();
  try { return JSON.parse(cleaned); } catch {}
  const first = cleaned.indexOf("{"), last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch {}
  }
  return { raw_response: cleaned.slice(0, 6000), parse_status: "unparsed" };
}

const systemPrompt = [
  "Sos un auditor visual senior de interfaces web de comercio electrónico. Analizás capturas de una ficha de producto real.",
  "Evaluá solo lo visible en la captura: protagonismo y tamaño aparente del producto dentro de la galería, espacios vacíos, jerarquía, equilibrio entre imagen e información, legibilidad, alineación, controles cortados y densidad innecesaria.",
  "No inventés datos, no afirmés que un botón funciona por verlo, no asumas características que no aparecen y no propongas cambiar Supabase.",
  "Distinguí defectos visibles de preferencias subjetivas. Toda incidencia debe incluir evidencia visual específica y una recomendación proporcional. No ordenés recortar ni deformar la fotografía si no se demuestra que el objeto queda pequeño.",
  "La captura puede estar incompleta por el viewport y la auditoría geométrica acompaña el análisis. No declares que el sitio está perfecto ni que el test pasó globalmente.",
  "Devolvé SOLO JSON válido con: visual_score (0-100, estimación orientativa), overall_assessment (string), strengths (array de hasta 4 strings), issues (array de objetos con severity [critical, high, medium, low], region, evidence, recommendation, confidence 0-1), manual_review_required (boolean), limitations (array de strings).",
].join(" ");

async function review(item) {
  const path = resolve(ROOT, item.file);
  const bytes = await readFile(path);
  if (bytes.byteLength > 5_200_000) throw new Error("Screenshot exceeds the 5.2 MB safeguard.");
  const dataUrl = "data:image/png;base64," + bytes.toString("base64");
  const prompt = [
    "Revisá esta captura de la ficha de " + item.page + ".",
    "Viewport: " + item.viewport + "; tema: " + item.theme + ".",
    "Prioridad de negocio: el producto debe ser protagonista sin sacrificar legibilidad de características, precio y contacto.",
    "Indicá si el espacio vacío parece deliberado o desperdiciado. Si no se puede decidir por una sola captura, anotá la limitación.",
  ].join("\n");
  const endpoint = "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(ACCOUNT_ID) + "/ai/run/" + encodeURIComponent(MODEL);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: "Bearer " + API_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      image: dataUrl,
      max_tokens: 900,
      temperature: 0.1,
    }),
  });
  const textBody = await response.text();
  let payload;
  try { payload = JSON.parse(textBody); } catch { payload = { raw_response: textBody.slice(0, 3000) }; }
  if (!response.ok || payload.success === false) {
    const message = Array.isArray(payload.errors)
      ? payload.errors.map(item => item.message || item.code || "unknown").join("; ")
      : "HTTP " + response.status;
    throw new Error("Cloudflare Workers AI request failed: " + message);
  }
  return { ...item, imageBytes: bytes.byteLength, model: MODEL, review: extractModelOutput(payload) };
}

await mkdir(ROOT, { recursive: true });
if (!ACCOUNT_ID || !API_TOKEN) {
  const status = {
    status: "skipped",
    reason: "AI review credentials are not configured",
    required: ["GitHub repository variable CLOUDFLARE_ACCOUNT_ID", "GitHub repository secret CLOUDFLARE_API_TOKEN"],
    note: "No screenshot was sent to an AI service.",
  };
  await writeFile(resolve(ROOT, "ai-visual-review-status.json"), JSON.stringify(status, null, 2), "utf8");
  await writeFile(resolve(ROOT, "ai-visual-review-status.md"),
    "# AI visual review\n\nStatus: **not run**. Configure the repository variable `CLOUDFLARE_ACCOUNT_ID` and secret `CLOUDFLARE_API_TOKEN` to enable the optional model-based review. No screenshot was sent to an AI service.\n", "utf8");
  console.log("AI visual review skipped: credentials are not configured; deterministic audit remains separate.");
} else {
  for (const item of CASES) {
    try {
      analyses.push(await review(item));
    } catch (error) {
      errors.push({ page: item.page, viewport: item.viewport, theme: item.theme, screenshot: item.file, message: error.message });
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    status: analyses.length === CASES.length ? "completed" : analyses.length ? "partial" : "failed",
    model: MODEL,
    reviewType: "advisory multimodal visual critique",
    summary: {
      requestedScreenshots: CASES.length,
      reviewedScreenshots: analyses.length,
      failedReviews: errors.length,
      reportedIssues: analyses.reduce((sum, item) => sum + (Array.isArray(item.review?.issues) ? item.review.issues.length : 0), 0),
    },
    analyses,
    errors,
    safety: "Model suggestions are advisory and never auto-edit code, fail CI by subjective score, or modify production data. A model response is not a calibrated probability or a guarantee of visual quality.",
  };
  await writeFile(resolve(ROOT, "ai-visual-review-report.json"), JSON.stringify(report, null, 2), "utf8");
  const markdown = [
    "# JB Collections — AI visual review",
    "",
    "- Status: " + report.status,
    "- Model: " + MODEL,
    "- Screenshots reviewed: " + analyses.length + "/" + CASES.length,
    "- Reported issues: " + report.summary.reportedIssues,
    "- Failed reviews: " + errors.length,
    "",
    "## Visual assessments",
    "",
    ...(analyses.length ? analyses.map(item => {
      const review = item.review || {};
      const lines = [
        "### " + item.page + " — " + item.viewport + " — " + item.theme,
        "",
        "- Screenshot: `" + item.file + "`",
        "- Indicative visual score: " + (Number.isFinite(review.visual_score) ? review.visual_score + "/100" : "no score supplied"),
        "- Assessment: " + String(review.overall_assessment || review.raw_response || "No assessment returned"),
        "- Manual review required: " + (review.manual_review_required === true ? "yes" : "no / not specified"),
        "",
      ];
      if (Array.isArray(review.strengths) && review.strengths.length) lines.push("Strengths:", ...review.strengths.map(value => "- " + value), "");
      if (Array.isArray(review.issues) && review.issues.length) {
        lines.push("Issues:");
        for (const issue of review.issues) lines.push("- **[" + String(issue.severity || "medium").toUpperCase() + "] " + String(issue.region || "region") + "** — " + String(issue.evidence || "No evidence") + " Recommendation: " + String(issue.recommendation || "Manual inspection") + " Confidence: " + (Number.isFinite(issue.confidence) ? Math.round(issue.confidence * 100) + "%" : "not supplied"));
        lines.push("");
      } else lines.push("No specific issues returned by the model (not a guarantee of perfect design).", "");
      if (Array.isArray(review.limitations) && review.limitations.length) lines.push("Limitations:", ...review.limitations.map(value => "- " + value), "");
      return lines.join("\n");
    }) : ["No screenshots were successfully analyzed."]),
    ...(errors.length ? ["", "## Model/API errors", "", ...errors.map(item => "- " + item.page + " / " + item.viewport + " / " + item.theme + ": " + item.message)] : []),
    "",
    "## Interpretation",
    "",
    "The model provides a visual second opinion. Its scores and confidence values are estimates, not calibrated measurements. Confirm each proposed issue against the screenshot before changing the site.",
  ].join("\n");
  await writeFile(resolve(ROOT, "ai-visual-review-report.md"), markdown, "utf8");
  console.log(JSON.stringify(report.summary, null, 2));
  if (!analyses.length) console.log("AI visual review produced no analyses; see ai-visual-review-report.json for request errors.");
}
