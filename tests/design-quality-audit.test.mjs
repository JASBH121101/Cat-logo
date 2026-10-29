import assert from "node:assert/strict";
import { chromium } from "playwright";
import test from "node:test";

const pages = [
  { name: "Portada", path: "../index.html" },
  { name: "JB TECH", path: "../tecnologia/index.html" },
  { name: "JB Parfums", path: "../perfumeria/index.html" },
];

const viewports = [
  { width: 360, height: 800, label: "móvil pequeño" },
  { width: 390, height: 844, label: "móvil habitual" },
  { width: 430, height: 932, label: "móvil grande" },
  { width: 1280, height: 900, label: "escritorio" },
];

test("Design quality audit reports measurable UX risks and actionable improvements", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const findings = [];
  const measurements = [];

  try {
    for (const target of pages) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(new URL(target.path, import.meta.url).href, { waitUntil: "domcontentloaded" });

      const baseline = await page.evaluate(() => {
        const visible = element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" &&
            Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
        };
        const nameOf = element => (
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.innerText ||
          element.textContent ||
          element.querySelector("img")?.getAttribute("alt") ||
          ""
        ).trim();
        const controls = [...document.querySelectorAll("a,button,[role=button],input[type=button],input[type=submit]")].filter(visible);
        const images = [...document.images].filter(visible);
        const textNodes = [...document.querySelectorAll("h1,h2,h3,p,a,button,label,li")].filter(visible);
        const lowText = textNodes.filter(el => {
          const size = parseFloat(getComputedStyle(el).fontSize);
          return Number.isFinite(size) && size < 12 && (el.innerText || el.textContent || "").trim().length > 2;
        });
        const tinyTargets = controls.filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width < 36 || rect.height < 36;
        });
        const unnamedControls = controls.filter(el => !nameOf(el));
        const missingAlt = images.filter(img => !img.hasAttribute("alt"));
        const repeatedLabels = new Map();
        for (const control of controls) {
          const label = nameOf(control).replace(/\s+/g, " ").trim().toLocaleLowerCase("es");
          if (label.length > 0 && label.length < 70) repeatedLabels.set(label, (repeatedLabels.get(label) || 0) + 1);
        }
        const duplicateActionLabels = [...repeatedLabels].filter(([label, count]) => count >= 4 && !/^(ver|más|\+|−|×|menu|menú)$/.test(label));
        const brokenImages = images.filter(img => img.complete && img.naturalWidth === 0 && !img.src.startsWith("data:"));
        const headings = [...document.querySelectorAll("h1")].filter(visible);
        return {
          title: document.title,
          h1Count: headings.length,
          h1Text: headings.map(h => h.innerText.trim()).filter(Boolean),
          visibleControls: controls.length,
          unnamedControls: unnamedControls.length,
          visibleImages: images.length,
          missingAlt: missingAlt.length,
          brokenImages: brokenImages.length,
          tinyTargets: tinyTargets.length,
          smallTextBlocks: lowText.length,
          duplicateActionLabels: duplicateActionLabels.map(([label, count]) => ({ label, count })),
          fontFamilies: [...new Set(textNodes.map(el => getComputedStyle(el).fontFamily.split(",")[0].replaceAll('"', "").trim()))].filter(Boolean),
        };
      });

      if (baseline.unnamedControls) {
        findings.push({ page: target.name, priority: "alta", evidence: baseline.unnamedControls + " controles visibles sin nombre accesible", suggestion: "Añadir texto visible o aria-label descriptivo a cada botón/enlace; los iconos solos deben anunciar su función." });
      }
      if (baseline.missingAlt) {
        findings.push({ page: target.name, priority: "alta", evidence: baseline.missingAlt + " imágenes visibles sin atributo alt", suggestion: "Añadir alt descriptivo a imágenes informativas y alt vacío (alt=\"\") solo a imágenes decorativas." });
      }
      if (baseline.brokenImages) {
        findings.push({ page: target.name, priority: "alta", evidence: baseline.brokenImages + " imágenes visibles no cargaron al inspeccionar el DOM", suggestion: "Revisar la URL, permisos de almacenamiento, formato y fallback de cada imagen." });
      }
      if (baseline.tinyTargets) {
        findings.push({ page: target.name, priority: "media", evidence: baseline.tinyTargets + " controles visibles menores de 36×36 px", suggestion: "Aumentar el área táctil o añadir padding sin agrandar visualmente el icono; priorizar acciones usadas en móvil." });
      }
      if (baseline.smallTextBlocks) {
        findings.push({ page: target.name, priority: "media", evidence: baseline.smallTextBlocks + " bloques de texto visibles con tamaño menor de 12 px", suggestion: "Revisar si son metadatos secundarios o texto importante; elevar el texto funcional a 12–14 px como mínimo." });
      }
      if (baseline.h1Count !== 1) {
        findings.push({ page: target.name, priority: "media", evidence: "La página tiene " + baseline.h1Count + " encabezados H1 visibles", suggestion: "Definir un H1 principal por página y organizar las secciones con H2/H3 para reforzar jerarquía y comprensión." });
      }
      for (const item of baseline.duplicateActionLabels) {
        findings.push({ page: target.name, priority: "baja", evidence: "La etiqueta «" + item.label + "» se repite " + item.count + " veces en controles visibles", suggestion: "Comprobar si cada repetición corresponde a la misma acción. Si no, usar etiquetas específicas para que la interfaz se sienta intencional y no repetitiva." });
      }
      if (baseline.fontFamilies.length > 3) {
        findings.push({ page: target.name, priority: "baja", evidence: baseline.fontFamilies.length + " familias tipográficas distintas detectadas en textos visibles", suggestion: "Consolidar la tipografía en una familia principal y una secundaria, salvo que cada marca tenga una razón visual clara para diferenciarse." });
      }

      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.waitForTimeout(80);
        const layout = await page.evaluate(() => ({
          viewport: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
        }));
        measurements.push({ page: target.name, viewport: viewport.label, ...layout });
        if (layout.overflow > 2) {
          findings.push({ page: target.name, priority: "alta", evidence: "Desbordamiento horizontal de " + layout.overflow + " px en " + viewport.width + " px (" + viewport.label + ")", suggestion: "Localizar el elemento que supera el viewport y corregir ancho mínimo, padding, grid/flex o texto largo; no ocultar el fallo con overflow-x:hidden." });
        }
      }

      if (errors.length) {
        findings.push({ page: target.name, priority: "media", evidence: errors.length + " errores JavaScript capturados al cargar", suggestion: "Revisar la consola y corregir los errores que afecten a la experiencia. Verificar primero si ocurren por restricciones de file:// en CI." });
      }
      measurements.push({ page: target.name, viewport: "base", ...baseline });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const weight = { alta: 12, media: 5, baja: 2 };
  const scores = Object.fromEntries(pages.map(({ name }) => {
    const penalty = findings.filter(f => f.page === name).reduce((sum, f) => sum + weight[f.priority], 0);
    return [name, Math.max(0, 100 - penalty)];
  }));

  console.log("\nDISEÑO / UX QUALITY AUDIT — hallazgos medibles");
  console.log("Puntuación heurística orientativa (no es una nota estética ni detector de IA):");
  for (const [name, score] of Object.entries(scores)) console.log("  " + name + ": " + score + "/100");
  console.log("\nHallazgos ordenados por prioridad:");
  if (!findings.length) console.log("  No se detectaron los problemas configurados. Eso no garantiza que el diseño sea bueno: aún hace falta una revisión visual humana.");
  for (const [index, item] of findings.sort((a, b) => weight[b.priority] - weight[a.priority]).entries()) {
    console.log("\n" + (index + 1) + ". [" + item.priority.toUpperCase() + "] " + item.page + " — " + item.evidence);
    console.log("   Siguiente paso: " + item.suggestion);
  }
  console.log("\nCobertura responsive: " + measurements.filter(m => m.viewport !== "base").length + " mediciones entre 360, 390, 430 y 1280 px.");
  console.log("Este informe es consultivo. No se modifica el diseño automáticamente: cada cambio requiere validación para no romper la identidad de JB TECH o JB Parfums.");

  assert.equal(measurements.length, pages.length * (viewports.length + 1), "All public pages and viewport sizes should be audited");
});
