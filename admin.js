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

      image_url: String(
        item.image_url || item.imageUrl || ""
      ).trim()
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
    image_url: color.image_url
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
 const v={color:String(variant.color||"").trim(),color_hex:validHex(variant.color_hex||variant.hex),image_url:String(variant.image_url||"").trim(),availability:normalizeVariantAvailability(variant.availability)};
 return `<article class="variant-admin-row" data-variant-row>
 <div class="variant-row-title"><strong data-variant-row-heading>${escapeHtml(v.color||"Nuevo color")}</strong><button class="admin-mini-button danger" type="button" data-remove-variant>Quitar color</button></div>
 <div class="variant-fields-grid variant-color-fields">
 <label>Paleta de colores<select data-variant-palette>${colorPaletteOptions(v)}</select></label>
 <label>Nombre del color <span class="required-mark" aria-hidden="true">*</span><input data-variant-color maxlength="60" required value="${escapeHtml(v.color)}"></label>
 <label>Disponibilidad de este color<select data-variant-availability><option value="available" ${v.availability==="available"?"selected":""}>Disponible</option><option value="order" ${v.availability==="order"?"selected":""}>Por pedido</option><option value="out_of_stock" ${v.availability==="out_of_stock"?"selected":""}>No disponible</option></select></label>
 <label class="variant-hex-label">Tono del color<span class="variant-hex-control"><input data-variant-hex type="color" value="${v.color_hex}" aria-label="Elegir tono del color"><small>Ajustá el tono visualmente.</small></span></label>
 <label class="variant-image-label">Fotografía del color<input data-variant-image class="admin-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/avif"><span class="admin-file-picker admin-file-picker-compact"><span class="admin-file-picker-icon" aria-hidden="true">＋</span><span>Elegir foto</span></span><div class="variant-image-preview" data-variant-image-preview>${v.image_url?`<img src="${escapeHtml(v.image_url)}" alt="Foto de ${escapeHtml(v.color||"la variante")}" loading="lazy"><span>Foto actual</span><button type="button" class="admin-mini-button danger" data-remove-variant-image>Quitar foto</button>`:`<span class="variant-image-placeholder">La vista previa aparecerá aquí</span>`}</div></label><input data-variant-image-url type="hidden" value="${escapeHtml(v.image_url)}">
 </div><p class="color-row-status" data-variant-status role="status"></p></article>`;
}

function variantGroupKey(variant) {
  const storage = String(variant.storage || "").trim().toLocaleLowerCase("es");
  const ram = String(variant.ram || "").trim().toLocaleLowerCase("es");
  return `${storage}|${ram}`;
}

function variantGroupMarkup(v={},isBase=false){
 const storage=String(v.storage||"").trim().replace(/\s*GB\s*/i,""),ram=String(v.ram||"").trim().replace(/\s*GB\s*/i,"");
 const title=isBase?"Configuración base":[storage?storage+" GB":"",ram?ram+" GB RAM":""].filter(Boolean).join(" · ")||"Nueva configuración";
 return `<section class="variant-config-group ${isBase?"variant-base-group":""}" data-variant-group data-base-group="${isBase?"true":"false"}">
 <div class="variant-config-group-heading"><div><strong data-variant-group-title>${escapeHtml(title)}</strong><small>${isBase?"Usa el precio base del producto":"Precio compartido por los colores de esta capacidad y RAM"}</small></div>${isBase?"":'<button class="admin-mini-button danger" type="button" data-remove-group>Eliminar configuración</button>'}</div>
 <div class="variant-config-fields">
 <label>Almacenamiento<span class="variant-number-unit"><input data-group-storage type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(storage)}"><span>GB</span></span></label>
 <label>Memoria RAM<span class="variant-number-unit"><input data-group-ram type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(ram)}"><span>GB</span></span></label>
 ${isBase?"":'<label>Precio en dólares<span class="admin-input-unit"><span>$</span><input data-group-price-usd type="number" min="0" step="0.01" inputmode="decimal" value="'+escapeHtml(v.price_usd??"")+'"></span></label><label>Precio en córdobas<span class="admin-input-unit"><span>C$</span><input data-group-price-nio type="number" min="0" step="0.01" inputmode="decimal" value="'+escapeHtml(v.price_nio??"")+'"></span></label>'}
 </div><div class="variant-color-list" data-variant-color-list></div><button class="admin-mini-button variant-add-color" type="button" data-add-group-color>＋ Añadir color</button></section>`;
}

