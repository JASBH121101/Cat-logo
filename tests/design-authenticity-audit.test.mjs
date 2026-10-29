import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const files = {
  home: "index.html",
  technology: "tecnologia/index.html",
  perfumery: "perfumeria/index.html",
  technologyCss: "technology-visual-refresh.css",
  homeCss: "collections.css",
  perfumeryCss: "perfumeria.css",
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, readFileSync(new URL("../" + path, import.meta.url), "utf8")])
);

function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const pages = {
  "Portada": visibleText(source.home),
  "JB TECH": visibleText(source.technology),
  "JB Parfums": visibleText(source.perfumery),
};

const genericPhrases = [
  { pattern: /experiencia única/gi, idea: "Cambiar «experiencia única» por una ventaja real: asesoría, selección de productos, entrega o política verificable." },
  { pattern: /lo mejor para ti/gi, idea: "Explicar para quién sirve el producto y qué necesidad resuelve, en vez de decir «lo mejor para ti»." },
  { pattern: /calidad premium/gi, idea: "Sustituir «calidad premium» por materiales, acabados, notas olfativas, garantía u otro dato comprobable." },
  { pattern: /eleva tu estilo/gi, idea: "Usar una descripción concreta y propia de la categoría en lugar de «eleva tu estilo»." },
  { pattern: /innovación y estilo/gi, idea: "Describir una característica concreta del producto en vez de una combinación de palabras promocionales." },
  { pattern: /para todos los gustos/gi, idea: "Nombrar los tipos de producto, aromas, rangos de precio o perfiles a los que se dirige la selección." },
  { pattern: /descubre nuestra colección/gi, idea: "Cambiar el llamado genérico por una acción específica: comparar modelos, revisar notas o consultar disponibilidad." },
  { pattern: /compra con confianza/gi, idea: "Mostrar la razón verificable para confiar: condiciones claras, contacto real, garantía por producto o proceso de entrega." },
];

function buildSuggestions() {
  const suggestions = [];
  const allText = Object.values(pages).join(" ");
  for (const item of genericPhrases) {
    const matches = [...allText.matchAll(item.pattern)];
    if (matches.length) {
      suggestions.push({
        priority: matches.length >= 2 ? "alta" : "media",
        evidence: "Frase genérica detectada " + matches.length + " vez/veces: " + item.pattern.source,
        idea: item.idea,
      });
    }
  }

  const repeatedLines = new Map();
  for (const [page, text] of Object.entries(pages)) {
    const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length >= 35);
    for (const sentence of sentences) {
      const normalized = sentence.toLocaleLowerCase("es").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ");
      if (!repeatedLines.has(normalized)) repeatedLines.set(normalized, { sentence, pages: [] });
      repeatedLines.get(normalized).pages.push(page);
    }
  }
  for (const match of repeatedLines.values()) {
    if (new Set(match.pages).size > 1) {
      suggestions.push({
        priority: "media",
        evidence: "Texto repetido entre páginas: «" + match.sentence.slice(0, 100) + (match.sentence.length > 100 ? "…" : "") + "»",
        idea: "Decidir si el texto compartido cumple una función de marca. Si no, darle a cada catálogo una voz propia y específica.",
      });
    }
  }

  const catalogSpecificity = [
    {
      name: "JB TECH",
      required: [/celulares|smartphones|laptops|tablets/i, /procesador|almacenamiento|garantía|RAM/i],
      idea: "Hacer más visibles los criterios concretos de comparación tecnológica (procesador, RAM, almacenamiento, materiales, batería y garantía real del producto).",
    },
    {
      name: "JB Parfums",
      required: [/perfume|perfumería|fragancia|aroma/i, /notas|familia olfativa|EDP|ml|concentración/i],
      idea: "Dar protagonismo a información propia de perfumería: familia olfativa, notas, concentración, volumen y ocasión de uso cuando esos datos existan.",
    },
  ];
  for (const category of catalogSpecificity) {
    const text = pages[category.name];
    const missing = category.required.filter(re => !re.test(text)).length;
    if (missing) {
      suggestions.push({
        priority: "media",
        evidence: category.name + ": faltan señales textuales de especificidad en " + missing + " grupo(s) de criterios.",
        idea: category.idea,
      });
    }
  }

  const css = source.technologyCss + "\n" + source.homeCss + "\n" + source.perfumeryCss;
  const gradientCount = (css.match(/linear-gradient|radial-gradient/gi) || []).length;
  const pillRadiusCount = (css.match(/border-radius\s*:\s*(?:9999?px|50rem|999%)/gi) || []).length;
  if (gradientCount >= 18) {
    suggestions.push({
      priority: "baja",
      evidence: "Se encontraron " + gradientCount + " declaraciones de gradientes en los CSS revisados.",
      idea: "Revisar si todos los gradientes ayudan a jerarquizar la marca; reservar los más intensos para CTA, acentos o elementos distintivos.",
    });
  }
  if (pillRadiusCount >= 14) {
    suggestions.push({
      priority: "baja",
      evidence: "Se encontraron " + pillRadiusCount + " radios de borde tipo píldora en los CSS revisados.",
      idea: "Diferenciar la forma de botones, filtros, tarjetas y etiquetas. Si todos tienen la misma silueta, la interfaz puede sentirse demasiado uniforme.",
    });
  }

  if (!suggestions.length) {
    suggestions.push({
      priority: "baja",
      evidence: "No se detectaron las frases genéricas configuradas ni repeticiones textuales entre las páginas revisadas.",
      idea: "En una revisión visual humana, comprobar si las fotos, la jerarquía, los espacios y los textos reflejan una selección comercial real y consistente.",
    });
  }
  return suggestions;
}

test("Design authenticity audit produces evidence-based ideas without claiming to detect AI authorship", () => {
  for (const key of ["home", "technology", "perfumery", "technologyCss", "homeCss", "perfumeryCss"]) {
    assert.ok(source[key].length > 0, "Expected source content for " + files[key]);
  }
  assert.match(pages["JB TECH"], /celulares|smartphones|laptops|tablets/i, "technology page should retain its category identity");
  assert.match(pages["JB Parfums"], /perfume|perfumería|fragancia|aroma/i, "perfumery page should retain its category identity");

  const suggestions = buildSuggestions();
  console.log("\nDESIGN AUTHENTICITY AUDIT — suggestions for human review");
  console.log("This is a heuristic design/copy audit, not an AI-authorship detector.");
  for (const [index, item] of suggestions.entries()) {
    console.log("\n" + (index + 1) + ". [" + item.priority.toUpperCase() + "] " + item.evidence);
    console.log("   Idea: " + item.idea);
  }
  console.log("\nSuggestions are advisory; a person decides what fits the JB Collections brand.");
  assert.ok(suggestions.length > 0, "The audit should always return at least one actionable review idea.");
});
