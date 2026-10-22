import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* =========================================================
   CT ADMINISTRACIÓN
   Sesión temporal por pestaña + inventario + variantes
   ========================================================= */

const CONFIG = window.CATALOG_CONFIG || {};

const configured = Boolean(
  CONFIG.supabaseUrl &&
  CONFIG.supabaseAnonKey &&
  !String(CONFIG.supabaseUrl).includes("PON_AQUI") &&
  !String(CONFIG.supabaseAnonKey).includes("PON_AQUI")
);

/*
  sessionStorage conserva la sesión durante la vida de la pestaña.
  Al cerrar la pestaña, el almacenamiento de esa sesión desaparece.
*/
/*
  Una recarga confirmada cierra la sesión de administración.
  Si hay cambios en el formulario, beforeunload permite al navegador
  preguntar primero; si el usuario cancela, la página no se recarga.
*/
const isPageReload = (() => {
  try {
    return performance.getEntriesByType("navigation")[0]?.type === "reload";
  } catch {
    return false;
  }
})();

if (isPageReload) {
  try {
    const projectRef = new URL(CONFIG.supabaseUrl).hostname.split(".")[0];
    const key = `sb-${projectRef}-auth-token`;
    window.sessionStorage.removeItem(key);
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn("No se pudo limpiar la sesión durante la recarga.", error);
  }
}

const supabase = configured
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: {
        storage: window.sessionStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

const $ = selector => document.querySelector(selector);

/* Mostrar u ocultar la contraseña sin modificar el valor del campo. */
const passwordInput = $("#login-password");
const passwordVisibilityButton = $("#toggle-password-visibility");

passwordVisibilityButton?.addEventListener("click", () => {
  if (!passwordInput) return;
  const reveal = passwordInput.type === "password";
  passwordInput.type = reveal ? "text" : "password";
  passwordVisibilityButton.setAttribute("aria-label", reveal ? "Ocultar contraseña" : "Mostrar contraseña");
  passwordVisibilityButton.setAttribute("title", reveal ? "Ocultar contraseña" : "Mostrar contraseña");
  passwordVisibilityButton.setAttribute("aria-pressed", String(reveal));
  passwordVisibilityButton.innerHTML = reveal
    ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.8 10.8 0 0112 5c6.4 0 10 7 10 7a16 16 0 01-3.1 3.9M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10 10 0 004-.8"></path></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
});

const loginPanel = $("#login-panel");
const dashboard = $("#dashboard");
const form = $("#product-form");

let currentUser = null;
let products = [];

const COLOR_PALETTE = [
  { name: "Negro", hex: "#242424" },
  { name: "Blanco", hex: "#F4F4F4" },
  { name: "Plata", hex: "#C5C9D0" },
  { name: "Gris", hex: "#777E8B" },
  { name: "Grafito", hex: "#454952" },
  { name: "Azul", hex: "#315A91" },
  { name: "Azul claro", hex: "#78A9E8" },
  { name: "Verde", hex: "#39785A" },
  { name: "Verde menta", hex: "#8ECDB8" },
  { name: "Dorado", hex: "#C8A45D" },
  { name: "Champán", hex: "#D8C3A0" },
  { name: "Morado", hex: "#7952A8" },
  { name: "Rosa", hex: "#D986A7" },
  { name: "Rojo", hex: "#C13A4B" },
  { name: "Naranja", hex: "#DE783E" },
  { name: "Amarillo", hex: "#E8C94B" }
];

/* =========================================================
   UTILIDADES GENERALES
   ========================================================= */

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function message(selector, text, type = "") {
  const node = typeof selector === "string"
    ? $(selector)
    : selector;

  if (!node) return;

  node.textContent = text;
  node.className = `form-status${type ? ` ${type}` : ""}`;
}

function setStatus(text, type = "") {
  const node = $("#admin-status");
  if (!node) return;

  node.textContent = text;

  node.style.color =
    type === "error" ? "#b42318" :
    type === "success" ? "#087f5b" :
    "";
}

function slugify(value) {
  return String(value || "producto")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90) || "producto";
}

function parseJSON(value, fallback) {
  if (typeof value !== "string") {
    return value ?? fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function validHex(value, fallback = "#315A91") {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || ""))
    ? value
    : fallback;
}

function toOptionalNumber(value, label) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new Error(
      `${label} debe ser un número igual o mayor que cero.`
    );
  }

  return number;
}

/*
  Valores válidos para public.products.availability:
  available, on_order, out_of_stock.
*/
function normalizeProductAvailability(value) {
  const normalized = String(value || "")
    .trim()
    .toLocaleLowerCase("es");

  if (
    ["out_of_stock", "agotado temporalmente", "agotado"]
      .includes(normalized)
  ) {
    return "out_of_stock";
  }

  if (["on_order", "por pedido"].includes(normalized)) {
    return "on_order";
  }

  return "available";
}

function normalizeVariantAvailability(value) {
 const v=String(value||"").trim().toLocaleLowerCase("es");
 if(["order","on_order","por pedido"].includes(v))return "order";
 if(["out_of_stock","unavailable","no disponible","agotado"].includes(v))return "out_of_stock";
 return "available";
}

/* =========================================================
   SESIÓN: ALMACENAMIENTO TEMPORAL POR PESTAÑA
   ========================================================= */

/*
  Supabase utiliza por defecto una clave parecida a:
  sb-<project-ref>-auth-token

  Eliminamos una posible sesión antigua almacenada en localStorage
  por una versión anterior del panel.
*/

function authStorageKey() {
  try {
    const projectRef = new URL(CONFIG.supabaseUrl)
      .hostname
      .split(".")[0];

    return `sb-${projectRef}-auth-token`;
  } catch {
    return null;
  }
}

function clearLegacyPersistentAuth() {
  try {
    const key = authStorageKey();

    if (key) {
      window.localStorage.removeItem(key);
    }
  } catch (error) {
    console.warn(
      "No se pudo limpiar una sesión persistente anterior.",
      error
    );
  }
}

/* No ejecuta nada si Supabase no está configurado. */
clearLegacyPersistentAuth();

function clearLocalAuthStorage() {
  try {
    const key = authStorageKey();

    if (key) {
      window.sessionStorage.removeItem(key);
      window.localStorage.removeItem(key);
    }
  } catch (error) {
    console.warn(
      "No se pudo limpiar el almacenamiento local de sesión.",
      error
    );
  }
}

async function signOutLocalSafely() {
  try {
    if (supabase) {
      const { error } = await supabase.auth.signOut({
        scope: "local"
      });

      if (error) {
        console.warn(
          "Supabase no confirmó el cierre de sesión local.",
          error.message
        );
      }
    }
  } catch (error) {
    console.warn(
      "No se pudo completar el cierre de sesión.",
      error
    );
  } finally {
    clearLocalAuthStorage();
  }
}

function clearLoginPassword() {
  const password = $("#login-password");

  if (password) {
    password.value = "";
    password.setCustomValidity("");
  }
}

function showLoginScreen(statusText = "", type = "") {
  currentUser = null;
  products = [];

  dashboard.classList.add("hidden");
  loginPanel.classList.remove("hidden");

  if (form) {
    form.reset();
  }

  clearEditor();

  $("#login-email").value = "";
  clearLoginPassword();

  setStatus("");
  message("#login-status", statusText, type);
}

/* =========================================================
   ESPECIFICACIONES E IMÁGENES
   ========================================================= */

function parseSpecs(text) {
  const result = {};

  String(text || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => {
      const colon = line.indexOf(":");

      if (colon > 0) {
        result[line.slice(0, colon).trim()] =
          line.slice(colon + 1).trim();
      } else {
        result[`Dato ${Object.keys(result).length + 1}`] = line;
      }
    });

  return result;
}

function specsText(specs) {
  specs = parseJSON(specs, {});

  if (Array.isArray(specs)) {
    return specs.map(item => {
      if (typeof item === "string") {
        return item;
      }

      if (item && typeof item === "object") {
        return `${item.label || item.name || "Dato"}: ${item.value || ""}`;
      }

      return String(item ?? "");
    }).join("\n");
  }

  if (specs && typeof specs === "object") {
    return Object.entries(specs)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
  }

  return "";
}

function getImages(product) {
  const images = parseJSON(product?.images, []);
  const list = Array.isArray(images) ? images : [];

  return [...list, product?.image_url]
    .filter(value =>
      typeof value === "string" && value.trim()
    );
}

