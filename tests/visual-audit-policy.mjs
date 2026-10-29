// Shared policy for deciding which browser errors should block the static UI audit.
// Runtime exceptions and failed network requests are different signals: message text alone
// must never turn an uncaught application exception into a harmless environment warning.
const NETWORK_ERROR_RE = /failed to fetch|networkerror|network request failed|net::err_|blockedbyclient|blocked by client|aborterror|request was interrupted|load failed|err_connection|err_name_not_resolved/i;
const ESSENTIAL_RESOURCE_TYPES = new Set(["document", "stylesheet", "script"]);

export function classifyRuntimeError(value, context = {}) {
  const message = String(value ?? "");
  const source = context.source || "pageerror";

  if (source === "network-request") {
    const externalDependency = context.externalDependency === true;
    const blockedByPolicy = context.blockedByPolicy === true;
    const resourceType = String(context.resourceType || "").toLowerCase();
    const networkLike = NETWORK_ERROR_RE.test(message);

    if (externalDependency && blockedByPolicy) {
      return {
        category: "external_dependency_blocked_by_audit",
        severity: "info",
        blocking: false,
        confidence: 0.99,
        rationale: "La solicitud externa fue bloqueada deliberadamente por la auditoría aislada; no se considera un fallo de la aplicación.",
      };
    }

    if (!externalDependency) {
      return {
        category: "first_party_resource_failure",
        severity: "critical",
        blocking: true,
        confidence: 0.95,
        rationale: "Falló una solicitud de un recurso del propio sitio. Revisar la ruta, el servidor local y la referencia del recurso antes de aprobar.",
      };
    }

    const essential = ESSENTIAL_RESOURCE_TYPES.has(resourceType);
    return {
      category: essential ? "external_essential_resource_failure" : "external_dependency_or_network",
      severity: essential ? "high" : "medium",
      blocking: essential,
      confidence: essential ? 0.86 : networkLike ? 0.72 : 0.58,
      rationale: essential
        ? "Falló un documento, script o stylesheet externo que puede cambiar el comportamiento o el aspecto del sitio. Repetir y verificar la dependencia antes de aprobar."
        : networkLike
          ? "La solicitud externa falló durante la auditoría aislada. Se registra por separado; comprobar el flujo conectado si depende de este servicio."
          : "La solicitud externa falló y requiere revisión, pero por sí sola no demuestra una excepción de la aplicación.",
    };
  }

  if (source === "console") {
    // Console.error() is often used for handled failures and diagnostics. Only an
    // explicit uncaught/syntax signal is strong enough to gate CI without a pageerror.
    if (!/(?:\buncaught\b|\bsyntaxerror\b)/i.test(message)) {
      return {
        category: "console_diagnostic",
        severity: "medium",
        blocking: false,
        confidence: 0.58,
        rationale: "Es un mensaje de consola sin señal inequívoca de excepción no controlada; conservarlo como diagnóstico sin convertirlo automáticamente en fallo bloqueante.",
      };
    }
  }

  // A pageerror is a genuine unhandled browser exception even when its message says
  // "Failed to fetch". Network requests are tracked through requestfailed instead.
  return {
    category: "uncaught_javascript_exception",
    severity: "critical",
    blocking: true,
    confidence: 0.9,
    rationale: "Una excepción JavaScript no controlada puede interrumpir el montaje o una interacción; debe reproducirse y corregirse antes de aprobar.",
  };
}


// Keep Axe severity and CI gate decisions centralized so reports and assertions cannot drift.
export function classifyAxeImpact(value) {
  const impact = String(value ?? "").toLowerCase();
  if (impact === "critical" || impact === "serious") {
    return { severity: "high", blocking: true };
  }
  if (impact === "moderate") return { severity: "medium", blocking: false };
  if (impact === "minor") return { severity: "low", blocking: false };
  return { severity: "medium", blocking: false };
}


// Stable grouping of repeated signals across themes/viewports without hiding
// raw occurrence counts, the strongest severity, or a blocking classification.
function normalizeFindingEvidence(value) {
  return String(value ?? "").toLowerCase()
    .replace(/https?:\/\/[^\s"'<>]+/g, "<url>")
    .replace(/\b\d{2,}\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

export function auditFindingFingerprint(finding) {
  const identity = finding.rule || finding.code || finding.category || finding.message || "unknown";
  const target = Array.isArray(finding.target)
    ? finding.target.join(" ")
    : finding.element || finding.evidence || finding.message || "";
  return [finding.page || "", String(identity).toLowerCase(), normalizeFindingEvidence(target)].join("::");
}

function findingScenarios(finding) {
  if (Array.isArray(finding.themes) && Array.isArray(finding.viewports)) {
    return finding.themes.flatMap(theme => finding.viewports.map(viewport => theme + "/" + viewport));
  }
  const scenario = [finding.theme, finding.viewport].filter(Boolean).join("/");
  return scenario ? [scenario] : [];
}

export function groupRepeatedFindings(findings) {
  const grouped = new Map();
  const ranks = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  for (const finding of findings) {
    const fingerprint = auditFindingFingerprint(finding);
    const current = grouped.get(fingerprint);
    const weight = Number.isFinite(Number(finding.occurrences)) && Number(finding.occurrences) > 0
      ? Number(finding.occurrences) : 1;
    const scenarios = findingScenarios(finding);
    if (!current) {
      grouped.set(fingerprint, {
        ...finding,
        fingerprint,
        occurrences: weight,
        scenarios: [...new Set(scenarios)].sort(),
      });
      continue;
    }
    current.occurrences += weight;
    for (const scenario of scenarios) {
      if (!current.scenarios.includes(scenario)) current.scenarios.push(scenario);
    }
    current.scenarios.sort();
    if ((ranks[finding.severity] ?? 0) > (ranks[current.severity] ?? 0)) current.severity = finding.severity;
    current.blocking = Boolean(current.blocking || finding.blocking);
    current.confidence = Math.max(Number(current.confidence) || 0, Number(finding.confidence) || 0);
  }
  return [...grouped.values()];
}
