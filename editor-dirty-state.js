const TEXT_INPUT_KINDS = new Set([
  "text", "textarea", "search", "number", "email", "url", "tel", "date", "month", "time"
]);

/**
 * Decide whether switching product catalogs would discard real user-entered
 * content. DOM defaults and automatically selected first options are not data.
 */
export function hasMeaningfulEditorInput(fields = [], {
  existingRecord = false,
  imageCount = 0,
  customTagCount = 0
} = {}) {
  if (existingRecord || Number(imageCount) > 0 || Number(customTagCount) > 0) return true;
  if (!Array.isArray(fields)) return false;

  return fields.some(field => {
    if (!field || field.ignored || field.disabled || field.hidden) return false;

    const kind = String(field.kind || "").toLowerCase();
    if (TEXT_INPUT_KINDS.has(kind)) {
      return String(field.value ?? "").trim().length > 0;
    }

    if (kind === "select") {
      return Number(field.selectedIndex) > 0 && String(field.value ?? "").trim().length > 0;
    }

    if (kind === "checkbox" || kind === "radio") {
      return field.checked !== field.defaultChecked;
    }

    if (kind === "file") {
      return Number(field.fileCount) > 0;
    }

    if (kind === "color") {
      const value = String(field.value ?? "").trim().toLowerCase();
      const defaultValue = String(field.defaultValue || "#000000").trim().toLowerCase();
      return Boolean(value) && value !== defaultValue;
    }

    return false;
  });
}