/* =========================================================
   COLORES Y VARIANTES
   ========================================================= */

function normalizeColors(value) {
  const colors = parseJSON(value, []);

  if (!Array.isArray(colors)) {
    return [];
  }

  return colors.map(item => {
    if (typeof item === "string") {
      return {
        name: item.trim(),
        type: "available",
        image_url: "",
        color_hex: "#315A91"
      };
    }

    if (!item || typeof item !== "object") {
      return null;
    }

    return {
      name: String(item.name || item.color || "").trim(),
      type: normalizeVariantAvailability(item.type),
      image_url: String(
        item.image_url || item.imageUrl || ""
      ).trim(),
      color_hex: validHex(item.color_hex || item.hex)
    };
  }).filter(item => item && item.name);
}

function normalizeVariants(value) {
  const variants = parseJSON(value, []);

  if (!Array.isArray(variants)) {
    return [];
  }

  return variants.map(item => {
    if (!item || typeof item !== "object") {
      return null;
    }

    const usd =
      item.price_usd === "" ||
      item.price_usd === undefined ||
      item.price_usd === null
        ? null
        : Number(item.price_usd);

    const nio =
      item.price_nio === "" ||
      item.price_nio === undefined ||
      item.price_nio === null
        ? null
        : Number(item.price_nio);

    return {
      storage: String(
        item.storage || item.capacity || ""
      ).trim(),

      ram: String(item.ram || "").trim(),

      color: String(
        item.color || item.name || ""
      ).trim(),

      color_hex: validHex(item.color_hex || item.hex),

      price_usd: Number.isFinite(usd) ? usd : null,
      price_nio: Number.isFinite(nio) ? nio : null,

      availability: normalizeVariantAvailability(
        item.availability
      ),

      images: Array.isArray(item.images) ? item.images.filter(url => typeof url === "string" && url.trim()) : [String(item.image_url || item.imageUrl || "").trim()].filter(Boolean),
      image_url: String((Array.isArray(item.images) && item.images[0]) || item.image_url || item.imageUrl || "").trim()
    };
  }).filter(item =>
    item &&
    (item.storage || item.ram || item.color)
  );
}

/*
  Compatibilidad: si un producto antiguo tiene colores, pero no
  tiene variantes, los mostramos en el editor para no perderlos.
*/
function legacyVariants(product) {
  const variants = normalizeVariants(product?.variants);

  if (variants.length) {
    return variants;
  }

  return normalizeColors(product?.colors).map(color => ({
    storage: "",
    ram: "",
    color: color.name,
    color_hex: color.color_hex,
    price_usd: product?.price_usd ?? null,
    price_nio: product?.price_nio ?? null,
    availability: color.type,
    image_url: color.image_url,
    images: color.image_url ? [color.image_url] : []
  }));
}

function colorPaletteOptions(variant) {
  const match = COLOR_PALETTE.find(item =>
    item.name.toLocaleLowerCase("es") ===
      String(variant.color || "").toLocaleLowerCase("es") &&
    item.hex.toLowerCase() ===
      validHex(variant.color_hex).toLowerCase()
  );

  const selectedValue = !variant.color
    ? ""
    : match
      ? match.hex
      : "custom";

  return `
    <option value="" ${selectedValue === "" ? "selected" : ""}>
      Seleccioná un color de la paleta…
    </option>

    ${COLOR_PALETTE.map(item => `
      <option
        value="${item.hex}"
        ${selectedValue === item.hex ? "selected" : ""}
      >${escapeHtml(item.name)}</option>
    `).join("")}

    <option
      value="custom"
      ${selectedValue === "custom" ? "selected" : ""}
    >Color personalizado</option>
  `;
}

function variantRowMarkup(variant = {}) {
  const images = Array.isArray(variant.images)
    ? variant.images.filter(Boolean)
    : [variant.image_url || variant.imageUrl || ""].filter(Boolean);
  const v = {
    color: String(variant.color || "").trim(),
    color_hex: validHex(variant.color_hex || variant.hex),
    images,
    image_url: images[0] || String(variant.image_url || variant.imageUrl || "").trim(),
    availability: normalizeVariantAvailability(variant.availability)
  };

  return `
    <article class="variant-admin-row inline-color-card" data-variant-row>
      <div class="inline-color-main">
        <span class="inline-color-dot" data-variant-color-dot style="--inline-color:${v.color_hex}" aria-hidden="true"></span>
        <label class="inline-color-name-field">
          <span>Nombre del color</span>
          <input data-variant-color maxlength="60" required value="${escapeHtml(v.color)}" aria-label="Nombre del color" placeholder="Ej. Gris titanio">
        </label>
        <label class="inline-color-tone-field" title="Personalizar el tono">
          <span>Tono</span>
          <input data-variant-hex type="color" value="${v.color_hex}" aria-label="Personalizar el tono del color">
        </label>
        <button class="admin-mini-button danger inline-color-remove" type="button" data-remove-variant aria-label="Quitar color" title="Quitar color">×</button>
      </div>
      <details class="inline-color-details">
        <summary>Disponibilidad y fotografías</summary>
        <div class="variant-fields-grid variant-color-fields">
          <label>Paleta de colores<select data-variant-palette>${colorPaletteOptions(v)}</select></label>
          <label>Disponibilidad de este color<select data-variant-availability>
            <option value="available" ${v.availability === "available" ? "selected" : ""}>Disponible</option>
            <option value="order" ${v.availability === "order" ? "selected" : ""}>Por pedido</option>
            <option value="out_of_stock" ${v.availability === "out_of_stock" ? "selected" : ""}>No disponible</option>
          </select></label>
          <label class="variant-image-label">Fotografías del color
            <input data-variant-image data-variant-image-input class="admin-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple>
            <span class="admin-file-picker admin-file-picker-compact"><span class="admin-file-picker-icon" aria-hidden="true">＋</span><span>Añadir fotografías</span></span>
            <div class="variant-image-preview" data-variant-image-preview></div>
          </label>
        </div>
        <input data-variant-images type="hidden" value="${escapeHtml(JSON.stringify(v.images))}">
        <input data-variant-image-url type="hidden" value="${escapeHtml(v.image_url)}">
        <p class="color-row-status" data-variant-status role="status"></p>
      </details>
    </article>`;
}

function variantGroupKey(variant) {
  const storage = String(variant.storage || "").trim().toLocaleLowerCase("es");
  const ram = String(variant.ram || "").trim().toLocaleLowerCase("es");
  return `${storage}|${ram}`;
}

function variantGroupMarkup(v = {}, isBase = false) {
  const storage = String(v.storage || "").trim().replace(/\s*GB\s*/i, "");
  const ram = String(v.ram || "").trim().replace(/\s*GB\s*/i, "");
  const title = isBase
    ? "Colores del producto"
    : [storage ? storage + " GB" : "", ram ? ram + " GB RAM" : ""].filter(Boolean).join(" · ") || "Nueva configuración";
  const colorControls = isBase
    ? '<div class="variant-color-list" data-variant-color-list></div><button class="admin-mini-button variant-add-color" type="button" data-add-group-color>＋ Añadir color</button>'
    : "";

  return `<section class="variant-config-group ${isBase ? "variant-base-group" : ""}" data-variant-group data-base-group="${isBase ? "true" : "false"}">
    <div class="variant-config-group-heading">
      <div><strong data-variant-group-title>${escapeHtml(title)}</strong><small>${isBase ? "Los colores se configuran en este formulario" : "Configuración técnica"}</small></div>
      ${isBase ? "" : '<button class="admin-mini-button danger" type="button" data-remove-group>Eliminar configuración</button>'}
    </div>
    <div class="variant-config-fields">
      <label>Almacenamiento<span class="variant-number-unit"><input data-group-storage type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(storage)}"><span>GB</span></span></label>
      <label>Memoria RAM<span class="variant-number-unit"><input data-group-ram type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(ram)}"><span>GB</span></span></label>
      ${isBase ? "" : '<label>Precio en dólares<span class="admin-input-unit"><span>$</span><input data-group-price-usd type="number" min="0" step="0.01" inputmode="decimal" value="' + escapeHtml(v.price_usd ?? "") + '"></span></label><label>Precio en córdobas<span class="admin-input-unit"><span>C$</span><input data-group-price-nio type="number" min="0" step="0.01" inputmode="decimal" value="' + escapeHtml(v.price_nio ?? "") + '"></span></label>'}
    </div>
    ${colorControls}
  </section>`;
}

