const DESKTOP_GAP_MIN = 160;
const MOBILE_GAP_MIN = 112;

/**
 * Advisory client-eye heuristic. Measures blank vertical gaps between
 * meaningful visible top-level regions. It never edits CSS or fails CI by itself.
 */
export function analyzeVerticalRhythm(regions, { viewportWidth = 1365, mobile = viewportWidth < 600 } = {}) {
  if (!Array.isArray(regions) || regions.length < 2) return [];
  const threshold = mobile ? MOBILE_GAP_MIN : Math.max(DESKTOP_GAP_MIN, Math.round(viewportWidth * 0.105));
  const ordered = regions
    .filter(region => Number.isFinite(region.top) && Number.isFinite(region.bottom) &&
      region.bottom > region.top && Number(region.textLength) >= 24 && Number(region.height) >= 80)
    .slice()
    .sort((a, b) => a.top - b.top);
  const findings = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const gap = current.top - previous.bottom;
    if (gap < threshold) continue;
    const severity = gap >= threshold * 2 ? "high" : gap >= threshold * 1.45 ? "medium" : "low";
    findings.push({
      code: "VISUAL_WHITESPACE_RHYTHM",
      severity,
      blocking: false,
      element: current.selector || "content-region",
      message: "Posible espacio vertical excesivo entre secciones",
      evidence: `Hay ${gap}px sin contenido entre ${previous.selector || "sección anterior"} y ${current.selector || "sección siguiente"}; umbral orientativo ${threshold}px en viewport de ${viewportWidth}px.`,
      recommendation: "Comparar el espacio en la captura con la jerarquía visual: revisar margin/padding inferior de la sección anterior y superior de la siguiente, eliminar wrappers vacíos y compactar solo si no separa dos bloques que necesitan respirar. Verificar ambos temas y el viewport móvil antes de cambiar estilos.",
      measuredGap: gap,
      threshold,
      previousRegion: previous.selector || null,
      currentRegion: current.selector || null,
    });
  }
  return findings;
}
