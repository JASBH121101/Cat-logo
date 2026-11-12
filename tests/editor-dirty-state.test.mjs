import assert from "node:assert/strict";
import test from "node:test";
import { hasMeaningfulEditorInput } from "../editor-dirty-state.js";

test("an empty technology form does not contain unsaved user data", () => {
  assert.equal(hasMeaningfulEditorInput([
    { kind: "text", value: "   " },
    { kind: "textarea", value: "" },
    { kind: "number", value: "" },
    { kind: "select", value: "technology", selectedIndex: 0 },
    { kind: "select", value: "available", selectedIndex: 0 },
    { kind: "checkbox", checked: false, defaultChecked: false },
    { kind: "ignored", ignored: true }
  ]), false);
});

test("an empty perfumery form ignores automatic product type and the default Perfumería category", () => {
  assert.equal(hasMeaningfulEditorInput([
    { kind: "ignored", ignored: true }, // product-type default
    { kind: "select", value: "Perfumería", selectedIndex: 0 }, // generated category default
    { kind: "select", value: "", selectedIndex: 0 }, // perfume family placeholder
    { kind: "select", value: "", selectedIndex: 0 }, // concentration placeholder
    { kind: "text", value: "" },
    { kind: "textarea", value: " \n " }
  ]), false);
});

test("actual text or textarea content makes the editor meaningful", () => {
  assert.equal(hasMeaningfulEditorInput([{ kind: "text", value: "   Chanel   " }]), true);
  assert.equal(hasMeaningfulEditorInput([{ kind: "textarea", value: "Notas cítricas" }]), true);
});

test("user-selected category, availability, and perfume details count as meaningful input", () => {
  assert.equal(hasMeaningfulEditorInput([{ kind: "select", value: "Celulares", selectedIndex: 1 }]), true);
  assert.equal(hasMeaningfulEditorInput([{ kind: "select", value: "arabes", selectedIndex: 1 }]), true);
});

test("hidden, disabled and automatically generated controls do not create false dirty state", () => {
  assert.equal(hasMeaningfulEditorInput([
    { kind: "text", value: "stale", hidden: true },
    { kind: "text", value: "disabled", disabled: true },
    { kind: "checkbox", checked: true, defaultChecked: true },
    { kind: "color", value: "#000000", defaultValue: "#000000" }
  ]), false);
});

test("real checkbox changes, selected files and chosen colors count as content", () => {
  assert.equal(hasMeaningfulEditorInput([{ kind: "checkbox", checked: true, defaultChecked: false }]), true);
  assert.equal(hasMeaningfulEditorInput([{ kind: "file", fileCount: 1 }]), true);
  assert.equal(hasMeaningfulEditorInput([{ kind: "color", value: "#1a2b3c", defaultValue: "#000000" }]), true);
});

test("existing product edits, selected photos and custom tags remain protected", () => {
  assert.equal(hasMeaningfulEditorInput([], { existingRecord: true }), true);
  assert.equal(hasMeaningfulEditorInput([], { imageCount: 1 }), true);
  assert.equal(hasMeaningfulEditorInput([], { customTagCount: 1 }), true);
});

test("blank new product forms are not warned about just because DOM defaults differ", () => {
  const generatedDefaults = [
    { kind: "select", value: "standard", selectedIndex: 0 },
    { kind: "select", value: "Perfumería", selectedIndex: 0 },
    { kind: "checkbox", checked: false, defaultChecked: false },
    { kind: "text", value: "" }
  ];
  assert.equal(hasMeaningfulEditorInput(generatedDefaults), false);
});


test("a deliberate perfume-set selection counts as user input but the default perfume type does not", () => {
  assert.equal(hasMeaningfulEditorInput([{ kind: "select", value: "perfume", selectedIndex: 0 }]), false);
  assert.equal(hasMeaningfulEditorInput([{ kind: "select", value: "set", selectedIndex: 1 }]), true);
});

test("unchecking a control that was checked by default counts as an explicit change", () => {
  assert.equal(hasMeaningfulEditorInput([{ kind: "checkbox", checked: false, defaultChecked: true }]), true);
});
