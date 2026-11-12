import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const admin = readFileSync(new URL("../admin.js", import.meta.url), "utf8");

test("editor dirty state requires both a changed snapshot and meaningful user content", () => {
  assert.match(admin, /const snapshotChanged = getEditorSnapshot\(\) !== editorBaseline/);
  assert.match(admin, /editorIsDirty = snapshotChanged && hasMeaningfulEditorContent\(\)/);
});

test("catalog switching prompts only when meaningful content would be discarded", () => {
  assert.match(admin, /const hasDiscardableContent = editorIsDirty && hasMeaningfulEditorContent\(\)/);
  assert.match(admin, /if \(hasDiscardableContent\) \{/);
  assert.match(admin, /Hay cambios sin guardar en el formulario/);
});

test("the form switcher and auto-generated product selectors are excluded from meaningful input", () => {
  assert.match(admin, /field\.id === "product-catalog-type"/);
  assert.match(admin, /#product-perfume-fields, #product-price-usd-field, #product-price-nio-field/);
  assert.match(admin, /activeCatalogType !== "perfumery"[\s\S]*#product-perfume-fields/);
  assert.match(admin, /activeCatalogType === "perfumery"[\s\S]*#product-category-field/);
});

test("photos, custom tags and existing product edits are still protected from accidental loss", () => {
  assert.match(admin, /existingRecord: Boolean\(String\(\$\("#product-id"\)/);
  assert.match(admin, /imageCount,/);
  assert.match(admin, /customTagCount: Array\.isArray\(customProductTags\)/);
});