function renderVariantRows(variants = []) {
  const container = $("#product-variants-list");
  const colorManager = $("#base-color-manager");
  if (!container || !colorManager) return;

  const normalized = normalizeVariants(variants);
  const groups = new Map();
  const colorsByName = new Map();

  normalized.forEach(variant => {
    const groupKey = variantGroupKey(variant);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(variant);

    const name = String(variant.color || "").trim();
    if (!name) return;
    const colorKey = name.toLocaleLowerCase("es");
    const imageList = Array.isArray(variant.images) && variant.images.length
      ? variant.images
      : [variant.image_url || variant.imageUrl || ""].filter(Boolean);
    if (!colorsByName.has(colorKey)) {
      colorsByName.set(colorKey, {
        color: name,
        color_hex: validHex(variant.color_hex || variant.hex),
        availability: normalizeVariantAvailability(variant.availability),
        images: [...new Set(imageList.filter(Boolean))],
        image_url: imageList[0] || ""
      });
    } else {
      const current = colorsByName.get(colorKey);
      current.images = [...new Set([...(current.images || []), ...imageList.filter(Boolean)])];
      current.image_url = current.images[0] || "";
      if (normalizeVariantAvailability(variant.availability) === "available") {
        current.availability = "available";
      } else if (
        current.availability !== "available" &&
        normalizeVariantAvailability(variant.availability) === "order"
      ) {
        current.availability = "order";
      }
    }
  });

  container.innerHTML = "";
  colorManager.innerHTML = "";

  colorManager.insertAdjacentHTML("beforeend", variantGroupMarkup({}, true));
  const colorGroup = colorManager.querySelector('[data-variant-group][data-base-group="true"]');
  const colorList = colorGroup?.querySelector("[data-variant-color-list]");
  const uniqueColors = Array.from(colorsByName.values());
  uniqueColors.forEach(color => colorList?.insertAdjacentHTML("beforeend", variantRowMarkup(color)));
  if (colorList && !uniqueColors.length) {
    colorList.innerHTML = '<p class="variants-empty-hint">Elegí un color para este producto.</p>';
  }

  groups.delete("|");
  groups.forEach(items => {
    container.insertAdjacentHTML("beforeend", variantGroupMarkup(items[0], false));
  });
  if (!groups.size) {
    container.innerHTML = '<p class="variants-empty-hint">No hay configuraciones adicionales. Añadí una solo si cambia la capacidad o la RAM.</p>';
  }

  updateVariantRowHeadings();
  form?.querySelectorAll("[data-variant-row]").forEach(row => renderVariantImagePreview(row));
}

function addVariantRow(variant = {}, targetGroup = null, options = {}) {
  const container = $("#product-variants-list");
  if (!container) return;
  let group = targetGroup;
  if (!group) {
    container.querySelector(".variants-empty-hint")?.remove();
    container.insertAdjacentHTML("beforeend", variantGroupMarkup(variant, false));
    group = container.lastElementChild;
  }
  const list = group.querySelector("[data-variant-color-list]");
  if (!list) return;
  list.querySelector(".variants-empty-hint")?.remove();
  list.insertAdjacentHTML("beforeend", variantRowMarkup(variant));
  renderVariantImagePreview(list.lastElementChild);
  updateVariantRowHeadings();
  const rows = list.querySelectorAll("[data-variant-row]");
  if (options.focus !== false) rows.item(rows.length - 1)?.querySelector("[data-variant-color]")?.focus();
}

function updateVariantRowHeadings() {
  document.querySelectorAll("[data-variant-group]").forEach(group => {
    const storage = group.querySelector("[data-group-storage]")?.value.trim();
    const ram = group.querySelector("[data-group-ram]")?.value.trim();
    const title = [storage ? storage + " GB" : "", ram ? ram + " GB RAM" : ""].filter(Boolean).join(" · ") || "Nueva configuración";
    const heading = group.querySelector("[data-variant-group-title]");
    if (heading) heading.textContent = title;
    group.querySelectorAll("[data-variant-row]").forEach((row, index) => {
      const colorName = row.querySelector("[data-variant-color]")?.value.trim();
      const rowHeading = row.querySelector("[data-variant-row-heading]");
      if (rowHeading) rowHeading.textContent = colorName || "Color " + (index + 1);
      const hex = validHex(row.querySelector("[data-variant-hex]")?.value);
      const dot = row.querySelector("[data-variant-color-dot]");
      if (dot) dot.style.setProperty("--inline-color", hex);
      const removeButton = row.querySelector("[data-remove-variant]");
      if (removeButton) removeButton.setAttribute("aria-label", "Quitar " + (colorName || "color"));
    });
  });
}

