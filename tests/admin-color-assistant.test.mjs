import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const adminJs = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
const adminHtml = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const themeCss = readFileSync(new URL("../theme-ui.css", import.meta.url), "utf8");

test("variant color controls add AI/photo assistance without removing palette tools", () => {
  assert.match(adminJs, /data-ai-color-open/);
  assert.match(adminJs, /data-save-color-library/);
  assert.match(adminJs, /data-variant-swatch/);
  assert.match(adminJs, /\/api\/color-assistant/);
  assert.match(adminJs, /access_token/);
  assert.match(adminJs, /applyColorToRow\(row,colorResult\)/);
  assert.match(adminJs, /officialVerified/);
  assert.match(themeCss, /\.jb-color-ai-overlay\s*\{/);
  assert.match(themeCss, /html\[data-theme="dark"\] body\.admin-body \.jb-color-ai-dialog/);
  assert.match(adminHtml, /admin\.js\?v=20261027-shared-ai-color-library1/);
});

test("shared color library uses the authenticated Supabase client", () => {
  assert.match(adminJs, /from\("color_library"\)/);
  assert.match(adminJs, /syncSharedColorLibrary\(\{migrateLocal:true\}\)/);
  assert.match(adminJs, /onConflict:"name_key"/);
});

test("mobile color dialog height declaration has balanced calc parentheses", () => {
  assert.match(themeCss, /max-height:calc\(100dvh - max\(16px,env\(safe-area-inset-top,0px\)\) - max\(16px,env\(safe-area-inset-bottom,0px\)\)\)/);
});
