/**
 * Read-only client-eye checks for product-detail composition.
 * All findings are advisory: the auditor proposes review steps and never edits CSS.
 */
export function analyzeProductComposition(layouts, { viewportWidth = 1365, mobile = viewportWidth < 600 } = {}) {
  if (!Array.isArray(layouts)) return [];
  const findings = [];
  for (const item of layouts) {
    if (!item || item.visible === false || !(item.frameWidth > 0) || !(item.frameHeight > 0)) continue;
    const label = item.productName || item.selector || "galería del producto";
    const areaRatio = item.imageAreaRatio;
    const frameRatio = item.imageFrameRatio;
    if (Number.isFinite(frameRatio) && frameRatio < (mobile ? 0.38 : 0.48)) {
      findings.push({
        code: "PRODUCT_IMAGE_UNDERUTILIZED",
        severity: frameRatio < (mobile ? 0.25 : 0.32) ? "high" : "medium",
        blocking: false,
        element: item.selector || "#dialog-image",
        message: "La imagen principal aprovecha poco el espacio disponible en la galería",
        evidence: `${label}: la imagen ocupa ${Math.round(frameRatio * 100)}% del marco (${item.imageWidth}×${item.imageHeight}px dentro de ${item.frameWidth}×${item.frameHeight}px).`,
        recommendation: "Revisar object-fit, object-position, padding del marco, proporción de la imagen fuente y tamaño máximo. Comparar la fotografía real antes de cambiar estilos: algunas imágenes de producto necesitan espacio para no recortarse.",
        measuredRatio: frameRatio,
      });
    }
    if (Number.isFinite(areaRatio) && areaRatio < (mobile ? 0.16 : 0.12)) {
      findings.push({
        code: "PRODUCT_GALLERY_LOW_VISUAL_WEIGHT",
        severity: "medium",
        blocking: false,
        element: item.selector || "#dialog-image",
        message: "La fotografía tiene poco peso visual frente al área de galería",
        evidence: `${label}: imagen ${Math.round(areaRatio * 100)}% del área del marco; viewport ${viewportWidth}px.`,
        recommendation: "Evaluar en la captura si conviene ampliar el producto, centrarlo o ajustar la altura de la galería. No rellenar el espacio con contenido decorativo ni reducir el área útil de la información.",
        measuredRatio: areaRatio,
      });
    }
    if (Number.isFinite(item.leftColumnRatio) && Number.isFinite(item.rightColumnRatio) &&
        !mobile && item.leftColumnRatio > 0 && item.rightColumnRatio > 0 &&
        item.leftColumnRatio / item.rightColumnRatio > 1.85 && item.rightContentDensity > 0.65) {
      findings.push({
        code: "PRODUCT_DETAIL_COLUMN_IMBALANCE",
        severity: "low",
        blocking: false,
        element: item.selector || ".dialog-layout",
        message: "La ficha concentra contenido en una columna y deja la otra con menor densidad visual",
        evidence: `Proporción de columnas ${item.leftColumnRatio}:${item.rightColumnRatio}; densidad estimada de la columna informativa ${Math.round(item.rightContentDensity * 100)}%.`,
        recommendation: "Revisar conjuntamente el tamaño visible del producto, el ancho de las columnas y la agrupación de información. Dar protagonismo a la fotografía y conservar legibles las características, variantes y acciones de contacto.",
      });
    }
  }
  return findings;
}