/* Galerías editables: orden, portada y fotos múltiples por variante. */
const variantsContainer = $("#product-variants-list");
const baseColorManager = $("#base-color-manager");
const mainImagesInput = $("#product-images"), mainImagesPreview = $("#product-images-preview"), mainImagesSummary = $("#product-images-summary");
let mainImageItems = [], draggingMainImageId = null, draggingVariantImage = null;
const imageId = () => crypto.randomUUID();
const imagePreviewUrl = item => item.kind === "new" ? item.previewUrl : item.url;
function disposeImageItems(items){items.forEach(item=>{if(item.kind==="new"&&item.previewUrl)URL.revokeObjectURL(item.previewUrl);});}
function clearMainImagePreviews(){disposeImageItems(mainImageItems);mainImageItems=[];mainImagesPreview?.replaceChildren();}
function setExistingMainImages(urls=[]){disposeImageItems(mainImageItems);mainImageItems=[...new Set(urls.filter(url=>typeof url==="string"&&url.trim()))].map(url=>({id:imageId(),kind:"existing",url}));renderMainImagePreviews();}
function renderMainImagePreviews(){
 if(!mainImagesInput||!mainImagesPreview||!mainImagesSummary)return;
 mainImagesPreview.replaceChildren();
 mainImagesSummary.textContent=mainImageItems.length?`${mainImageItems.length} fotografía${mainImageItems.length===1?"":"s"} · la primera será la portada`:"Ninguna fotografía seleccionada";
 mainImageItems.forEach((item,index)=>{
  const card=document.createElement("figure");card.className="admin-image-preview-card sortable-image-card";card.draggable=true;card.dataset.imageItemId=item.id;
  const img=document.createElement("img");img.src=imagePreviewUrl(item);img.alt=`Fotografía ${index+1} del producto`;img.loading="lazy";
  const badge=document.createElement("span");badge.className="admin-image-order-badge";badge.textContent=index===0?"Portada":String(index+1);
  const caption=document.createElement("figcaption");caption.textContent=item.kind==="new"?item.file.name:"Imagen guardada";
  const controls=document.createElement("div");controls.className="admin-image-controls";
  for(const [label,offset,disabled] of [["↑",-1,index===0],["↓",1,index===mainImageItems.length-1]]){
   const b=document.createElement("button");b.type="button";b.className="admin-mini-button";b.textContent=label;b.disabled=disabled;b.dataset.mainImageMove=String(offset);b.title=offset<0?"Mover antes":"Mover después";controls.append(b);
  }
  const remove=document.createElement("button");remove.type="button";remove.className="admin-mini-button danger";remove.textContent="×";remove.dataset.mainImageRemove="true";remove.title="Quitar fotografía";
  controls.append(remove);card.append(badge,img,caption,controls);mainImagesPreview.append(card);
 });
}
function moveMainImage(id,offset){const from=mainImageItems.findIndex(i=>i.id===id),to=from+offset;if(from<0||to<0||to>=mainImageItems.length)return;const [item]=mainImageItems.splice(from,1);mainImageItems.splice(to,0,item);renderMainImagePreviews();updateEditorDirtyState();}
function removeMainImage(id){const from=mainImageItems.findIndex(i=>i.id===id);if(from<0)return;disposeImageItems([mainImageItems[from]]);mainImageItems.splice(from,1);renderMainImagePreviews();updateEditorDirtyState();}
mainImagesInput?.addEventListener("change",()=>{for(const file of Array.from(mainImagesInput.files||[]))mainImageItems.push({id:imageId(),kind:"new",file,previewUrl:URL.createObjectURL(file)});mainImagesInput.value="";renderMainImagePreviews();updateEditorDirtyState();});
mainImagesPreview?.addEventListener("click",e=>{const card=e.target.closest("[data-image-item-id]");if(!card)return;const m=e.target.closest("[data-main-image-move]");if(m)moveMainImage(card.dataset.imageItemId,Number(m.dataset.mainImageMove));else if(e.target.closest("[data-main-image-remove]"))removeMainImage(card.dataset.imageItemId);});
mainImagesPreview?.addEventListener("dragstart",e=>{const card=e.target.closest("[data-image-item-id]");if(!card)return;draggingMainImageId=card.dataset.imageItemId;card.classList.add("is-dragging");e.dataTransfer?.setData("text/plain",draggingMainImageId);if(e.dataTransfer)e.dataTransfer.effectAllowed="move";});
mainImagesPreview?.addEventListener("dragover",e=>{if(e.target.closest("[data-image-item-id]"))e.preventDefault();});
mainImagesPreview?.addEventListener("drop",e=>{const card=e.target.closest("[data-image-item-id]");if(!card||!draggingMainImageId)return;e.preventDefault();const from=mainImageItems.findIndex(i=>i.id===draggingMainImageId),to=mainImageItems.findIndex(i=>i.id===card.dataset.imageItemId);if(from>=0&&to>=0&&from!==to){const [item]=mainImageItems.splice(from,1);mainImageItems.splice(to,0,item);renderMainImagePreviews();updateEditorDirtyState();}draggingMainImageId=null;});
mainImagesPreview?.addEventListener("dragend",()=>{draggingMainImageId=null;mainImagesPreview.querySelectorAll(".is-dragging").forEach(n=>n.classList.remove("is-dragging"));});
function readVariantImageUrls(row){try{const v=JSON.parse(row.querySelector("[data-variant-images]")?.value||"[]");if(Array.isArray(v))return v.filter(u=>typeof u==="string"&&u.trim());}catch{}const u=row.querySelector("[data-variant-image-url]")?.value.trim();return u?[u]:[];}
function initVariantImageItems(row){if(!row||Array.isArray(row._variantImageItems))return;row._variantImageItems=readVariantImageUrls(row).map(url=>({id:imageId(),kind:"existing",url}));}
function syncVariantImageFields(row){const items=row?._variantImageItems||[],urls=items.filter(i=>i.kind==="existing").map(i=>i.url),json=row?.querySelector("[data-variant-images]"),legacy=row?.querySelector("[data-variant-image-url]");if(json)json.value=JSON.stringify(urls);if(legacy)legacy.value=urls[0]||"";}
function renderVariantImagePreview(row){
 const preview=row?.querySelector("[data-variant-image-preview]");if(!preview)return;initVariantImageItems(row);preview.replaceChildren();const items=row._variantImageItems;
 if(!items.length){const empty=document.createElement("span");empty.className="variant-image-placeholder";empty.textContent="Añadí fotografías de este color";preview.append(empty);return;}
 items.forEach((item,index)=>{const card=document.createElement("figure");card.className="variant-gallery-item sortable-image-card";card.draggable=true;card.dataset.variantImageId=item.id;
  const img=document.createElement("img");img.src=imagePreviewUrl(item);img.alt=`Fotografía ${index+1} del color`;img.loading="lazy";
  const badge=document.createElement("span");badge.className="admin-image-order-badge";badge.textContent=index===0?"Portada":String(index+1);
  const controls=document.createElement("div");controls.className="admin-image-controls";
  for(const [label,offset,disabled] of [["↑",-1,index===0],["↓",1,index===items.length-1]]){const b=document.createElement("button");b.type="button";b.className="admin-mini-button";b.textContent=label;b.disabled=disabled;b.dataset.variantImageMove=String(offset);b.title=offset<0?"Mover antes":"Mover después";controls.append(b);}
  const remove=document.createElement("button");remove.type="button";remove.className="admin-mini-button danger";remove.textContent="×";remove.dataset.variantImageRemove="true";remove.title="Quitar fotografía";controls.append(remove);card.append(badge,img,controls);preview.append(card);
 });
}
function moveVariantImage(row,id,offset){initVariantImageItems(row);const a=row._variantImageItems,from=a.findIndex(i=>i.id===id),to=from+offset;if(from<0||to<0||to>=a.length)return;const [item]=a.splice(from,1);a.splice(to,0,item);syncVariantImageFields(row);renderVariantImagePreview(row);updateEditorDirtyState();}
function removeVariantImage(row,id){initVariantImageItems(row);const a=row._variantImageItems,from=a.findIndex(i=>i.id===id);if(from<0)return;disposeImageItems([a[from]]);a.splice(from,1);syncVariantImageFields(row);renderVariantImagePreview(row);updateEditorDirtyState();}
form?.addEventListener("click",e=>{const card=e.target.closest("[data-variant-image-id]");if(!card)return;const row=card.closest("[data-variant-row]");if(!row)return;const m=e.target.closest("[data-variant-image-move]");if(m)moveVariantImage(row,card.dataset.variantImageId,Number(m.dataset.variantImageMove));else if(e.target.closest("[data-variant-image-remove]"))removeVariantImage(row,card.dataset.variantImageId);});
form?.addEventListener("dragstart",e=>{const card=e.target.closest("[data-variant-image-id]");if(!card)return;draggingVariantImage={id:card.dataset.variantImageId,row:card.closest("[data-variant-row]")};card.classList.add("is-dragging");e.dataTransfer?.setData("text/plain",draggingVariantImage.id);if(e.dataTransfer)e.dataTransfer.effectAllowed="move";});
form?.addEventListener("dragover",e=>{if(e.target.closest("[data-variant-image-id]"))e.preventDefault();});
form?.addEventListener("drop",e=>{const card=e.target.closest("[data-variant-image-id]");if(!card||!draggingVariantImage)return;const row=card.closest("[data-variant-row]");if(row!==draggingVariantImage.row)return;e.preventDefault();initVariantImageItems(row);const a=row._variantImageItems,from=a.findIndex(i=>i.id===draggingVariantImage.id),to=a.findIndex(i=>i.id===card.dataset.variantImageId);if(from>=0&&to>=0&&from!==to){const [item]=a.splice(from,1);a.splice(to,0,item);syncVariantImageFields(row);renderVariantImagePreview(row);updateEditorDirtyState();}draggingVariantImage=null;});
form?.addEventListener("dragend",()=>{draggingVariantImage=null;form.querySelectorAll(".is-dragging").forEach(n=>n.classList.remove("is-dragging"));});


/* Selector rápido: permite elegir el color junto al precio/garantía sin saltar de sección. */
const quickColorPalette = $("#quick-color-palette");
const quickColorButton = $("#add-base-color-button");
const quickColorStatus = $("#quick-color-status");

if (quickColorPalette) {
  quickColorPalette.innerHTML = COLOR_PALETTE.map(color => `
    <button class="quick-color-swatch" type="button" data-quick-color="${escapeHtml(color.name)}"
      data-quick-color-hex="${color.hex}" title="${escapeHtml(color.name)}"
      aria-label="Añadir color ${escapeHtml(color.name)}">
      <span class="quick-color-dot" style="--quick-color:${color.hex}"></span>
      <span class="quick-color-name">${escapeHtml(color.name)}</span>
    </button>`).join("");
}

quickColorButton?.addEventListener("click", event => {
  event.preventDefault();
  const expanded = quickColorButton.getAttribute("aria-expanded") === "true";
  quickColorButton.setAttribute("aria-expanded", String(!expanded));
  quickColorPalette?.toggleAttribute("hidden", expanded);
});