function renderVariantRows(variants=[]){
 const container=$("#product-variants-list");if(!container)return;
 const normalized=normalizeVariants(variants),groups=new Map();
 normalized.forEach(v=>{const k=variantGroupKey(v);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(v);});
 container.innerHTML="";
 const base=groups.get("|")||[];
 container.insertAdjacentHTML("beforeend",variantGroupMarkup(base[0]||{},true));
 const baseGroup=container.lastElementChild,list=baseGroup.querySelector("[data-variant-color-list]");
 base.forEach(v=>list.insertAdjacentHTML("beforeend",variantRowMarkup(v)));groups.delete("|");
 groups.forEach(items=>{container.insertAdjacentHTML("beforeend",variantGroupMarkup(items[0],false));const list=container.lastElementChild.querySelector("[data-variant-color-list]");items.forEach(v=>list.insertAdjacentHTML("beforeend",variantRowMarkup(v)));});
 updateVariantRowHeadings();
}

function addVariantRow(variant = {}, targetGroup = null) {
  const container = $("#product-variants-list");
  if (!container) return;
  container.querySelector(".variants-empty-hint")?.remove();
  let group = targetGroup;
  if (!group) {
    container.insertAdjacentHTML("beforeend", variantGroupMarkup(variant, false));
    group = container.lastElementChild;
  }
  const list = group.querySelector("[data-variant-color-list]");
  if (!list) return;
  list.insertAdjacentHTML("beforeend", variantRowMarkup(variant));
  updateVariantRowHeadings();
  const rows = list.querySelectorAll("[data-variant-row]");
  rows.item(rows.length - 1)?.querySelector("[data-variant-color]")?.focus();
}

function updateVariantRowHeadings() {
 document.querySelectorAll("[data-variant-group]").forEach(group=>{
 const s=group.querySelector("[data-group-storage]")?.value.trim(),r=group.querySelector("[data-group-ram]")?.value.trim();
 const title=[s?s+" GB":"",r?r+" GB RAM":""].filter(Boolean).join(" · ")||"Nueva configuración";
 const head=group.querySelector("[data-variant-group-title]");if(head)head.textContent=title;
 group.querySelectorAll("[data-variant-row]").forEach((row,i)=>{const color=row.querySelector("[data-variant-color]")?.value.trim(),heading=row.querySelector("[data-variant-row-heading]");if(heading)heading.textContent=color||"Color "+(i+1);});
 });
}

/* Vista previa de fotografías seleccionadas, antes de subirlas. */
const mainImagesInput = $("#product-images");
const mainImagesPreview = $("#product-images-preview");
const mainImagesSummary = $("#product-images-summary");
let mainImageObjectUrls = [];

function clearMainImagePreviews() {
  mainImageObjectUrls.forEach(url => URL.revokeObjectURL(url));
  mainImageObjectUrls = [];
  mainImagesPreview?.replaceChildren();
}

