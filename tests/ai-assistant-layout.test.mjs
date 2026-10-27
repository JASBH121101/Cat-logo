import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const aiCss = readFileSync(new URL("../ai-assistant.css", import.meta.url), "utf8");
const themeCss = readFileSync(new URL("../theme-ui.css", import.meta.url), "utf8");
const aiJs = readFileSync(new URL("../ai-assistant.js", import.meta.url), "utf8");
const assistantApi = readFileSync(new URL("../functions/api/assistant.js", import.meta.url), "utf8");

test("AI launcher stays above the fixed back-to-top button on desktop", () => {
  const aiRoot = aiCss.match(/\.jb-ai-advisor\s*\{([^}]+)\}/);
  assert.ok(aiRoot, "AI advisor root rule exists");
  assert.match(aiRoot[1], /bottom:\s*calc\(23px\s*\+\s*48px\s*\+\s*14px\)/);

  const topButton = themeCss.match(/\.back-to-top\s*\{([^}]+)\}/);
  assert.ok(topButton, "back-to-top rule exists");
  assert.match(topButton[1], /bottom:\s*23px/);
  assert.match(topButton[1], /width:\s*48px/);
  assert.match(topButton[1], /height:\s*48px/);
});

test("AI launcher reserves the same clearance on narrow mobile screens and respects safe areas", () => {
  const mobile = aiCss.match(/@media\s*\(max-width:\s*520px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(mobile, "mobile breakpoint exists");
  assert.match(
    mobile[1],
    /bottom:\s*calc\(max\(23px,\s*env\(safe-area-inset-bottom,\s*0px\)\)\s*\+\s*48px\s*\+\s*14px\)/
  );
  assert.match(mobile[1], /right:\s*max\(12px,\s*env\(safe-area-inset-right,\s*0px\)\)/);
});


test("AI conversation remembers preferences only for the current browser tab session", () => {
  assert.match(aiJs, /sessionStorageKey\s*=\s*"jb-ai-conversation-v2"/);
  assert.match(aiJs, /window\.sessionStorage\.getItem\(sessionStorageKey/);
  assert.match(aiJs, /window\.sessionStorage\.setItem\(sessionStorageKey/);
  assert.match(aiJs, /class="jb-ai-reset"/);
  assert.match(aiJs, /function resetConversation\(\)/);
  assert.match(aiJs, /history\.length\s*=\s*0/);
});

test("AI does not duplicate the current question inside the history sent to the model", () => {
  const contextIndex = aiJs.indexOf("const previousHistory = history.slice(-maxHistory)");
  const pushIndex = aiJs.indexOf('history.push({ role: "user", content: cleanMessage })');
  assert.ok(contextIndex >= 0, "previous history is created");
  assert.ok(pushIndex > contextIndex, "prior history is captured before the current message is appended");
  assert.match(aiJs, /content: String\(item\.content \|\| ""\)\.slice\(0, 450\)/);
});

test("AI response schema provides evidence-based reasons and only allows catalogue product IDs", () => {
  assert.match(assistantApi, /const RESPONSE_FORMAT = \{/);
  assert.match(assistantApi, /reason: \{ type: "string" \}/);
  assert.match(assistantApi, /const allowedIds = new Set\(contextProducts\.map/);
  assert.match(assistantApi, /image_url:safeImageUrl\(row\.image_url\)/);
  assert.match(aiCss, /\.jb-ai-product-reason\s*\{/);
  assert.match(aiCss, /\.jb-ai-product-media\s*\{/);
});


test("technology recommendations support side-by-side comparison and AI-assisted evaluation", () => {
  assert.match(aiJs, /jb-ai-compare-toggle/);
  assert.match(aiJs, /function renderEquipmentComparison\(/);
  assert.match(aiJs, /Comparación de equipos/);
  assert.match(aiJs, /Comparar con IA/);
  assert.match(aiJs, /Consultar ambos por WhatsApp/);
  assert.match(aiJs, /comparisonIds: Array\.isArray\(options\.comparisonIds\)/);
  assert.match(aiCss, /\.jb-ai-compare-table\s*\{/);
  assert.match(aiCss, /\.jb-ai-compare-scroll\s*\{/);
  assert.match(assistantApi, /request_mode: isComparisonRequest/);
  assert.match(assistantApi, /comparison_products_unavailable/);
  assert.match(assistantApi, /COMPARACIÓN DE EQUIPOS/);
});

test("comparison requests are restricted to two distinct published technology product IDs", () => {
  assert.match(assistantApi, /rawComparisonIds\.length !== 2/);
  assert.match(assistantApi, /comparisonIds\.length !== 2/);
  assert.match(assistantApi, /product\.catalog_type === "technology"/);
  assert.match(assistantApi, /Equipo seleccionado para esta comparación/);
});


test("payment-options CTA keeps readable contrast in light and dark themes", () => {
  const techVisual = readFileSync(new URL("../technology-visual-refresh.css", import.meta.url), "utf8");
  assert.match(techVisual, /\.product-contact-actions\s*>\s*#dialog-payment-options-toggle\.dialog-payment-toggle\s*\{/);
  assert.match(techVisual, /color:\s*#17305f;/);
  assert.match(techVisual, /-webkit-text-fill-color:\s*#17305f;/);
  assert.match(techVisual, /html\[data-theme="dark"\]\s+body\.technology-catalog\s+\.product-contact-actions\s*>\s*#dialog-payment-options-toggle\.dialog-payment-toggle\s*\{/);
  assert.match(techVisual, /color:\s*#e8f2ff;/);
  assert.match(techVisual, /:focus-visible\s*\{/);
});
