import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* =========================================================
   CT ADMINISTRACIÓN
   Inicio de sesión, inventario y variantes
   ========================================================= */

const CONFIG = window.CATALOG_CONFIG || {};
const $ = selector => document.querySelector(selector);

const configured = Boolean(
  CONFIG.supabaseUrl &&
  CONFIG.supabaseAnonKey &&
  !String(CONFIG.supabaseUrl).includes("PON_AQUI") &&
  !String(CONFIG.supabaseAnonKey).includes("PON_AQUI")
);

const loginPanel = $("#login-panel");
const dashboard = $("#dashboard");
const form = $("#product-form");

let currentUser = null;
let products = [];
let editorDirty = false;
let initialFormSnapshot = "";

const ADMIN_PAGE_MARKER = "ct-admin-page-has-loaded";

function authStorageKey() {
  try {
    const projectRef = new URL(CONFIG.supabaseUrl)
      .hostname.split(".")[0];

    return `sb-${projectRef}-auth-token`;
  } catch {
    return null;
  }
}

/*
  Al recargar, se elimina la sesión local antes de crear el
  cliente Supabase. La primera carga de la pestaña no la elimina.
*/
function clearSessionOnReload() {
  try {
    const previousLoad =
      sessionStorage.getItem(ADMIN_PAGE_MARKER) === "1";

    if (previousLoad) {
      const key = authStorageKey();

      if (key) {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
      }
    }

    sessionStorage.setItem(ADMIN_PAGE_MARKER, "1");
  } catch (error) {
    console.warn("No se pudo comprobar la sesión anterior.", error);
  }
}

clearSessionOnReload();

/* Elimina posibles sesiones persistentes de una versión anterior. */
try {
  const oldKey = authStorageKey();

  if (oldKey) {
    localStorage.removeItem(oldKey);
  }
} catch (error) {
  console.warn("No se pudo limpiar la sesión anterior.", error);
}

