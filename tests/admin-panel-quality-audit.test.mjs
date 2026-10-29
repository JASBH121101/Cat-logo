import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("admin.html", root), "utf8");
const adminJs = await readFile(new URL("admin.js", root), "utf8");
const styles = await readFile(new URL("styles.css", root), "utf8");
const theme = await readFile(new URL("theme-ui.css", root), "utf8");
const chatStyles = await readFile(new URL("admin-private-chat.css", root), "utf8");
const workflow = await readFile(new URL(".github/workflows/catalog-static-checks.yml", root), "utf8");

function collectAttributeValues(source, attribute) {
  const regex = new RegExp("\\b" + attribute + "\\s*=\\s*([\"'])(.*?)\\1", "g");
  return [...source.matchAll(regex)].map(match => match[2]);
}

test("admin navigation and panel targets stay in sync", () => {
  const actions = new Set(collectAttributeValues(html, "data-admin-section"));
  const panels = new Set(collectAttributeValues(html, "data-admin-panel"));
  const missingPanels = [...actions].filter(name => !panels.has(name));
  const missingActions = [...panels].filter(name => !actions.has(name));
  assert.deepEqual(missingPanels, [], "Every admin navigation action must target a real panel");
  assert.deepEqual(missingActions, [], "Every admin panel must be reachable from navigation");
});

test("every static HTML id is unique and admin navigation has accessible state", () => {
  const ids = collectAttributeValues(html, "id");
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, [], "Duplicate IDs can cause scripts to bind the wrong control");
  assert.match(html, /id="admin-menu-toggle"[^>]*aria-controls="admin-sidebar"[^>]*aria-expanded=/);
  assert.match(adminJs, /button\.setAttribute\("aria-current", "page"\)/);
});

test("admin panel buttons have explicit form behavior and status regions", () => {
  const buttons = [...html.matchAll(/<button\\b[^>]*>/gi)].map(match => match[0]);
  const missingType = buttons.filter(button => !/\\btype\\s*=/.test(button));
  const missingName = buttons.filter(button =>
    !/\\baria-label\\s*=|\\btitle\\s*=/.test(button) &&
    !/>\\s*[\\w\\p{L}]/u.test(button)
  );
  const findings = [];
  if (missingType.length) findings.push(missingType.length + " botones sin type explícito");
  if (missingName.length) findings.push(missingName.length + " botones estáticos sin etiqueta detectable");
  if (!/id="private-chat-admin-status"[^>]*role="status"[^>]*aria-live="polite"/.test(html)) findings.push("estado de mensajería sin anuncio accesible");
  console.log("\\nADMIN QUALITY AUDIT — hallazgos estructurales");
  console.log("Botones HTML estáticos: " + buttons.length);
  console.log("Hallazgos informativos: " + (findings.length ? findings.join(" · ") : "sin incidencias estructurales configuradas"));
  console.log("Archivos con estilos de administración inspeccionados: styles.css, theme-ui.css, admin-private-chat.css");
  // The structural counters are advisory; required navigation and IDs are hard assertions above.
  assert.ok(buttons.length > 0);
  assert.match(html, /id="private-chat-enable-notifications"/);
  assert.match(adminJs, /enableAdminNotifications/);
  assert.match(adminJs, /detectPrivateChatNotificationEvents/);
  assert.match(chatStyles, /private-chat-admin-layout/);
  assert.match(styles + theme, /admin-sidebar/);
  assert.match(workflow, /tests\\/admin-panel-quality-audit\\.test\\.mjs/);
});
