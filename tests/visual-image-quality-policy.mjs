/**
 * Advisory computer-vision heuristic for product photography.
 *
 * The browser-side sampler estimates the object bounding box by comparing pixels
 * with the average image-corner color. This works best with clean studio/product
 * photos and is intentionally non-blocking: complex backgrounds and cross-origin
 * images can make the measurement unreliable.
 */
export function analyzeImageOccupancy(layouts, {
  minConfidence = 0.55,
  minForegroundAreaRatio = 0.08,
  minForegroundWidthRatio = 0.16,
  minForegroundHeightRatio = 0.18,
} = {}) {
  if (!Array.isArray(layouts)) return [];
  const findings = [];

  for (const item of layouts) {
    const metric = item?.imageOccupancy;
    if (!item || item.visible === false || metric?.status !== "measured") continue;
    if (!Number.isFinite(metric.confidence) || metric.confidence < minConfidence) continue;

    const area = metric.foregroundAreaRatio;
    const width = metric.foregroundWidthRatio;
    const height = metric.foregroundHeightRatio;
    if (![area, width, height].every(Number.isFinite)) continue;

    const smallArea = area < minForegroundAreaRatio;
    const narrow = width < minForegroundWidthRatio;
    const short = height < minForegroundHeightRatio;
    if (!smallArea && !narrow && !short) continue;

    const severe = area < 0.025 || (narrow && short);
    findings.push({
      code: "PRODUCT_SUBJECT_UNDERUTILIZED",
      severity: severe ? "high" : "medium",
      blocking: false,
      confidence: metric.confidence,
      element: item.selector || ".dialog-main-image",
      message: "El objeto ocupa muy poca superficie dentro de la fotografía",
      evidence: [
        item.productName || "Producto",
        `caja estimada del objeto ${Math.round(width * 100)}% × ${Math.round(height * 100)}%`,
        `área delimitada ${(area * 100).toFixed(1)}%`,
        `confianza heurística ${Math.round(metric.confidence * 100)}%`,
        `imagen ${metric.imageWidth || "?"}×${metric.imageHeight || "?"}px`,
      ].join("; "),
      recommendation: "Abrir la fotografía original y confirmar visualmente el objeto. Si el fondo/margen interno es excesivo, usar una versión mejor recortada o ajustar object-fit/object-position; preservar la foto completa, no deformar el producto y no recortar logotipos o detalles.",
      measuredAreaRatio: area,
      measuredWidthRatio: width,
      measuredHeightRatio: height,
    });
  }
  return findings;
}
