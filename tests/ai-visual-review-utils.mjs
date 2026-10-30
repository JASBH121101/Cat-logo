const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const str = (v, max = 1000) => typeof v === "string" ? v.trim().slice(0, max) : "";

export function getModelText(payload) {
  const result = payload?.result ?? payload;
  const candidates = [
    result?.response,
    result?.output_text,
    result?.result,
    payload?.response,
    typeof result === "string" ? result : null,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return str(candidate, 16000);
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      try { return JSON.stringify(candidate).slice(0, 16000); } catch {}
    }
  }
  return "";
}

function parseJson(text) {
  const source = String(text || "").replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(source); } catch {}
  for (let start = source.indexOf("{"); start >= 0; start = source.indexOf("{", start + 1)) {
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < source.length; i++) {
      const c = source[i];
      if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
      if (c === '"') quoted = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) { try { return JSON.parse(source.slice(start, i + 1)); } catch {} break; }
    }
  }
  return null;
}

export function deduplicateIssues(issues = []) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = [issue.severity, issue.region, issue.evidence].map((v) => String(v || "").toLowerCase().replace(/\s+/g, " ").trim()).join("|");
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function validateReview(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, reason: "top-level value is not an object" };
  const assessment = str(value.overall_assessment ?? value.overallAssessment, 1800);
  if (!assessment) return { valid: false, reason: "missing overall_assessment" };
  if (!Array.isArray(value.issues) || value.issues.length > 8) return { valid: false, reason: "issues must be an array of at most 8 items" };
  const issues = [];
  for (const [i, item] of value.issues.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { valid: false, reason: `issues[${i}] is not an object` };
    const rawConfidence = item.confidence;
    const confidence = rawConfidence === null || rawConfidence === undefined || rawConfidence === ""
      ? null
      : Number(rawConfidence);
    const issue = {
      severity: str(item.severity, 20).toLowerCase(),
      region: str(item.region, 180),
      evidence: str(item.evidence, 700),
      recommendation: str(item.recommendation, 700),
      confidence,
    };
    if (!SEVERITIES.has(issue.severity)) return { valid: false, reason: `issues[${i}] has invalid severity` };
    if (!issue.region || !issue.evidence || !issue.recommendation) return { valid: false, reason: `issues[${i}] lacks region, evidence, or recommendation` };
    if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
      return { valid: false, reason: `issues[${i}] confidence must be 0-1 or null` };
    }
    issues.push({ ...issue, confidence: confidence === null ? null : Math.round(confidence * 100) / 100 });
  }
  const score = value.visual_score ?? value.visualScore ?? null;
  if (score !== null && (!Number.isFinite(Number(score)) || !Number.isInteger(Number(score)) || Number(score) < 1 || Number(score) > 100)) return { valid: false, reason: "visual_score must be an integer from 1 to 100; use null when evidence is insufficient" };
  const narrativeScore = value.narrative_score ?? value.narrativeScore ?? null;
  if (narrativeScore !== null && (!Number.isFinite(Number(narrativeScore)) || !Number.isInteger(Number(narrativeScore)) || Number(narrativeScore) < 1 || Number(narrativeScore) > 100)) return { valid: false, reason: "narrative_score must be an integer from 1 to 100; use null when evidence is insufficient" };
  const list = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 5).map((x) => str(x, 300)) : [];
  return { valid: true, review: { visual_score: score === null ? null : Number(score), narrative_score: narrativeScore === null ? null : Number(narrativeScore), overall_assessment: assessment, strengths: list(value.strengths), issues: deduplicateIssues(issues), manual_review_required: true, limitations: list(value.limitations) } };
}

function compactSentences(text) {
  const sentences = String(text || "").replace(/\r/g, "\n").split(/(?<=[.!?])\s+|\n+/).map((s) => s.replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const seen = new Set(), unique = [];
  for (const sentence of sentences) { const key = sentence.toLowerCase().replace(/[.!?]+$/g, "").trim(); if (!seen.has(key)) { seen.add(key); unique.push(sentence); } }
  return { sentences: unique, duplicates: sentences.length - unique.length };
}

const NEGATIVE = [
  /parece[n]?\s+(?:estar\s+)?desperdiciad[oa]s?/i,
  /espacio\s+(?:vac[ií]o|en blanco)\s+(?:excesivo|demasiado|desperdiciad[oa])/i,
  /demasiado\s+espacio\s+(?:vac[ií]o|entre|alrededor)/i,
  /(?:texto|letra|tipograf[ií]a)\s+(?:demasiado\s+)?pequeñ[oa]s?/i,
  /(?:texto|contenido|bot[oó]n|imagen|control)\s+(?:est[aá]n?\s+)?(?:cortad[oa]s?|recortad[oa]s?|ocult[oa]s?)/i,
  /(?:no\s+se\s+puede\s+leer|ilegible|poco\s+contraste|contraste\s+insuficiente)/i,
  /(?:se\s+superpone|superpuest[oa]s?|solapad[oa]s?|desalinead[oa]s?)/i,
  /(?:imagen|fotograf[ií]a|producto)\s+(?:se\s+ve\s+)?(?:pixelad[oa]|borros[oa]|deformad[oa])/i,
  /(?:overflow|desbordamiento|fuera\s+del\s+viewport)/i,
];
const NEGATED = /\b(?:no\s+(?:se\s+)?observan?|no\s+hay|sin\s+(?:defectos?|problemas?|fallos?))\b/i;
function region(s) {
  if (/espacio|vac[ií]o|margen|separaci[oó]n|desperdiciad/i.test(s)) return "espaciado / composición";
  if (/texto|letra|tipograf[ií]a|contraste|legibilidad/i.test(s)) return "texto / legibilidad";
  if (/bot[oó]n|control|men[uú]|flecha|navegaci[oó]n/i.test(s)) return "controles / navegación";
  if (/imagen|fotograf[ií]a|producto|botella|frasco|pixelad|borros/i.test(s)) return "imagen / presentación del producto";
  if (/desbordamiento|overflow|viewport|cortad|recortad/i.test(s)) return "adaptación al viewport";
  return "composición visual";
}

export function recoverExplicitFindings(text) {
  const compacted = compactSentences(text);
  const issues = compacted.sentences.filter((s) => !NEGATED.test(s) && NEGATIVE.some((pattern) => pattern.test(s))).map((evidence) => ({
    severity: /ocult[oa]|no\s+se\s+puede\s+leer|fuera\s+del\s+viewport|desbordamiento|overflow/i.test(evidence) ? "high" : "medium",
    region: region(evidence), evidence: str(evidence, 700),
    recommendation: "Verificar manualmente la captura y medir el elemento antes de modificar CSS o estructura.", confidence: 0.55,
  }));
  return { issues: deduplicateIssues(issues).slice(0, 4), duplicateSentenceCount: compacted.duplicates };
}

export function interpretModelResponse(text) {
  const parsed = parseJson(text);
  if (parsed !== null) {
    const checked = validateReview(parsed);
    if (checked.valid) return { status: "structured", review: checked.review, reason: null, duplicateSentenceCount: 0 };
    return { status: "invalid", review: null, reason: checked.reason, ...recoverExplicitFindings(text) };
  }
  return { status: "invalid", review: null, reason: "model response was not valid JSON", ...recoverExplicitFindings(text) };
}

export function safeText(value, max = 1000) { return str(value, max).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""); }