function renderMainImagePreviews() {
  if (!mainImagesInput || !mainImagesPreview || !mainImagesSummary) return;
  clearMainImagePreviews();
  const files = Array.from(mainImagesInput.files || []);
  mainImagesSummary.textContent = files.length
    ? `${files.length} fotografía${files.length === 1 ? "" : "s"} seleccionada${files.length === 1 ? "" : "s"}`
    : "Ninguna fotografía seleccionada";

  files.forEach(file => {
    const url = URL.createObjectURL(file);
    mainImageObjectUrls.push(url);
    const card = document.createElement("figure");
    card.className = "admin-image-preview-card";
    const img = document.createElement("img");
    img.src = url;
    img.alt = `Vista previa de ${file.name}`;
    const name = document.createElement("figcaption");
    name.textContent = file.name;
    const size = document.createElement("small");
    size.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
    const remove=document.createElement("button");remove.type="button";remove.className="admin-mini-button danger admin-preview-remove";remove.textContent="Quitar";remove.setAttribute("aria-label",`Quitar ${file.name}`);remove.addEventListener("click",()=>removeMainImageFile(file));card.append(img,name,size,remove);
    mainImagesPreview.append(card);
  });
}
function removeMainImageFile(target){if(!mainImagesInput)return;const transfer=new DataTransfer();Array.from(mainImagesInput.files||[]).forEach(file=>{if(!(file.name===target.name&&file.size===target.size&&file.lastModified===target.lastModified))transfer.items.add(file);});mainImagesInput.files=transfer.files;renderMainImagePreviews();updateEditorDirtyState();}
mainImagesInput?.addEventListener("change", renderMainImagePreviews);

function renderVariantImagePreview(row,file=null,fallbackUrl=""){
 const preview=row?.querySelector("[data-variant-image-preview]");if(!preview)return;preview.replaceChildren();
 const addRemove=()=>{const b=document.createElement("button");b.type="button";b.className="admin-mini-button danger";b.textContent="Quitar foto";b.addEventListener("click",()=>{row.querySelector("[data-variant-image]").value="";row.querySelector("[data-variant-image-url]").value="";renderVariantImagePreview(row);updateEditorDirtyState();});preview.append(b);};
 if(file){const img=document.createElement("img");img.src=URL.createObjectURL(file);img.alt=`Vista previa de ${file.name}`;const cap=document.createElement("span");cap.textContent=file.name;preview.append(img,cap);addRemove();}
 else if(fallbackUrl){const img=document.createElement("img");img.src=fallbackUrl;img.alt="Foto actual de la variante";img.loading="lazy";const cap=document.createElement("span");cap.textContent="Foto actual";preview.append(img,cap);addRemove();}
 else{const empty=document.createElement("span");empty.className="variant-image-placeholder";empty.textContent="La vista previa aparecerá aquí";preview.append(empty);}
}

const variantsContainer = $("#product-variants-list");

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

variantsContainer?.addEventListener("click",event=>{
 const add=event.target.closest("[data-add-group-color]");
 if(add){const group=add.closest("[data-variant-group]");if(group){addVariantRow({color:"",color_hex:"#242424",image_url:"",availability:"available"},group);updateEditorDirtyState();}return;}
 const removeGroup=event.target.closest("[data-remove-group]");
 if(removeGroup){removeGroup.closest("[data-variant-group]")?.remove();if(!variantsContainer.querySelector("[data-variant-group]"))renderVariantRows([]);updateEditorDirtyState();return;}
 const remove=event.target.closest("[data-remove-variant]");if(!remove)return;
 const group=remove.closest("[data-variant-group]");remove.closest("[data-variant-row]")?.remove();
 if(group&&!group.querySelector("[data-variant-row]"))group.remove();
 if(!variantsContainer.querySelector("[data-variant-group]"))renderVariantRows([]);else updateVariantRowHeadings();
});