quickColorPalette?.addEventListener("click", event => {
  const choice = event.target.closest("[data-quick-color]");
  if (!choice) return;
  const color = choice.dataset.quickColor || "";
  const hex = choice.dataset.quickColorHex || "#242424";
  const container = $("#product-variants-list");
  const colorManager = $("#base-color-manager");
  if (!container || !colorManager) return;

  let baseGroup = colorManager.querySelector('[data-variant-group][data-base-group="true"]');
  if (!baseGroup) {
    renderVariantRows([]);
    baseGroup = colorManager.querySelector('[data-variant-group][data-base-group="true"]');
  }
  if (!baseGroup) return;

  const duplicate = Array.from(baseGroup.querySelectorAll("[data-variant-color]"))
    .some(input => input.value.trim().toLocaleLowerCase("es") === color.toLocaleLowerCase("es"));
  if (duplicate) {
    if (quickColorStatus) quickColorStatus.textContent = `${color} ya está añadido. Elegí otro color.`;
    return;
  }

  addVariantRow({color, color_hex:hex, image_url:"", availability:"available"}, baseGroup, {focus:false});
  updateEditorDirtyState();
  if (quickColorStatus) quickColorStatus.textContent = `Color ${color} añadido. Editá su nombre y tono aquí; abrí “Disponibilidad y fotografías” para cargar imágenes.`;
  choice.classList.add("is-selected");
});

$("#add-variant-button")?.addEventListener("click", event => {
  event.preventDefault();
  const container = $("#product-variants-list");
  if (!container) return;
  const groupHtml = variantGroupMarkup({ storage: "", ram: "", price_usd: "", price_nio: "" }, false);
  container.querySelector(".variants-empty-hint")?.remove();
  container.insertAdjacentHTML("beforeend", groupHtml);
  const newGroup = container.lastElementChild;
  if (!newGroup?.matches("[data-variant-group]")) {
    message("#product-form-status", "No se pudo crear la configuración. Recargá el panel e intentá nuevamente.", "error");
    return;
  }
  updateVariantRowHeadings();
  newGroup.querySelector("[data-group-storage]")?.focus();
  updateEditorDirtyState();
});

form?.addEventListener("click", event => {
  const add = event.target.closest("[data-add-group-color]");
  if (add) {
    const group = add.closest("[data-variant-group]");
    if (group) {
      addVariantRow({color:"",color_hex:"#242424",image_url:"",availability:"available"}, group);
      updateEditorDirtyState();
    }
    return;
  }

  const removeGroup = event.target.closest("[data-remove-group]");
  if (removeGroup) {
    removeGroup.closest("[data-variant-group]")?.remove();
    if (!variantsContainer.querySelector("[data-variant-group]")) {
      variantsContainer.innerHTML = '<p class="variants-empty-hint">No hay configuraciones adicionales. Añadí una solo si cambia la capacidad o la RAM.</p>';
    }
    updateEditorDirtyState();
    return;
  }

  const remove = event.target.closest("[data-remove-variant]");
  if (!remove) return;
  const group = remove.closest("[data-variant-group]");
  const isBaseGroup = group?.dataset.baseGroup === "true";
  remove.closest("[data-variant-row]")?.remove();
  if (group && !group.querySelector("[data-variant-row]")) {
    if (isBaseGroup) {
      const list = group.querySelector("[data-variant-color-list]");
      if (list) list.innerHTML = '<p class="variants-empty-hint">Elegí un color para este producto.</p>';
    } else {
      group.remove();
    }
  }
  if (!form.querySelector('[data-variant-group][data-base-group="true"]')) renderVariantRows([]);
  updateVariantRowHeadings();
  updateEditorDirtyState();
});

form?.addEventListener("change", event => {
  const imageInput = event.target.closest("[data-variant-image]");
  if (imageInput) {
    const row=imageInput.closest("[data-variant-row]"); if(!row)return;
    initVariantImageItems(row);
    for(const file of Array.from(imageInput.files||[]))row._variantImageItems.push({id:imageId(),kind:"new",file,previewUrl:URL.createObjectURL(file)});
    imageInput.value="";syncVariantImageFields(row);renderVariantImagePreview(row);updateEditorDirtyState();return;
  }
  const urlInput = event.target.closest("[data-variant-image-url]");
  if (urlInput) return;
  if (event.target.matches("[data-variant-images]")) return;
  const select = event.target.closest("[data-variant-palette]");

  if (!select) {
    return;
  }

  const row = select.closest("[data-variant-row]");

  if (!row || !select.value || select.value === "custom") {
    return;
  }

  const color = COLOR_PALETTE.find(
    item => item.hex === select.value
  );

  if (!color) {
    return;
  }

  row.querySelector("[data-variant-color]").value = color.name;
  row.querySelector("[data-variant-hex]").value = color.hex;

  updateVariantRowHeadings();
});

form?.addEventListener("input", event => {
  if (!event.target.matches("[data-variant-color], [data-variant-hex], [data-group-storage], [data-group-ram]")) return;
  const row = event.target.closest("[data-variant-row]");
  if (event.target.matches("[data-group-storage], [data-group-ram]")) {
    updateVariantRowHeadings();
    return;
  }
  if (!row) return;

  if (event.target.matches("[data-variant-hex]")) {
    updateVariantRowHeadings();
    updateEditorDirtyState();
    return;
  }

  if (event.target.matches("[data-variant-color]")) {
    const colorName = event.target.value.trim();

    const matchingColor = COLOR_PALETTE.find(item =>
      item.name.toLocaleLowerCase("es") ===
      colorName.toLocaleLowerCase("es")
    );

    if (matchingColor) {
      row.querySelector("[data-variant-hex]").value =
        matchingColor.hex;

      row.querySelector("[data-variant-palette]").value =
        matchingColor.hex;
    } else {
      row.querySelector("[data-variant-palette]").value = "custom";
    }
  }

  updateVariantRowHeadings();
  updateEditorDirtyState();
});

/* =========================================================
   AUTORIZACIÓN DE ADMINISTRADORES
   ========================================================= */

async function confirmAdmin(user) {
  if (!supabase || !user?.id) {
    throw new Error("No se pudo verificar la sesión.");
  }

  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error(
      "Tu usuario inició sesión, pero no está autorizado para administrar el catálogo."
    );
  }

  return true;
}

async function showDashboard(user) {
  await confirmAdmin(user);

  currentUser = user;

  loginPanel.classList.add("hidden");
  dashboard.classList.remove("hidden");
  showAdminSection("home");

  const metadata = user.user_metadata || {};

  const profileName =
    metadata.full_name ||
    metadata.name ||
    metadata.display_name ||
    [metadata.first_name, metadata.last_name]
      .filter(Boolean)
      .join(" ");

  const emailName = user.email
    ? user.email
        .split("@")[0]
        .replace(/[._+-]+/g, " ")
        .replace(/\d+/g, " ")
        .trim()
    : "";

  const displayName = String(profileName || emailName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(part =>
      part.charAt(0).toLocaleUpperCase("es") + part.slice(1)
    )
    .join(" ");

  const greeting = $("#admin-greeting");

  if (greeting) {
    greeting.textContent = displayName
      ? `¡Bienvenido de nuevo, ${displayName}! 👋`
      : "¡Bienvenido de nuevo! 👋";
  }

  setStatus("Sesión iniciada");
  window.setTimeout(() => { const status = $("#admin-status"); if (status?.textContent === "Sesión iniciada") status.textContent = ""; }, 4500);

  await loadProducts();
}

async function handleSession() {
  if (!configured) {
    message(
      "#login-status",
      "Falta configurar la URL y la clave publicable de Supabase en config.js.",
      "error"
    );

    return;
  }

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  if (!data.session) {
    loginPanel.classList.remove("hidden");
    dashboard.classList.add("hidden");
    return;
  }

  try {
    await showDashboard(data.session.user);
  } catch (error) {
    await signOutLocalSafely();

    showLoginScreen(
      error.message ||
      "La sesión no está autorizada para administrar este catálogo.",
      "error"
    );
  }
}

/* =========================================================
   INICIO Y CIERRE DE SESIÓN
   ========================================================= */

$("#login-form")?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!supabase) {
    message(
      "#login-status",
      "Configurá primero Supabase en config.js.",
      "error"
    );

    clearLoginPassword();
    return;
  }

  const button = event.currentTarget.querySelector(
    'button[type="submit"]'
  );

  button.disabled = true;
  button.textContent = "Verificando…";

  message("#login-status", "Comprobando acceso…");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: $("#login-email").value.trim(),
      password: $("#login-password").value
    });

    if (error) {
      throw error;
    }

    await showDashboard(data.user);

    message(
      "#login-status",
      "Acceso autorizado.",
      "success"
    );
  } catch (error) {
    /*
      Limpia cualquier sesión local si las credenciales fallan
      o el usuario no está autorizado en admin_users.
    */
    await signOutLocalSafely();

    dashboard.classList.add("hidden");
    loginPanel.classList.remove("hidden");

    /*
      Conservamos el correo para que no tengás que escribirlo
      nuevamente, pero borramos la contraseña incorrecta.
    */
    clearLoginPassword();

    message(
      "#login-status",
      error.message || "No se pudo iniciar sesión. Revisá tus datos.",
      "error"
    );

    $("#login-password")?.focus();
  } finally {
    button.disabled = false;
    button.textContent = "Iniciar sesión";
  }
});

