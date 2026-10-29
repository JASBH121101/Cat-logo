/**
 * Read-only heuristic for visible dialog/modal geometry and form density.
 * Findings are advisory: large dialogs can be legitimate when their content requires it.
 */
export function analyzeDialogQuality(dialogs, { viewportWidth, viewportHeight } = {}) {
  if (!Array.isArray(dialogs)) return [];
  const findings = [];
  for (const dialog of dialogs) {
    if (!dialog || dialog.visible === false || !(dialog.width > 0) || !(dialog.height > 0)) continue;
    const label = dialog.title || dialog.selector || "diálogo";
    const widthRatio = viewportWidth > 0 ? dialog.width / viewportWidth : 0;
    const heightRatio = viewportHeight > 0 ? dialog.height / viewportHeight : 0;
    if (viewportWidth > 0 && widthRatio >= 0.96) {
      findings.push({
        code: "DIALOG_NEAR_FULL_WIDTH",
        severity: "medium",
        blocking: false,
        element: dialog.selector || "dialog",
        message: "Ventana de diálogo ocupa casi todo el ancho disponible",
        evidence: `${label}: ${dialog.width}px de ${viewportWidth}px (${Math.round(widthRatio * 100)}% del viewport).`,
        recommendation: "Revisar si el contenido necesita ese ancho; agrupar campos relacionados, limitar el max-width en escritorio y comprobar que el diálogo conserva márgenes y contexto visual. No reducirlo si eso perjudica la lectura de tablas o comparaciones.",
      });
    }
    if (viewportHeight > 0 && heightRatio >= 0.90) {
      findings.push({
        code: "DIALOG_NEAR_FULL_HEIGHT",
        severity: "high",
        blocking: false,
        element: dialog.selector || "dialog",
        message: "Ventana de diálogo ocupa casi toda la altura disponible",
        evidence: `${label}: ${dialog.height}px de ${viewportHeight}px (${Math.round(heightRatio * 100)}% del viewport); controles visibles: ${dialog.controlCount ?? "sin dato"}.`,
        recommendation: "Comprobar si hay campos redundantes, separación vertical excesiva o encabezados repetidos; mantener scroll dentro del contenido y acciones principales accesibles. Comparar con el flujo completo antes de proponer compactación.",
      });
    }
    if (Number.isFinite(dialog.minimumControlHeight) && dialog.controlCount > 0 && dialog.minimumControlHeight < 32) {
      findings.push({
        code: "DIALOG_CONTROL_TOO_SMALL",
        severity: "medium",
        blocking: false,
        element: dialog.selector || "dialog",
        message: "La ventana contiene controles demasiado pequeños",
        evidence: `${label}: altura mínima medida de control ${dialog.minimumControlHeight}px en ${dialog.controlCount} controles.`,
        recommendation: "Revisar altura táctil, padding y densidad de los campos; priorizar controles importantes sin ampliar innecesariamente toda la ventana.",
      });
    }
  }
  return findings;
}
