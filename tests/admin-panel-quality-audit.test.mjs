import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import test from "node:test";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("admin.html", root), "utf8");
const adminJs = await readFile(new URL("admin.js", root), "utf8");
const styles = await readFile(new URL("styles.css", root), "utf8");
const theme = await readFile(new URL("theme-ui.css", root), "utf8");
const chatStyles = await readFile(new URL("admin-private-chat.css", root), "utf8");
const workflow = await readFile(new URL(".github/workflows/catalog-static-checks.yml", root), "utf8");

function attrValues(source, attribute) {
  const regex = new RegExp("\\b" + attribute + "\\s*=\\s*([\\"'])(.*?)\\1", "g");
  return [...source.matchAll(regex)].map(match => match[2]);
}

test("complete admin panel audit validates navigation, accessibility signals and responsive geometry", { timeout: 90000 }, async () => {
  const findings = [];
  const actions = new Set(attrValues(html, "data-admin-section"));
  const panels = new Set(attrValues(html, "data-admin-panel"));
  const ids = attrValues(html, "id");
  const missingPanels = [...actions].filter(name => !panels.has(name));
  const missingActions = [...panels].filter(name => !actions.has(name));
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

  assert.deepEqual(missingPanels, [], "Every admin navigation action must target a real panel");
  assert.deepEqual(missingActions, [], "Every admin panel must be reachable from navigation");
  assert.deepEqual(duplicateIds, [], "Duplicate IDs can cause scripts to bind the wrong control");
  assert.match(html, /id="admin-menu-toggle"[^>]*aria-controls="admin-sidebar"[^>]*aria-expanded=/);
  assert.match(html, /id="private-chat-enable-notifications"/);
  assert.match(adminJs, /enableAdminNotifications/);
  assert.match(adminJs, /detectPrivateChatNotificationEvents/);
  assert.match(adminJs, /button\.setAttribute\("aria-current", "page"\)/);
  assert.match(chatStyles, /private-chat-admin-layout/);
  assert.match(styles + theme, /admin-sidebar/);
  assert.match(workflow, /tests\/admin-panel-quality-audit\.test\.mjs/);

  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)]
    .map(match => ({ attributes: match[1], inner: match[2] }));
  const missingType = buttons.filter(button => !/\btype\s*=/.test(button.attributes));
  const missingButtonName = buttons.filter(button =>
    !/\baria-label\s*=|\btitle\s*=/.test(button.attributes) &&
    !button.inner.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").trim()
  );
  const controls = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)]
    .map(match => ({ tag: match[1].toLowerCase(), attributes: match[2] }))
    .filter(control => !/\btype\s*=\s*["']?hidden\b/i.test(control.attributes));
  const labelledFor = new Set([...html.matchAll(/<label\b[^>]*\bfor=["']([^"']+)["']/gi)].map(match => match[1]));
  const unlabeledControls = controls.filter(control => {
    const id = control.attributes.match(/\bid=["']([^"']+)["']/i)?.[1];
    const escapedId = id ? id.replace(/[.*+?^$()|[\]\\]/g, "\\$&") : "";
    const nestedLabel = id && new RegExp("<label\\b[^>]*>[\\s\\S]*?\\bid=[\\"']" + escapedId + "[\\"'][\\s\\S]*?<\\/label>", "i").test(html);
    return !/\baria-label\s*=|\baria-labelledby\s*=|\btitle\s*=/.test(control.attributes) &&
      !(id && labelledFor.has(id)) && !nestedLabel;
  });
  const images = [...html.matchAll(/<img\b([^>]*)>/gi)].map(match => match[1]);
  const missingAlt = images.filter(attributes => !/\balt\s*=/.test(attributes));
  if (missingType.length) findings.push({ priority: "media", page: "Panel completo", evidence: missingType.length + " botones sin type explícito", recommendation: "Definir type=button o type=submit para evitar envíos accidentales." });
  if (missingButtonName.length) findings.push({ priority: "media", page: "Panel completo", evidence: missingButtonName.length + " botones sin nombre accesible detectable en el HTML estático", recommendation: "Añadir texto, aria-label o title descriptivo a los controles, especialmente los de solo icono." });
  if (unlabeledControls.length) findings.push({ priority: "media", page: "Panel completo", evidence: unlabeledControls.length + " campos sin etiqueta detectable", recommendation: "Asociar cada campo con label, aria-label o aria-labelledby." });
  if (missingAlt.length) findings.push({ priority: "baja", page: "Panel completo", evidence: missingAlt.length + " imágenes sin atributo alt", recommendation: "Añadir alt descriptivo a imágenes informativas y alt vacío explícito para las decorativas." });

  const widths = [{ width: 360, label: "móvil 360 px" }, { width: 390, label: "móvil 390 px" }, { width: 430, label: "móvil 430 px" }, { width: 1280, label: "escritorio 1280 px" }];
  const measurements = [];
  const pageErrors = [];
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(new URL("../admin.html", import.meta.url).href, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      document.getElementById("login-panel")?.classList.add("hidden");
      document.getElementById("dashboard")?.classList.remove("hidden");
    });

    for (const panelName of panels) {
      for (const viewport of widths) {
        await page.setViewportSize({ width: viewport.width, height: 844 });
        await page.evaluate(name => {
          document.querySelectorAll("[data-admin-panel]").forEach(panel => {
            panel.classList.toggle("hidden", panel.dataset.adminPanel !== name);
          });
        }, panelName);
        await page.waitForTimeout(25);
        const measurement = await page.evaluate(() => {
          const panel = [...document.querySelectorAll("[data-admin-panel]")].find(item => !item.classList.contains("hidden"));
          const visible = element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          };
          const width = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
          const viewportWidth = window.innerWidth;
          const offenders = [...document.querySelectorAll("body *")].filter(element => {
            const rect = element.getBoundingClientRect();
            return visible(element) && rect.right > viewportWidth + 2;
          }).slice(0, 4).map(element => ({
            selector: element.tagName.toLowerCase() + (element.id ? "#" + element.id : "") +
              (typeof element.className === "string" && element.className.trim() ? "." + element.className.trim().split(/\s+/).slice(0, 2).join(".") : ""),
            right: Math.round(element.getBoundingClientRect().right),
          }));
          return {
            viewportWidth,
            documentWidth: width,
            horizontalOverflow: Math.max(0, width - viewportWidth),
            panelVisible: Boolean(panel && visible(panel)),
            visibleControls: panel ? [...panel.querySelectorAll("button,a,input,select,textarea,[role=button]")].filter(visible).length : 0,
            offenders,
          };
        });
        measurements.push({ panel: panelName, viewport: viewport.label, ...measurement });
      }
    }
    await page.close();
  } finally {
    await browser.close();
  }

  for (const measurement of measurements) {
    if (measurement.panelVisible && measurement.horizontalOverflow > 2 && measurement.viewport !== "escritorio 1280 px") {
      findings.push({
        priority: measurement.horizontalOverflow >= 20 ? "alta" : "media",
        page: measurement.panel,
        evidence: "Desbordamiento horizontal de " + measurement.horizontalOverflow + " px en " + measurement.viewport,
        recommendation: "Revisar min-width, grid/flex, padding y textos largos; corregir el elemento causante en vez de ocultar el desbordamiento.",
      });
    }
    if (!measurement.panelVisible) {
      findings.push({ priority: "media", page: measurement.panel, evidence: "El panel no quedó visible durante la simulación responsive", recommendation: "Revisar clases de visibilidad y correspondencia entre navegación y panel." });
    }
  }

  const rank = { alta: 3, media: 2, baja: 1 };
  findings.sort((a, b) => rank[b.priority] - rank[a.priority]);
  const reportLines = [
    "# Informe de auditoría de JB Manager", "",
    "Revisión heurística. La prueba simula la estructura de administración sin iniciar sesión ni modificar Supabase.", "",
    "## Cobertura", "",
    "- Paneles inspeccionados: " + panels.size,
    "- Botones estáticos: " + buttons.length + "; campos: " + controls.length,
    "- Mediciones responsive: " + measurements.length,
    "- Viewports: 360, 390, 430 y 1280 px",
    "- Errores de JS al cargar: " + pageErrors.length + (pageErrors.length ? " (pueden incluir restricciones de file:// al cargar módulos externos)" : ""), "",
    "## Hallazgos priorizados", "",
    ...(findings.length ? findings.map((finding, index) =>
      (index + 1) + ". **[" + finding.priority.toUpperCase() + "] " + finding.page + "** — " + finding.evidence + "\n   - Recomendación: " + finding.recommendation
    ) : ["No se detectaron los problemas configurados. Esto no sustituye la revisión visual ni la prueba con una sesión administrativa real."]),
    "", "## Geometría por panel", "",
    "| Panel | Viewport | Ancho documento | Desbordamiento | Controles visibles |",
    "|---|---|---:|---:|---:|",
    ...measurements.map(m => "| " + m.panel + " | " + m.viewport + " | " + m.documentWidth + " px | " + m.horizontalOverflow + " px | " + m.visibleControls + " |"),
    "", "## Limitaciones", "",
    "- Los formularios autenticados y las mutaciones no se ejecutaron para proteger los datos reales.",
    "- Las alertas dependen de permisos y soporte del navegador.",
    "- Las notificaciones con el navegador y el panel cerrados requieren una infraestructura Web Push, no incluida en esta prueba.", ""
  ];
  const report = reportLines.join("\n");
  await writeFile(new URL("../admin-quality-audit.md", import.meta.url), report, "utf8");

  console.log("\nADMIN QUALITY AUDIT — resumen");
  console.log("Paneles: " + panels.size + " · mediciones responsive: " + measurements.length);
  console.log("Hallazgos: " + findings.length + " · informe generado en admin-quality-audit.md");
  for (const finding of findings.slice(0, 25)) {
    console.log("[" + finding.priority.toUpperCase() + "] " + finding.page + " — " + finding.evidence);
    console.log("  Recomendación: " + finding.recommendation);
  }
  assert.ok(panels.size > 0);
  assert.equal(measurements.length, panels.size * widths.length);
});