variantsContainer?.addEventListener("change", event => {
  const imageInput = event.target.closest("[data-variant-image]");
  if (imageInput) {
    const row = imageInput.closest("[data-variant-row]");
    const file = imageInput.files?.[0] || null;
    const url = row?.querySelector("[data-variant-image-url]")?.value.trim() || "";
    renderVariantImagePreview(row, file, file ? "" : url);
    return;
  }
  const urlInput = event.target.closest("[data-variant-image-url]");
  if (urlInput) {
    const row = urlInput.closest("[data-variant-row]");
    const file = row?.querySelector("[data-variant-image]")?.files?.[0] || null;
    renderVariantImagePreview(row, file, urlInput.value.trim());
    return;
  }
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

variantsContainer?.addEventListener("input", event => {
  if (!event.target.matches("[data-variant-color], [data-group-storage], [data-group-ram]")) return;
  const row = event.target.closest("[data-variant-row]");
  if (event.target.matches("[data-group-storage], [data-group-ram]")) {
    updateVariantRowHeadings();
    return;
  }
  if (!row) return;

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

  $("#product-count").textContent =
    `${products.length} producto${products.length === 1 ? "" : "s"} en la base de datos`;
}

function renderAdminList() {
  const query = ($("#admin-search")?.value || "")
    .trim()
    .toLocaleLowerCase("es");

  const matches = products.filter(product =>
    [
      product.name,
      product.brand,
      product.model,
      product.category
    ]
      .join(" ")
      .toLocaleLowerCase("es")
      .includes(query)
  );

  $("#admin-product-list").innerHTML = matches.map(product => {
    const image = getImages(product)[0];

    const thumb = image
      ? `<img class="admin-product-thumb"
              src="${escapeHtml(image)}"
              alt=""
              loading="lazy">`
      : `<div class="admin-product-thumb"
              style="display:grid;place-items:center;color:#9aa6b9">▧</div>`;

    const state = product.is_published
      ? '<span class="status-pill published">Publicado</span>'
      : '<span class="status-pill">Borrador</span>';

    const variants = normalizeVariants(product.variants);

    const variantCount = variants.length;

    const variantLabel = variantCount
      ? ` · ${variantCount} variante${variantCount === 1 ? "" : "s"}`
      : "";

    const price = minimumPrice(variants, "price_usd")
      ?? product.price_usd;

    const formattedPrice =
      price === null || price === undefined || price === ""
        ? "Consultar"
        : `US$${Number(price).toLocaleString("en-US", {
            maximumFractionDigits: 2
          })}`;

    return `
      <article class="admin-product-row">
        ${thumb}

        <div>
          <p class="admin-product-name">
            ${escapeHtml(product.name)}
          </p>

          <div class="admin-product-meta">
            ${escapeHtml(product.category || "Sin categoría")}
            · ${escapeHtml(formattedPrice)}
            ${variantLabel}
            · ${state}
          </div>

          <div class="admin-product-buttons">
            <button
              class="admin-mini-button"
              type="button"
              data-edit="${escapeHtml(product.id)}"
            >Editar</button>

            <button
              class="admin-mini-button"
              type="button"
              data-toggle="${escapeHtml(product.id)}"
            >${product.is_published ? "Despublicar" : "Publicar"}</button>
          </div>
        </div>
      </article>
    `;
  }).join("") ||
    '<p class="form-status">No hay productos que coincidan con la búsqueda.</p>';
}

$("#admin-search")?.addEventListener("input", renderAdminList);

$("#admin-product-list")?.addEventListener("click", async event => {
  const edit = event.target.closest("[data-edit]");
  const toggle = event.target.closest("[data-toggle]");

  if (edit) {
    const product = products.find(
      item => String(item.id) === edit.dataset.edit
    );

    if (product) {
      fillEditor(product);
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
});


/* =========================================================
   PROTECCIÓN ANTE RECARGA CON CAMBIOS SIN GUARDAR
   ========================================================= */

let editorBaseline = "";
let editorIsDirty = false;

function getEditorSnapshot(){
 if(!form)return "";
 const fields=Array.from(form.elements).map(f=>{if(!f||(!f.name&&!f.id&&!f.matches?.("[data-variant-row],[data-variant-group]")))return null;if(f.type==="file")return [f.id||f.getAttribute("data-variant-image")||"file",Array.from(f.files||[]).map(x=>[x.name,x.size,x.lastModified])];if(f.type==="checkbox"||f.type==="radio")return [f.id||f.name,f.checked];return [f.id||f.name||f.getAttribute("data-variant-color")||f.getAttribute("data-group-storage")||f.getAttribute("data-group-ram")||f.getAttribute("data-group-price-usd")||f.getAttribute("data-group-price-nio")||f.getAttribute("data-variant-availability")||f.getAttribute("data-variant-image-url")||f.tagName,f.value];}).filter(Boolean);
 const variants=Array.from(form.querySelectorAll("[data-variant-group]")).map(g=>({storage:g.querySelector("[data-group-storage]")?.value||"",ram:g.querySelector("[data-group-ram]")?.value||"",usd:g.querySelector("[data-group-price-usd]")?.value||"",nio:g.querySelector("[data-group-price-nio]")?.value||"",colors:Array.from(g.querySelectorAll("[data-variant-row]")).map(r=>({color:r.querySelector("[data-variant-color]")?.value||"",hex:r.querySelector("[data-variant-hex]")?.value||"",availability:r.querySelector("[data-variant-availability]")?.value||"",url:r.querySelector("[data-variant-image-url]")?.value||""}))}));
 return JSON.stringify({fields,variants});
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
  renderMainImagePreviews();

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

async function collectVariants(productId,existingVariants=[]){
 const rows=Array.from($("#product-variants-list")?.querySelectorAll("[data-variant-row]")||[]);
 const baseUSD=toOptionalNumber($("#product-price-usd").value,"Precio base en dólares"),baseNIO=toOptionalNumber($("#product-price-nio").value,"Precio base en córdobas");
 const drafts=rows.map((row,i)=>{
  const group=row.closest("[data-variant-group]"),base=group?.dataset.baseGroup==="true",read=sel=>group?.querySelector(sel)?.value.trim()||"",sv=read("[data-group-storage]"),rv=read("[data-group-ram]"),storage=sv?`${sv} GB`:"",ram=rv?`${rv} GB`:"",color=row.querySelector("[data-variant-color]").value.trim(),color_hex=validHex(row.querySelector("[data-variant-hex]").value);
  const price_usd=base?baseUSD:toOptionalNumber(read("[data-group-price-usd]"),`Precio en dólares de configuración ${i+1}`),price_nio=base?baseNIO:toOptionalNumber(read("[data-group-price-nio]"),`Precio en córdobas de configuración ${i+1}`),availability=normalizeVariantAvailability(row.querySelector("[data-variant-availability]").value),image_url=row.querySelector("[data-variant-image-url]").value.trim(),file=row.querySelector("[data-variant-image]").files?.[0]||null;
  if(!color)throw new Error(`Completá el nombre del color en la variante ${i+1}.`);
  if(!storage&&!ram)throw new Error(`Indicá almacenamiento o RAM en la configuración ${i+1}.`);
  return {storage,ram,color,color_hex,price_usd,price_nio,availability,image_url,file,row};
 });
 const seen=new Set();for(const v of drafts){const key=[v.storage,v.ram,v.color].join("|").toLocaleLowerCase("es");if(seen.has(key))throw new Error(`La combinación ${[v.storage,v.ram,v.color].filter(Boolean).join(" · ")} está repetida.`);seen.add(key);}
 for(const v of drafts){if(v.file){const status=v.row.querySelector("[data-variant-status]");if(status)status.textContent=`Subiendo foto de ${v.color}…`;v.image_url=await uploadImage(productId,v.file,"variants");}}
 return drafts.map(({file,row,...v})=>v);
}

function deriveColorsFromVariants(variants, fallbackColors = []) {
  if (!variants.length) {
    return normalizeColors(fallbackColors);
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
        image_url: variant.image_url || "",
        color_hex: validHex(variant.color_hex)
      });
    } else {
      if (variant.availability === "available") {
        previous.type = "available";
      }

      if (!previous.image_url && variant.image_url) {
        previous.image_url = variant.image_url;
      }
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

    const newImages = Array.from(
      $("#product-images").files || []
    );

    const uploadedMainImages = await uploadMainImages(
      id,
      newImages
    );

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

    const allImages = [
      ...new Set([
        ...(existingProduct?.images || (existingProduct?.image_url ? [existingProduct.image_url] : [])),
        ...uploadedMainImages
      ])
    ];

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
