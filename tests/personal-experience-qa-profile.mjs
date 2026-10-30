export const PERSONAL_EXPERIENCE_PROFILE = Object.freeze({
  id: "personal-experience",
  title: "Experiencia personal interactiva",
  defaultUrl: "https://jasbh121101.github.io/Declaraci-n/",
  modelTitle: "Declaraci-n — experiencia personal",
  viewports: Object.freeze([
    { name: "mobile-390", width: 390, height: 844, mobile: true },
    { name: "desktop-1365", width: 1365, height: 900, mobile: false },
  ]),
  states: Object.freeze([
    { id: "welcome", screenId: "welcome", label: "Bienvenida", focus: "primera impresión, claridad de la invitación, jerarquía del título, legibilidad y CTA inicial" },
    { id: "music", screenId: "music-screen", label: "Pantalla de música", focus: "claridad de las opciones, jerarquía, controles y explicación; no evaluar la calidad de una reproducción que no se ha iniciado" },
    { id: "question-1", screenId: "question-screen", label: "Pregunta 1", focus: "claridad de la primera pregunta, lectura de alternativas, progreso, área táctil y feedback visible" },
    { id: "question-2", screenId: "question-screen", label: "Pregunta 2", focus: "claridad de la segunda pregunta, continuidad respecto a la anterior, lectura de alternativas y feedback visible" },
    { id: "question-3", screenId: "question-screen", label: "Pregunta 3", focus: "claridad de la tercera pregunta, continuidad narrativa, lectura de alternativas y cierre del bloque interactivo" },
    { id: "clue", screenId: "clue-screen", label: "Pista personal", focus: "ritmo narrativo, legibilidad, composición y transición hacia la revelación" },
    { id: "reveal", screenId: "reveal-screen", label: "Revelación", focus: "impacto visual, protagonismo del retrato o su marcador, espacio y claridad de la transición" },
    { id: "letter", screenId: "letter-screen", label: "Carta y respuesta", focus: "comodidad de lectura, longitud de texto, jerarquía, tono respetuoso, claridad de las opciones y cierre sin presión" },
    { id: "response-conversation", screenId: "letter-screen", label: "Respuesta: interés en conversar", focus: "claridad del mensaje posterior a expresar interés en conversar, autonomía y ausencia de presión o navegación inesperada" },
    { id: "response-thanks", screenId: "letter-screen", label: "Respuesta: agradecimiento", focus: "claridad y calidez del mensaje de agradecimiento, tono respetuoso y cierre sin presión" },
  ]),
});

export function buildExperienceAiCases() {
  return PERSONAL_EXPERIENCE_PROFILE.states.flatMap((state) =>
    PERSONAL_EXPERIENCE_PROFILE.viewports.map((viewport) => ({
      page: `Declaraci-n — ${state.label}`,
      state: state.id,
      viewport: viewport.name,
      theme: "dark",
      file: `experience--${state.id}--${viewport.name}.png`,
      focus: state.focus,
    }))
  );
}

const clampScore = value => Math.max(0, Math.min(100, Math.round(value)));

export function calculateEvidenceScores(report) {
  const summary = report?.summary || {};
  const checks = Math.max(0, Number(summary.journeyChecks) || 0);
  const expectedChecks = Math.max(checks, Number(summary.journeyExpectedChecks) || checks);
  const passed = Math.max(0, Math.min(expectedChecks, Number(summary.journeyPassed) || 0));
  const scenarios = Math.max(0, Number(summary.scenarios) || 0);
  const overflowScenarios = Math.max(0, Math.min(scenarios, Number(summary.overflowScenarios) || 0));
  const axeScans = Math.max(0, Number(summary.axeScans) || 0);
  const axe = summary.axeByImpact || {};
  const accessibilityPenalty =
    (Number(axe.critical) || 0) * 25 +
    (Number(axe.serious) || 0) * 15 +
    (Number(axe.moderate) || 0) * 7 +
    (Number(axe.minor) || 0) * 3;
  return {
    functionality: expectedChecks > 0 ? clampScore((passed / expectedChecks) * 100) : null,
    adaptability: scenarios > 0 ? clampScore(((scenarios - overflowScenarios) / scenarios) * 100) : null,
    accessibility: axeScans > 0 ? clampScore(100 - accessibilityPenalty) : null,
  };
}

export function calculateExperienceScores(evidenceReport, aiAnalyses = []) {
  const evidence = calculateEvidenceScores(evidenceReport);
  const valid = aiAnalyses.filter(item => item?.parseStatus === "structured" && item.review);
  const average = key => {
    const values = valid.map(item => item.review[key]).filter(value => value !== null && value !== undefined && value !== "").map(Number).filter(value => Number.isFinite(value) && value >= 0 && value <= 100);
    return values.length ? clampScore(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  };
  const dimensions = {
    functionality: evidence.functionality,
    visual: average("visual_score"),
    narrative: average("narrative_score"),
    adaptability: evidence.adaptability,
    accessibility: evidence.accessibility,
  };
  const available = Object.values(dimensions).filter(Number.isFinite);
  return {
    dimensions,
    overall: available.length === 5 ? clampScore(available.reduce((sum, value) => sum + value, 0) / 5) : null,
    availableDimensions: available.length,
    complete: available.length === 5,
    manualReviewRequired: true,
    scoringNote: "Media aritmética de cinco dimensiones. Las medidas de funcionamiento, adaptación y accesibilidad proceden de pruebas observables; diseño y narrativa son valoraciones asistidas por IA. No es una certificación ni predice la respuesta de la persona destinataria.",
  };
}
