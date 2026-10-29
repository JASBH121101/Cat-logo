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
        rationale: "La solicitud externa fue bloqueada deliberadamente por la auditoría aislada; no se considera un fallo de la aplicación.",
      };
    }

    if (!externalDependency) {
      return {
        category: "first_party_resource_failure",
        severity: "critical",
        blocking: true,
        rationale: "Falló una solicitud de un recurso del propio sitio. Revisar la ruta, el servidor local y la referencia del recurso antes de aprobar.",
      };
    }

    const essential = ESSENTIAL_RESOURCE_TYPES.has(resourceType);
    return {
      category: essential ? "external_essential_resource_failure" : "external_dependency_or_network",
      severity: essential ? "high" : "medium",
      blocking: essential,
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