const supabase = configured
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: {
        storage: sessionStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

/* =========================================================
   UTILIDADES
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
    type === "success" ? "#087f5b" : "";
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
    throw new Error(`${label} debe ser igual o mayor que cero.`);
  }

  return number;
}

function normalizeProductAvailability(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (["out_of_stock", "agotado", "agotado temporalmente"].includes(normalized)) {
    return "out_of_stock";
  }

  if (["on_order", "por pedido"].includes(normalized)) {
    return "on_order";
  }

  return "available";
}

function normalizeVariantAvailability(value) {
  return ["order", "on_order", "por pedido"]
    .includes(String(value || "").trim().toLowerCase())
      ? "order"
      : "available";
}

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
      if (typeof item === "string") return item;

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
    .filter(value => typeof value === "string" && value.trim());
}

function normalizeColors(value) {
  const colors = parseJSON(value, []);

  if (!Array.isArray(colors)) return [];

  return colors.map(item => {
    if (typeof item === "string") {
      return {
        name: item.trim(),
        type: "available",
        image_url: "",
        color_hex: "#315A91"
      };
    }

    if (!item || typeof item !== "object") return null;

    return {
      name: String(item.name || item.color || "").trim(),
      type: normalizeVariantAvailability(item.type),
      image_url: String(item.image_url || item.imageUrl || "").trim(),
      color_hex: validHex(item.color_hex || item.hex)
    };
  }).filter(item => item && item.name);
}

function normalizeVariants(value) {
  const variants = parseJSON(value, []);

  if (!Array.isArray(variants)) return [];

  return variants.map(item => {
    if (!item || typeof item !== "object") return null;

    const usd = item.price_usd == null || item.price_usd === ""
      ? null
      : Number(item.price_usd);

    const nio = item.price_nio == null || item.price_nio === ""
      ? null
      : Number(item.price_nio);

    return {
      storage: String(item.storage || item.capacity || "").trim(),
      ram: String(item.ram || "").trim(),
      color: String(item.color || item.name || "").trim(),
      color_hex: validHex(item.color_hex || item.hex),
      price_usd: Number.isFinite(usd) ? usd : null,
      price_nio: Number.isFinite(nio) ? nio : null,
      availability: normalizeVariantAvailability(item.availability),
      image_url: String(item.image_url || item.imageUrl || "").trim()
    };
  }).filter(item => item && (item.storage || item.ram || item.color));
}

function legacyVariants(product) {
  const variants = normalizeVariants(product?.variants);

  if (variants.length) return variants;

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

/* =========================================================
   CAMBIOS PENDIENTES Y ADVERTENCIA AL SALIR
   ========================================================= */

function getFormSnapshot() {
  if (!form) return "";

  return Array.from(form.elements)
    .filter(element =>
      element.name ||
      element.id
    )
    .map(element => {
      const key = element.name || element.id;

      if (element.type === "file") {
        return [key, Array.from(element.files || []).map(file => ({
          name: file.name,
          size: file.size,
          modified: file.lastModified
        }))];
      }

      if (element.type === "checkbox" || element.type === "radio") {
        return [key, element.checked];
      }

      return [key, element.value];
    });
}

function snapshotString() {
  return JSON.stringify(getFormSnapshot());
}

function markEditorClean() {
  initialFormSnapshot = snapshotString();
  editorDirty = false;
}

function hasUnsavedChanges() {
  if (!form || dashboard.classList.contains("hidden")) {
    return false;
  }

  return editorDirty || snapshotString() !== initialFormSnapshot;
}

form?.addEventListener("input", () => {
  editorDirty = snapshotString() !== initialFormSnapshot;
});

form?.addEventListener("change", () => {
  editorDirty = snapshotString() !== initialFormSnapshot;
});

/*
  El navegador muestra su propia advertencia si hay cambios
  pendientes. Si el usuario cancela, continúa en el panel.
  Si confirma la salida, la nueva carga limpiará la sesión.
*/
window.addEventListener("beforeunload", event => {
  if (!hasUnsavedChanges()) return;

  event.preventDefault();
  event.returnValue = "";
});

/* =========================================================
   CIERRE LOCAL DE SESIÓN
   ========================================================= */

function clearLocalAuthStorage() {
  try {
    const key = authStorageKey();

    if (key) {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.warn("No se pudo limpiar el almacenamiento de sesión.", error);
  }
}

async function signOutLocalSafely() {
  try {
    if (supabase) {
      const { error } = await supabase.auth.signOut({
        scope: "local"
      });

      if (error) {
        console.warn("Supabase informó un error al cerrar sesión:", error.message);
      }
    }
  } catch (error) {
    console.warn("No se pudo cerrar la sesión:", error);
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

  dashboard?.classList.add("hidden");
  loginPanel?.classList.remove("hidden");

  if (form) form.reset();

  clearEditor();

  if ($("#login-email")) {
    $("#login-email").value = "";
  }

  clearLoginPassword();
  setStatus("");
  message("#login-status", statusText, type);
}

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

  if (error) throw error;

  if (!data) {
    throw new Error(
      "El usuario inició sesión, pero no está autorizado en admin_users."
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
  const greeting = $("#admin-greeting");

  const displayName =
    metadata.full_name ||
    metadata.name ||
    metadata.display_name ||
    user.email?.split("@")[0] ||
    "";

  if (greeting) {
    greeting.textContent = displayName
      ? `¡Bienvenido de nuevo, ${displayName}! 👋`
      : "¡Bienvenido de nuevo! 👋";
  }

  setStatus(`Sesión iniciada como ${user.email || "administrador"}`);

  await loadProducts();
  markEditorClean();
}

async function handleSession() {
  if (!configured) {
    message(
      "#login-status",
      "Falta configurar Supabase en config.js.",
      "error"
    );
    return;
  }

  const { data, error } = await supabase.auth.getSession();

  if (error) throw error;

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
      error.message || "La sesión no está autorizada.",
      "error"
    );
  }
}

/* =========================================================
   INICIAR SESIÓN
   ========================================================= */

$("#login-form")?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!supabase) {
    message("#login-status", "Supabase no está configurado.", "error");
    clearLoginPassword();
    return;
  }

  const button = event.currentTarget.querySelector('button[type="submit"]');

  button.disabled = true;
  button.textContent = "Verificando…";

  message("#login-status", "Comprobando acceso…");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: $("#login-email").value.trim(),
      password: $("#login-password").value
    });

    if (error) throw error;

    await showDashboard(data.user);

    message("#login-status", "Acceso autorizado.", "success");
  } catch (error) {
    await signOutLocalSafely();

    dashboard.classList.add("hidden");
    loginPanel.classList.remove("hidden");

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

/* =========================================================
   CERRAR SESIÓN CON CONFIRMACIÓN
   ========================================================= */

$("#logout-button")?.addEventListener("click", async event => {
  event.preventDefault();

  if (hasUnsavedChanges()) {
    const leave = window.confirm(
      "Hay cambios sin guardar en el formulario.\n\n" +
      "Si cerrás sesión, podrías perderlos.\n\n" +
      "¿Querés continuar?"
    );

    if (!leave) return;
  } else {
    const confirmed = window.confirm(
      "¿Querés cerrar la sesión de administración?"
    );

    if (!confirmed) return;
  }

  const button = event.currentTarget;

  button.disabled = true;
  button.textContent = "Cerrando sesión…";

  try {
    await signOutLocalSafely();

    showLoginScreen("Sesión cerrada correctamente.", "success");
  } finally {
    button.disabled = false;
    button.textContent = "Cerrar sesión";
  }
});

/* =========================================================
   EDITOR DE VARIANTES ACTUAL
   ========================================================= */

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

function colorPaletteOptions(variant) {
  const matching = COLOR_PALETTE.find(item =>
    item.name.toLowerCase() === String(variant.color || "").toLowerCase() &&
    item.hex.toLowerCase() === validHex(variant.color_hex).toLowerCase()
  );

  const selected = !variant.color
    ? ""
    : matching
      ? matching.hex
      : "custom";

  return `
    <option value="" ${selected === "" ? "selected" : ""}>
      Seleccioná un color…
    </option>
    ${COLOR_PALETTE.map(item => `
      <option value="${item.hex}" ${selected === item.hex ? "selected" : ""}>
        ${escapeHtml(item.name)}
      </option>
    `).join("")}
    <option value="custom" ${selected === "custom" ? "selected" : ""}>
      Color personalizado
    </option>
  `;
}

function variantRowMarkup(variant = {}) {
  const value = {
    storage: String(variant.storage || "").trim(),
    ram: String(variant.ram || "").trim(),
    color: String(variant.color || "").trim(),
    color_hex: validHex(variant.color_hex || variant.hex),
    price_usd: variant.price_usd ?? "",
    price_nio: variant.price_nio ?? "",
    availability: normalizeVariantAvailability(variant.availability),
    image_url: String(variant.image_url || "").trim()
  };

  return `
    <article class="variant-admin-row" data-variant-row>
      <div class="variant-row-title">
        <strong data-variant-row-heading>Configuración del producto</strong>
        <button class="admin-mini-button danger"
                type="button"
                data-remove-variant>Quitar variante</button>
      </div>

      <div class="variant-fields-grid">
        <label>
          Almacenamiento / capacidad
          <input data-variant-storage maxlength="40"
                 value="${escapeHtml(value.storage)}"
                 placeholder="Ej. 256 GB">
        </label>

        <label>
          Memoria RAM
          <input data-variant-ram maxlength="40"
                 value="${escapeHtml(value.ram)}"
                 placeholder="Ej. 8 GB">
        </label>

        <label>
          Paleta de colores
          <select data-variant-palette>${colorPaletteOptions(value)}</select>
        </label>

        <label>
          Nombre del color *
          <input data-variant-color maxlength="60" required
                 value="${escapeHtml(value.color)}"
                 placeholder="Ej. Azul titanio">
        </label>

        <label class="variant-hex-label">
          Tono del color
          <span class="variant-hex-control">
            <input data-variant-hex type="color"
                   value="${value.color_hex}"
                   aria-label="Elegir tono del color">
          </span>
        </label>

        <label>
          Precio en dólares
          <input data-variant-price-usd type="number" min="0" step="0.01"
                 value="${escapeHtml(value.price_usd)}">
        </label>

        <label>
          Precio en córdobas
          <input data-variant-price-nio type="number" min="0" step="0.01"
                 value="${escapeHtml(value.price_nio)}">
        </label>

        <label>
          Disponibilidad
          <select data-variant-availability>
            <option value="available"
              ${value.availability === "available" ? "selected" : ""}>
              Disponible
            </option>
            <option value="order"
              ${value.availability === "order" ? "selected" : ""}>
              Por pedido
            </option>
          </select>
        </label>

        <label class="variant-image-label">
          Foto del color
          <input data-variant-image type="file"
                 accept="image/jpeg,image/png,image/webp,image/avif">
          <small>Opcional; máximo recomendado de 8 MB.</small>
        </label>

        <label class="variant-image-url-label">
          URL de fotografía existente
          <input data-variant-image-url type="url"
                 value="${escapeHtml(value.image_url)}"
                 placeholder="https://...">
        </label>
      </div>

      <p class="color-row-status" data-variant-status role="status"></p>
    </article>
  `;
}

function updateVariantRow
