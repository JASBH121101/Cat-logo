// Shared policy for deciding which browser errors should block the static UI audit.
// The visual audit deliberately blocks remote APIs; network-only errors from those requests
// are therefore diagnostic noise, while uncaught application exceptions indicate a regression.
export function classifyRuntimeError(value) {
  const message = String(value ?? "");
  const environmental = /failed to fetch|networkerror|network request failed|net::err_|blockedbyclient|blocked by client|aborterror|request was interrupted|load failed|err_connection|err_name_not_resolved/i.test(message);

  if (environmental) {
    return {
      category: "external_dependency_or_network",
      severity: "medium",
      blocking: false,
      rationale: "La auditoría estática bloquea APIs externas; comprobar por separado si el flujo falla con el servicio conectado.",
    };
  }

  return {
    category: "uncaught_javascript_exception",
    severity: "critical",
    blocking: true,
    rationale: "Una excepción no clasificada como fallo de red puede interrumpir la interacción; debe corregirse antes de aprobar.",
  };
}
