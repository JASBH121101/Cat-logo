import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const aiCss = readFileSync(new URL("../ai-assistant.css", import.meta.url), "utf8");
const themeCss = readFileSync(new URL("../theme-ui.css", import.meta.url), "utf8");

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