$("#logout-button")?.addEventListener("click", async event => {
  const button = event.currentTarget;

  button.disabled = true;
  button.textContent = "Cerrando sesión…";

  await signOutLocalSafely();

  showLoginScreen(
    "Sesión cerrada correctamente.",
    "success"
  );

  button.disabled = false;
  button.textContent = "Cerrar sesión";
});

/* =========================================================
   INVENTARIO: CONSULTAR Y LISTAR PRODUCTOS
   ========================================================= */

function minimumPrice(variants, field) {
  const values = variants
    .map(variant => variant[field])
    .filter(value =>
      value !== null &&
      value !== undefined &&
      value !== "" &&
      Number.isFinite(Number(value))
    )
    .map(Number);

  return values.length ? Math.min(...values) : null;
}

function showAdminSection(section) {
  document.querySelectorAll("[data-admin-panel]").forEach(panel => panel.classList.toggle("hidden", panel.dataset.adminPanel !== section));
  document.querySelectorAll("[data-admin-section]").forEach(button => {
    const active = button.dataset.adminSection === section;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}
document.querySelectorAll("[data-admin-section]").forEach(button => button.addEventListener("click", () => showAdminSection(button.dataset.adminSection)));

async function loadProducts() {
  if (!supabase || !currentUser) {
    return;
  }

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    setStatus(
      `No se pudo cargar el inventario: ${error.message}`,
      "error"
    );

    return;
  }

  products = data || [];

  renderAdminList();

}

function renderAdminList() {
  const searchable = product => [product.name, product.brand, product.model, product.category].join(" ").toLocaleLowerCase("es");
  const published = products.filter(product => Boolean(product.is_published));
  const drafts = products.filter(product => !product.is_published);
  const filter = (items, selector) => {
    const query = ($(selector)?.value || "").trim().toLocaleLowerCase("es");
    return items.filter(product => searchable(product).includes(query));
  };
  const cards = (items, emptyText) => items.map(product => {
    const image = getImages(product)[0];
    const thumb = image ? `<img class="admin-product-thumb" src="${escapeHtml(image)}" alt="" loading="lazy">` : `<div class="admin-product-thumb" style="display:grid;place-items:center;color:#9aa6b9">▧</div>`;
    const variants = normalizeVariants(product.variants);
    const variantLabel = variants.length ? ` · ${variants.length} variante${variants.length === 1 ? "" : "s"}` : "";
    const price = minimumPrice(variants, "price_usd") ?? product.price_usd;
    const formattedPrice = price === null || price === undefined || price === "" ? "Consultar" : `US$${Number(price).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    return `<article class="admin-product-row">${thumb}<div><p class="admin-product-name">${escapeHtml(product.name)}</p><div class="admin-product-meta">${escapeHtml(product.category || "Sin categoría")} · ${escapeHtml(formattedPrice)}${variantLabel}</div><div class="admin-product-buttons"><button class="admin-mini-button" type="button" data-edit="${escapeHtml(product.id)}">Editar</button><button class="admin-mini-button" type="button" data-toggle="${escapeHtml(product.id)}">${product.is_published ? "Despublicar" : "Publicar"}</button></div></div></article>`;
  }).join("") || `<p class="form-status">${emptyText}</p>`;
  $("#published-product-list").innerHTML = cards(filter(published, "#published-search"), "Todavía no hay productos publicados.");
  $("#draft-product-list").innerHTML = cards(filter(drafts, "#draft-search"), "No hay productos pendientes de publicar.");
  $("#published-count").textContent = `${published.length} producto${published.length === 1 ? "" : "s"} publicados`;
  $("#draft-count").textContent = `${drafts.length} producto${drafts.length === 1 ? "" : "s"} sin publicar`;
  $("#published-nav-count").textContent = published.length;
  $("#draft-nav-count").textContent = drafts.length;
}

$("#published-search")?.addEventListener("input", renderAdminList);
$("#draft-search")?.addEventListener("input", renderAdminList);

document.querySelectorAll("#published-product-list, #draft-product-list").forEach(list => list.addEventListener("click", async event => {
  const edit = event.target.closest("[data-edit]");
  const toggle = event.target.closest("[data-toggle]");

  if (edit) {
    const product = products.find(
      item => String(item.id) === edit.dataset.edit
    );

    if (product) {
      fillEditor(product);
      showAdminSection("add");
    }
  }

  if (!toggle) {
    return;
  }

  const product = products.find(
    item => String(item.id) === toggle.dataset.toggle
  );

  if (!product || !currentUser) {
    return;
  }

  try {
    const { error } = await supabase
      .from("products")
      .update({
        is_published: !product.is_published,
        updated_at: new Date().toISOString(),
        updated_by: currentUser.id
      })
      .eq("id", product.id);

    if (error) {
      throw error;
    }

    setStatus(
      product.is_published
        ? "Producto despublicado."
        : "Producto publicado.",
      "success"
    );

    await loadProducts();
  } catch (error) {
    setStatus(
      `No se pudo cambiar la publicación: ${error.message}`,
      "error"
    );
  }
}));


/* =========================================================
   PROTECCIÓN ANTE RECARGA CON CAMBIOS SIN GUARDAR
   ========================================================= */

let editorBaseline = "";
let editorIsDirty = false;

function getEditorSnapshot(){
 if(!form)return "";
 const fields=Array.from(form.elements).map(f=>{if(!f||(!f.name&&!f.id&&!f.matches?.("[data-variant-row],[data-variant-group]")))return null;if(f.type==="file")return [f.id||f.getAttribute("data-variant-image")||"file",Array.from(f.files||[]).map(x=>[x.name,x.size,x.lastModified])];if(f.type==="checkbox"||f.type==="radio")return [f.id||f.name,f.checked];return [f.id||f.name||f.getAttribute("data-variant-color")||f.getAttribute("data-group-storage")||f.getAttribute("data-group-ram")||f.getAttribute("data-group-price-usd")||f.getAttribute("data-group-price-nio")||f.getAttribute("data-variant-availability")||f.getAttribute("data-variant-image-url")||f.tagName,f.value];}).filter(Boolean);
 const variants=Array.from(form.querySelectorAll("[data-variant-group]")).map(g=>({storage:g.querySelector("[data-group-storage]")?.value||"",ram:g.querySelector("[data-group-ram]")?.value||"",usd:g.querySelector("[data-group-price-usd]")?.value||"",nio:g.querySelector("[data-group-price-nio]")?.value||"",colors:Array.from(g.querySelectorAll("[data-variant-row]")).map(r=>({color:r.querySelector("[data-variant-color]")?.value||"",hex:r.querySelector("[data-variant-hex]")?.value||"",availability:r.querySelector("[data-variant-availability]")?.value||"",url:r.querySelector("[data-variant-image-url]")?.value||""}))}));
 const mainGallery=mainImageItems.map(i=>({id:i.id,kind:i.kind,url:i.url||"",name:i.file?.name||"",size:i.file?.size||0,lastModified:i.file?.lastModified||0}));
 const variantGalleries=Array.from(form.querySelectorAll("[data-variant-row]")).map(row=>({color:row.querySelector("[data-variant-color]")?.value||"",images:(row._variantImageItems||[]).map(i=>({id:i.id,kind:i.kind,url:i.url||"",name:i.file?.name||"",size:i.file?.size||0,lastModified:i.file?.lastModified||0}))}));
 return JSON.stringify({fields,variants,mainGallery,variantGalleries});
}

function markEditorClean() {
  editorBaseline = getEditorSnapshot();
  editorIsDirty = false;
}

function updateEditorDirtyState() {
  editorIsDirty = getEditorSnapshot() !== editorBaseline;
}

form?.addEventListener("input", updateEditorDirtyState);
form?.addEventListener("change", updateEditorDirtyState);
form?.addEventListener("click", event => {
  if (event.target.closest("#add-variant-button, [data-remove-variant]")) {
    queueMicrotask(updateEditorDirtyState);
  }
});

window.addEventListener("beforeunload", event => {
  if (!editorIsDirty || !dashboard || dashboard.classList.contains("hidden")) return;
  event.preventDefault();
  event.returnValue = "";
});

/* =========================================================
   FORMULARIO DE PRODUCTOS
   ========================================================= */

function clearEditor() {
  if (!form) {
    return;
  }

  form.reset();

  $("#product-id").value = "";
  $("#catalog-key").value = "";
  $("#product-active").checked = false;
  $("#product-featured").checked = false;

  $("#product-financing").value =
    "Financiamiento mediante crédito o tarjeta. Consultá requisitos y condiciones de aprobación.";

  $("#product-images").value = "";
  clearMainImagePreviews();
  renderMainImagePreviews();

  renderVariantRows([]);

  $("#form-title").textContent = "Agregar producto";
  $("#save-product-button").textContent = "Guardar producto";

  message("#product-form-status", "");
  markEditorClean();
}

function fillEditor(product) {
  $("#product-id").value = product.id || "";
  $("#catalog-key").value = product.catalog_key || "";

  $("#product-name").value = product.name || "";
  $("#product-brand").value = product.brand || "";
  $("#product-model").value = product.model || "";

  $("#product-category").value = product.category || "Otros";

  $("#product-availability").value =
    normalizeProductAvailability(product.availability);

  $("#product-price-usd").value = product.price_usd ?? "";
  $("#product-price-nio").value = product.price_nio ?? "";
  $("#product-warranty").value = product.warranty_months ?? "";

  $("#product-specs").value =
    specsText(product.specifications);

  $("#product-financing").value =
    product.financing_note ||
    "Financiamiento mediante crédito o tarjeta. Consultá requisitos y condiciones de aprobación.";

  $("#product-shipping").value =
    product.shipping_note || "";

  $("#product-images").value = "";
  setExistingMainImages(getImages(product));

  renderVariantRows(legacyVariants(product));

  $("#product-featured").checked = Boolean(product.featured);
  $("#product-active").checked = Boolean(product.is_published);

  $("#form-title").textContent = "Editar producto";
  $("#save-product-button").textContent = "Guardar cambios";

  message(
    "#product-form-status",
    `Editando: ${product.name}`
  );

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
  markEditorClean();
}

$("#new-product-button")?.addEventListener("click", clearEditor);
$("#cancel-edit-button")?.addEventListener("click", clearEditor);

/* =========================================================
   ALMACENAMIENTO DE IMÁGENES
   ========================================================= */

async function uploadImage(productId, file, subfolder = "") {
  if (!file) {
    return "";
  }

  if (!file.type.startsWith("image/")) {
    throw new Error(
      `El archivo ${file.name} no parece una imagen.`
    );
  }

  if (file.size > 8 * 1024 * 1024) {
    throw new Error(
      `${file.name} supera el límite recomendado de 8 MB.`
    );
  }

  const safeName = slugify(
    file.name.replace(/\.[^.]+$/, "")
  );

  const ext = (file.name.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "jpg";

  const path =
    `${productId}/${subfolder ? `${subfolder}/` : ""}${crypto.randomUUID()}-${safeName}.${ext}`;

  const bucket = CONFIG.storageBucket || "product-images";

  const { error } = await supabase
    .storage
    .from(bucket)
    .upload(path, file, {
      contentType: file.type,
      upsert: false
    });

  if (error) {
    throw new Error(
      `No se pudo subir ${file.name}: ${error.message}`
    );
  }

  const { data } = supabase
    .storage
    .from(bucket)
    .getPublicUrl(path);

  return data.publicUrl;
}

async function uploadMainImages(productId, files) {
  const urls = [];

  for (const file of files) {
    urls.push(await uploadImage(productId, file));
  }

  return urls;
}

/* =========================================================
   RECOPILAR Y VALIDAR VARIANTES
   ========================================================= */

async function collectVariants(productId, existingVariants = []) {
  const colorRows = Array.from(baseColorManager?.querySelectorAll('[data-variant-group][data-base-group="true"] [data-variant-row]') || []);
  const baseUSD = toOptionalNumber($("#product-price-usd").value, "Precio base en dólares");
  const baseNIO = toOptionalNumber($("#product-price-nio").value, "Precio base en córdobas");

  const colorDrafts = colorRows.map((row, index) => {
    const color = row.querySelector("[data-variant-color]")?.value.trim() || "";
    const color_hex = validHex(row.querySelector("[data-variant-hex]")?.value);
    const availability = normalizeVariantAvailability(row.querySelector("[data-variant-availability]")?.value);
    initVariantImageItems(row);
    if (!color) throw new Error(`Completá el nombre del color ${index + 1}.`);
    return { color, color_hex, availability, row, imageItems: row._variantImageItems || [] };
  });

  const seenColors = new Set();
  for (const color of colorDrafts) {
    const key = color.color.toLocaleLowerCase("es");
    if (seenColors.has(key)) throw new Error(`El color "${color.color}" está repetido. Cada color debe tener un nombre único.`);
    seenColors.add(key);
  }

  const groupNodes = Array.from(variantsContainer?.querySelectorAll('[data-variant-group][data-base-group="false"]') || []);
  const configurations = groupNodes.map((group, index) => {
    const read = selector => group.querySelector(selector)?.value.trim() || "";
    const storageRaw = read("[data-group-storage]");
    const ramRaw = read("[data-group-ram]");
    if (!storageRaw && !ramRaw) {
      throw new Error(`Indicá almacenamiento o RAM en la configuración ${index + 1}.`);
    }
    return {
      storage: storageRaw ? `${storageRaw} GB` : "",
      ram: ramRaw ? `${ramRaw} GB` : "",
      price_usd: toOptionalNumber(read("[data-group-price-usd]"), `Precio en dólares de configuración ${index + 1}`),
      price_nio: toOptionalNumber(read("[data-group-price-nio]"), `Precio en córdobas de configuración ${index + 1}`)
    };
  });

  const seenConfigurations = new Set();
  configurations.forEach((config, index) => {
    const key = [config.storage, config.ram].join("|").toLocaleLowerCase("es");
    if (seenConfigurations.has(key)) {
      throw new Error(`La configuración ${index + 1} repite una combinación de almacenamiento y RAM.`);
    }
    seenConfigurations.add(key);
  });

  for (const color of colorDrafts) {
    const urls = [];
    const status = color.row.querySelector("[data-variant-status]");
    if (status && color.imageItems.some(item => item.kind === "new")) {
      status.textContent = `Subiendo fotografías de ${color.color}…`;
      status.dataset.state = "uploading";
    }
    try {
      for (const item of color.imageItems) {
        if (item.kind === "new") {
          const url = await uploadImage(productId, item.file, "variants");
          urls.push(url);
          item.kind = "existing";
          item.url = url;
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
          delete item.previewUrl;
          delete item.file;
        } else if (item.url) {
          urls.push(item.url);
        }
      }
      color.row._variantImageItems = color.imageItems;
      syncVariantImageFields(color.row);
      renderVariantImagePreview(color.row);
      color.images = urls;
      color.image_url = urls[0] || "";
      if (status) {
        status.textContent = urls.length ? `${urls.length} fotografía(s) guardadas para ${color.color}.` : "";
        status.dataset.state = "success";
      }
    } catch (error) {
      if (status) {
        status.textContent = `No se pudieron subir las fotografías de ${color.color}: ${error.message || "error desconocido"}`;
        status.dataset.state = "error";
      }
      throw error;
    }
  }

  if (!colorDrafts.length) return [];

  const configsToSave = configurations.length
    ? configurations
    : [{ storage: "", ram: "", price_usd: baseUSD, price_nio: baseNIO, isBase: true }];

  return configsToSave.flatMap(config => colorDrafts.map(color => ({
    storage: config.storage,
    ram: config.ram,
    color: color.color,
    color_hex: color.color_hex,
    price_usd: config.isBase ? baseUSD : config.price_usd,
    price_nio: config.isBase ? baseNIO : config.price_nio,
    availability: color.availability,
    images: color.images || [],
    image_url: color.image_url || ""
  })));
}

function deriveColorsFromVariants(variants, fallbackColors = []) {
  if (!variants.length) {
    return [];
  }

  const byColor = new Map();

  variants.forEach(variant => {
    const key = variant.color.toLocaleLowerCase("es");

    if (!key) {
      return;
    }

    const previous = byColor.get(key);

    if (!previous) {
      byColor.set(key, {
        name: variant.color,
        type: variant.availability,
        image_url: (variant.images && variant.images[0]) || variant.image_url || "",
        images: variant.images || (variant.image_url ? [variant.image_url] : []),
        color_hex: validHex(variant.color_hex)
      });
    } else {
      if (variant.availability === "available") {
        previous.type = "available";
      }

      if (!previous.image_url && (variant.images?.[0] || variant.image_url)) previous.image_url = variant.images?.[0] || variant.image_url;
      if ((!previous.images || !previous.images.length) && variant.images?.length) previous.images = variant.images;
    }
  });

  return Array.from(byColor.values());
}

/* =========================================================
   GUARDAR PRODUCTOS
   ========================================================= */

form?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser || !supabase) {
    message(
      "#product-form-status",
      "Tu sesión administrativa no está activa. Volvé a iniciar sesión.",
      "error"
    );

    return;
  }

  const button = $("#save-product-button");
  const wasEditing = Boolean($("#product-id").value);

  button.disabled = true;
  button.textContent = "Guardando…";

  try {
    const name = $("#product-name").value.trim();

    if (!name) {
      throw new Error("Escribí el nombre del producto.");
    }

    const id =
      $("#product-id").value || crypto.randomUUID();

    const existingProduct = products.find(
      product => String(product.id) === String(id)
    );

    const catalogKey = $("#catalog-key").value.trim() ||
      `${slugify(name)}-${id.slice(0, 8)}`;

    const variants = await collectVariants(
      id,
      existingProduct?.variants || []
    );

    const uploadedMainImages = [];
    for (let imageIndex=0; imageIndex<mainImageItems.length; imageIndex++) {
      const item=mainImageItems[imageIndex];
      if(item.kind==="new"){
        message("#product-form-status", `Subiendo fotografía ${imageIndex+1} de ${mainImageItems.length}…`);
        const url=await uploadImage(id,item.file);uploadedMainImages.push(url);item.kind="existing";item.url=url;
        if(item.previewUrl)URL.revokeObjectURL(item.previewUrl);delete item.previewUrl;delete item.file;
      }else uploadedMainImages.push(item.url);
    }
    renderMainImagePreviews();

    const colors = deriveColorsFromVariants(
      variants,
      existingProduct?.colors || []
    );

    const baseUSD = toOptionalNumber(
      $("#product-price-usd").value,
      "Precio base en dólares"
    );

    const baseNIO = toOptionalNumber(
      $("#product-price-nio").value,
      "Precio base en córdobas"
    );

    const warranty = toOptionalNumber(
      $("#product-warranty").value,
      "Garantía"
    );

    const priceUSD = variants.length
      ? minimumPrice(variants, "price_usd") ?? baseUSD
      : baseUSD;

    const priceNIO = variants.length
      ? minimumPrice(variants, "price_nio") ?? baseNIO
      : baseNIO;

    const allImages = [...new Set(uploadedMainImages)];

    const now = new Date().toISOString();

    const payload = {
      catalog_key: catalogKey,

      sort_order: wasEditing
        ? Number(existingProduct?.sort_order ?? products.length)
        : products.length,

      name,

      brand: $("#product-brand").value.trim() || null,
      model: $("#product-model").value.trim() || null,
      category: $("#product-category").value,

      availability: normalizeProductAvailability(
        $("#product-availability").value
      ),

      price_usd: priceUSD,
      price_nio: priceNIO,
      warranty_months: warranty,

      // Se conserva la descripción anterior sin mostrar un campo redundante en el editor.
      description: existingProduct?.description || null,

      specifications: parseSpecs(
        $("#product-specs").value
      ),

      images: allImages,
      image_url: allImages[0] || null,

      colors,
      variants,

      financing_note:
        $("#product-financing").value.trim() ||
        "Financiamiento mediante crédito o tarjeta. Consultá requisitos y condiciones de aprobación.",

      shipping_note:
        $("#product-shipping").value.trim() || null,

      featured: $("#product-featured").checked,
      is_published: $("#product-active").checked,

      updated_at: now,
      updated_by: currentUser.id
    };

    let result;

    if (wasEditing) {
      result = await supabase
        .from("products")
        .update(payload)
        .eq("id", id);
    } else {
      result = await supabase
        .from("products")
        .insert({
          ...payload,
          id,
          created_at: now
        });
    }

    if (result.error) {
      throw result.error;
    }

    message(
      "#product-form-status",
      "Producto guardado correctamente.",
      "success"
    );

    setStatus(`Guardado: ${name}`, "success");

    clearEditor();

    await loadProducts();
  } catch (error) {
    message(
      "#product-form-status",
      error.message ||
        "Ocurrió un error al guardar el producto.",
      "error"
    );
  } finally {
    button.disabled = false;

    button.textContent = $("#product-id").value
      ? "Guardar cambios"
      : "Guardar producto";
  }
});

/* =========================================================
   IMPORTAR JSON
   ========================================================= */

$("#import-json-file")?.addEventListener("change", async event => {
  const file = event.target.files?.[0];

  if (!file || !supabase || !currentUser) {
    return;
  }

  const node = $("#import-status");

  message(node, "Leyendo el archivo…");

  try {
    const raw = JSON.parse(await file.text());

    const rows = Array.isArray(raw)
      ? raw
      : raw.products;

    if (!Array.isArray(rows) || !rows.length) {
      throw new Error(
        "El JSON debe contener una lista de productos."
      );
    }

    const importTime = new Date().toISOString();

    const payload = rows.map((product, index) => {
      if (!product.name || !product.category) {
        throw new Error(
          `El producto ${index + 1} necesita nombre y categoría.`
        );
      }

      const variants = normalizeVariants(product.variants);

      const colors = variants.length
        ? deriveColorsFromVariants(variants, product.colors)
        : normalizeColors(product.colors);

      const images = Array.isArray(product.images)
        ? product.images
        : typeof product.image_url === "string" && product.image_url
          ? [product.image_url]
          : [];

      const baseUSD = toOptionalNumber(
        product.price_usd,
        "Precio en dólares"
      );

      const baseNIO = toOptionalNumber(
        product.price_nio,
        "Precio en córdobas"
      );

      return {
        catalog_key: product.catalog_key ||
          `${slugify(product.name)}-${crypto.randomUUID().slice(0, 8)}`,

        sort_order: index,
        created_at: importTime,
        updated_at: importTime,
        updated_by: currentUser.id,

        name: String(product.name),
        brand: product.brand || null,
        model: product.model || null,
        category: String(product.category),

        price_usd: variants.length
          ? minimumPrice(variants, "price_usd") ?? baseUSD
          : baseUSD,

        price_nio: variants.length
          ? minimumPrice(variants, "price_nio") ?? baseNIO
          : baseNIO,

        description: product.description || null,

        specifications:
          product.specifications &&
          typeof product.specifications === "object"
            ? product.specifications
            : product.specs &&
              typeof product.specs === "object"
              ? product.specs
              : {},

        warranty_months: toOptionalNumber(
          product.warranty_months,
          "Garantía"
        ),

        availability: normalizeProductAvailability(
          product.availability
        ),

        financing_note: product.financing_note ||
          "Financiamiento mediante crédito o tarjeta. Consultá requisitos y condiciones de aprobación.",

        shipping_note: product.shipping_note || null,

        images,
        image_url: images[0] || product.image_url || null,

        colors,
        variants,

        featured: false,
        is_published: false
      };
    });

    const { error } = await supabase
      .from("products")
      .insert(payload);

    if (error) {
      throw error;
    }

    message(
      node,
      `${payload.length} productos importados como borradores. Revisá variantes, precios y fotografías antes de publicar.`,
      "success"
    );

    await loadProducts();
  } catch (error) {
    message(
      node,
      error.message || "No se pudo importar el archivo.",
      "error"
    );
  } finally {
    event.target.value = "";
  }
});

/* =========================================================
   INICIALIZACIÓN DEL PANEL
   ========================================================= */

handleSession().catch(async error => {
  await signOutLocalSafely();

  showLoginScreen(
    error.message || "No se pudo comprobar la sesión.",
    "error"
  );
});
