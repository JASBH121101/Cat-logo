// Shared policy for deterministic, evidence-based audit triage.
// Keep raw occurrences in reports; group repeated detections across themes/viewports.
const NETWORK_SIGNATURE = /failed to fetch|networkerror|network request failed|net::err_[a-z_]+|blockedbyclient|blocked by client|aborterror: the operation was aborted|request was interrupted|load failed|err_connection|err_name_not_resolved/i;

export function classifyRuntimeError(value) {
  const message = String(value ?? "");
  if (NETWORK_SIGNATURE.test(message)) {
    return { category: "external_dependency_or_network", severity: "medium", blocking: false, confidence: 0.72,
      rationale: "La firma coincide con un fallo de red/dependencia; al venir de una auditoría aislada, debe verificarse por separado con el servicio conectado." };
  }
  return { category: "uncaught_javascript_exception", severity: "critical", blocking: true, confidence: 0.9,
    rationale: "No hay evidencia suficiente para descartar esta excepción como ruido de red; debe bloquear hasta demostrar lo contrario." };
}
function normalizeEvidence(value) {
  return String(value ?? "").toLowerCase()
    .replace(/https?:\/\/[^\s"'<>]+/g, "<url>")
    .replace(/\b\d{2,}\b/g, "<n>").replace(/\s+/g, " ").trim();
}
export function auditFindingFingerprint(finding) {
  const category = finding.rule || finding.code || finding.category || finding.message || "unknown";
  const target = Array.isArray(finding.target) ? finding.target.join(" ") : finding.element || "";
  return [finding.page || "", String(category).toLowerCase(), normalizeEvidence(target || finding.evidence || finding.message)].join("::");
}
export function groupRepeatedFindings(findings) {
  const grouped = new Map();
  for (const finding of findings) {
    const fingerprint = auditFindingFingerprint(finding);
    const current = grouped.get(fingerprint);
    const scenario = [finding.theme, finding.viewport].filter(Boolean).join("/");
    if (!current) {
      grouped.set(fingerprint, { fingerprint, ...finding, occurrences: 1, scenarios: scenario ? [scenario] : [] });
      continue;
    }
    current.occurrences += 1;
    if (scenario && !current.scenarios.includes(scenario)) current.scenarios.push(scenario);
    const ranks = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    if ((ranks[finding.severity] ?? 0) > (ranks[current.severity] ?? 0)) current.severity = finding.severity;
    current.blocking = Boolean(current.blocking || finding.blocking);
  }
  return [...grouped.values()].map(item => ({ ...item, scenarios: item.scenarios.sort() }));
}
