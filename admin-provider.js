/* JB Manager · revisión del proveedor e importación segura de actualizaciones.
   Los datos del proveedor viven en tablas privadas; no se exponen al catálogo público. */

const REVIEW_INTERVAL_DAYS = 7;
const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function normalizedText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es").replace(/[^a-z0-9]+/g, " ").trim();
}

function displayDate(value) {
  if (!value) return "Nunca revisado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha desconocida";
  return date.toLocaleDateString("es-NI", { year: "numeric", month: "short", day: "numeric" });
}

function money(value, currency) {
  if (value === null || value === undefined || value === "") return "Sin dato";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Sin dato";
  return (currency === "NIO" ? "C$ " : "US$ ") + amount.toLocaleString(currency === "NIO" ? "es-NI" : "en-US", {
    minimumFractionDigits: 0, maximumFractionDigits: 2
  });
}

function cleanPrice(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  let raw = String(value).trim().replace(/(?:US\$|USD|C\$|NIO|\$)/gi, "").replace(/\s/g, "");
  if (raw.includes(",") && raw.includes(".")) raw = raw.replace(/,/g, "");
  else if (raw.includes(",")) {
    const decimalDigits = raw.length - raw.lastIndexOf(",") - 1;
    raw = decimalDigits > 0 && decimalDigits <= 2 ? raw.replace(",", ".") : raw.replace(/,/g, "");
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("El archivo contiene un precio inválido: " + value);
  return amount;
}

function normalizeAvailability(value, allowUnknown = true) {
  const normalized = normalizedText(value).replace(/ /g, "_");
  if (["available", "disponible", "in_stock", "en_stock", "si"].includes(normalized)) return "available";
  if (["on_order", "order", "por_pedido", "pedido", "bajo_pedido"].includes(normalized)) return "on_order";
  if (["out_of_stock", "agotado", "no_disponible", "sin_stock", "unavailable"].includes(normalized)) return "out_of_stock";
  return allowUnknown ? "unknown" : null;
}

function availabilityLabel(value) {
  return ({
    available: "Disponible", on_order: "Por pedido",
    out_of_stock: "Agotado", unknown: "Sin confirmar"
  })[value] || "Sin confirmar";
}

function parseMaybeJSON(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === ",") { row.push(cell.trim()); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(value => value !== "")) rows.push(row);
  if (rows.length < 2) throw new Error("El CSV debe incluir una fila de encabezados y al menos un producto.");
  const headers = rows[0].map((header, index) => {
    const clean = header.replace(/^\uFEFF/, "").trim();
    if (!clean) throw new Error("Hay una columna CSV sin nombre en la posición " + (index + 1) + ".");
    return clean;
  });
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function firstValue(row, aliases) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias) && row[alias] !== "" && row[alias] !== null && row[alias] !== undefined) return row[alias];
  }
  return null;
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  const token = normalizedText(value);
  if (["true", "1", "si", "yes", "original"].includes(token)) return true;
  if (["false", "0", "no", "non original", "imitacion"].includes(token)) return false;
  return null;
}

function importCatalogType(value, fallback) {
  const token = normalizedText(value);
  if (["perfumery", "perfumeria", "perfume", "parfums", "jb parfums"].includes(token)) return "perfumery";
  if (["technology", "tecnologia", "tech", "jb tech"].includes(token)) return "technology";
  return fallback;
}

function stableVariantKey(variant) {
  const part = value => normalizedText(value).replace(/\s/g, "");
  return [part(variant.ram), part(variant.storage || variant.capacity), part(variant.color)].join("|");
}

function mergeVariantImages(incomingValue, currentValue) {
  const incoming = parseMaybeJSON(incomingValue, []);
  if (!Array.isArray(incoming)) throw new Error("La lista de variantes debe ser un arreglo JSON.");
  const current = Array.isArray(currentValue) ? currentValue : parseMaybeJSON(currentValue, []);
  const oldByKey = new Map((Array.isArray(current) ? current : []).map(item => [stableVariantKey(item), item]));
  return incoming.map(item => {
    if (!item || typeof item !== "object") throw new Error("Cada variante debe ser un objeto.");
    const old = oldByKey.get(stableVariantKey(item)) || {};
    // Supplier feeds must never overwrite the carefully arranged photo gallery.
    const { images: ignoredImages, image_url: ignoredImageURL, imageUrl: ignoredImageUrl, ...providerVariant } = item;
    const existingImages = Array.isArray(old.images) ? old.images.filter(Boolean) : [old.image_url || old.imageUrl || ""].filter(Boolean);
    return {
      ...old, ...providerVariant,
      color: String(providerVariant.color ?? old.color ?? ""),
      images: existingImages,
      image_url: existingImages[0] || ""
    };
  });
}

function getProviderFields(row) {
  const providerName = String(firstValue(row, ["provider_name", "supplier_name", "proveedor"]) || "GoPartner").trim() || "GoPartner";
  const providerProductId = firstValue(row, ["provider_product_id", "supplier_product_id", "gopartner_id", "external_id", "sku_proveedor", "provider_sku"]);
  const providerURL = firstValue(row, ["provider_url", "supplier_url", "gopartner_url", "product_url", "url_proveedor"]);
  if (providerURL) {
    let parsedURL;
    try { parsedURL = new URL(String(providerURL)); } catch { throw new Error("La URL del proveedor no es válida: " + providerURL); }
    if (!["https:", "http:"].includes(parsedURL.protocol)) throw new Error("La URL del proveedor debe usar HTTP o HTTPS.");
  }
  const priceUSDSource = firstValue(row, ["provider_price_usd", "supplier_price_usd", "precio_proveedor_usd", "price_usd", "precio_usd"]);
  const priceNIOSource = firstValue(row, ["provider_price_nio", "supplier_price_nio", "precio_proveedor_nio", "price_nio", "precio_nio"]);
  const availabilitySource = firstValue(row, ["provider_availability", "supplier_availability", "availability", "estado", "disponibilidad"]);
  const availability = availabilitySource === null ? null : normalizeAvailability(availabilitySource);
  return {
    provider_name: providerName,
    provider_product_id: providerProductId === null ? null : String(providerProductId).trim() || null,
    provider_url: providerURL === null ? null : String(providerURL).trim() || null,
    provider_price_usd: cleanPrice(priceUSDSource),
    provider_price_nio: cleanPrice(priceNIOSource),
    provider_availability: availability,
    review_notes: firstValue(row, ["provider_notes", "supplier_notes", "review_notes", "notas_proveedor"]) === null
      ? null : String(firstValue(row, ["provider_notes", "supplier_notes", "review_notes", "notas_proveedor"])).trim()
  };
}

function getImportedCatalogFields(row) {
  const fields = {};
  const aliases = {
    name: ["catalog_name", "nombre_catalogo"],
    brand: ["catalog_brand", "marca_catalogo"],
    model: ["catalog_model", "modelo_catalogo"],
    category: ["catalog_category", "categoria_catalogo"],
    description: ["catalog_description", "descripcion_catalogo"],
    price_usd: ["catalog_price_usd", "public_price_usd", "selling_price_usd", "precio_catalogo_usd"],
    price_nio: ["catalog_price_nio", "public_price_nio", "selling_price_nio", "precio_catalogo_nio"],
    availability: ["catalog_availability", "disponibilidad_catalogo"]
  };
  for (const [field, keys] of Object.entries(aliases)) {
    const value = firstValue(row, keys);
    if (value !== null) {
      if (["price_usd", "price_nio"].includes(field)) fields[field] = cleanPrice(value);
      else if (field === "availability") {
        const normalized = normalizeAvailability(value, false);
        if (!normalized) throw new Error("Disponibilidad del catálogo no reconocida: " + value);
        fields[field] = normalized;
      } else fields[field] = String(value).trim();
    }
  }
  const variantSource = firstValue(row, ["catalog_variants", "variants_json", "variants"]);
  if (variantSource !== null) fields.variants = parseMaybeJSON(variantSource, null);
  return fields;
}

function matchProduct(row, products, statuses, fallbackType) {
  const sourceType = firstValue(row, ["catalog_type", "catalog", "tipo_catalogo", "catalogo"]);
  const rowType = sourceType === null ? fallbackType : importCatalogType(sourceType, fallbackType);
  const candidates = products.filter(product =>
    (rowType === "all" || importCatalogType(product.catalog_type, "technology") === rowType) &&
    !["trash", "deleting"].includes(product.workflow_status)
  );
  const internalId = firstValue(row, ["product_uuid", "local_product_id"]);
  const catalogKey = firstValue(row, ["catalog_key", "local_key", "clave_catalogo"]);
  const providerId = firstValue(row, ["provider_product_id", "supplier_product_id", "gopartner_id", "external_id", "sku_proveedor", "provider_sku"]);
  let matches = [];

  if (internalId) matches = candidates.filter(product => String(product.id) === String(internalId));
  if (!matches.length && catalogKey) matches = candidates.filter(product => String(product.catalog_key || "") === String(catalogKey));
  if (!matches.length && providerId) matches = candidates.filter(product => String(statuses.get(String(product.id))?.provider_product_id || "") === String(providerId));
  if (!matches.length) {
    const model = normalizedText(firstValue(row, ["model", "modelo", "product_model"]));
    const brand = normalizedText(firstValue(row, ["brand", "marca", "product_brand"]));
    if (model && brand) matches = candidates.filter(product => normalizedText(product.model) === model && normalizedText(product.brand) === brand);
  }
  if (!matches.length) {
    const name = normalizedText(firstValue(row, ["name", "product_name", "nombre", "product", "producto"]));
    const brand = normalizedText(firstValue(row, ["brand", "marca", "product_brand"]));
    if (name) matches = candidates.filter(product =>
      normalizedText(product.name) === name && (!brand || normalizedText(product.brand) === brand)
    );
  }
  return { product: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1, rowType };
}

export function initProviderTools({ getSupabase, getCurrentUser, getProducts }) {
  let providerStatuses = new Map();
  let importPlan = [];
  let rawImportRows = [];
  let lastRefreshError = "";
  const statusMessage = $("#provider-status-message");
  const importMessage = $("#provider-import-message");
  const reviewDialog = $("#provider-review-dialog");
  const historyDialog = $("#provider-history-dialog");
  const importPreview = $("#provider-import-preview");
  const importButton = $("#provider-import-apply");

  const say = (node, text, state = "") => {
    if (!node) return;
    node.textContent = text;
    node.classList.toggle("is-error", state === "error");
    node.classList.toggle("is-success", state === "success");
  };

  function activeProducts() {
    return (getProducts() || []).filter(product => !["trash", "deleting"].includes(product.workflow_status));
  }

  function reviewState(product) {
    const review = providerStatuses.get(String(product.id));
    if (!review?.last_reviewed_at) return { code: "missing", label: "Sin revisar", age: null, review };
    const time = new Date(review.last_reviewed_at).getTime();
    const age = Number.isFinite(time) ? Math.max(0, (Date.now() - time) / 86400000) : Infinity;
    if (age >= REVIEW_INTERVAL_DAYS) return { code: "overdue", label: "Revisar", age, review };
    return { code: "current", label: "Al día", age, review };
  }

  function renderProviderList() {
    const list = $("#provider-product-list");
    if (!list) return;
    const products = activeProducts();
    const typeFilter = $("#provider-catalog-filter")?.value || "all";
    const stateFilter = $("#provider-review-filter")?.value || "all";
    const query = normalizedText($("#provider-search")?.value || "");
    const rows = products.filter(product => {
      const type = importCatalogType(product.catalog_type, "technology");
      const state = reviewState(product);
      const blob = normalizedText([product.name, product.brand, product.model, product.category].join(" "));
      return (typeFilter === "all" || type === typeFilter) &&
        (stateFilter === "all" || state.code === stateFilter) &&
        (!query || blob.includes(query));
    }).sort((a, b) => {
      const order = { missing: 0, overdue: 1, current: 2 };
      return order[reviewState(a).code] - order[reviewState(b).code] ||
        String(a.name || "").localeCompare(String(b.name || ""), "es");
    });

    const all = products.map(reviewState);
    const missing = all.filter(state => state.code === "missing").length;
    const overdue = all.filter(state => state.code === "overdue").length;
    const current = all.filter(state => state.code === "current").length;
    const setText = (id, value) => { const node = $("#" + id); if (node) node.textContent = String(value); };
    setText("provider-count-missing", missing);
    setText("provider-count-overdue", overdue);
    setText("provider-count-current", current);
    setText("provider-nav-count", missing + overdue);

    if (lastRefreshError) {
      list.innerHTML = '<p class="provider-empty-state is-error">' + escapeHTML(lastRefreshError) + '</p>';
      return;
    }
    if (!rows.length) {
      list.innerHTML = '<p class="provider-empty-state">No hay productos que coincidan con estos filtros.</p>';
      return;
    }
    list.innerHTML = rows.map(product => {
      const state = reviewState(product);
      const review = state.review || {};
      const type = importCatalogType(product.catalog_type, "technology");
      const catalogLabel = type === "perfumery" ? "JB Parfums" : "JB TECH";
      const lastChecked = review.last_reviewed_at ? displayDate(review.last_reviewed_at) : "Nunca revisado";
      const checkedPrice = review.provider_price_usd != null ? money(review.provider_price_usd, "USD")
        : review.provider_price_nio != null ? money(review.provider_price_nio, "NIO") : "Precio sin registrar";
      const availability = availabilityLabel(review.provider_availability || "unknown");
      return `<article class="provider-product-row">
        <div class="provider-product-main">
          <div class="provider-product-title-line"><strong>${escapeHTML(product.name || "Producto sin nombre")}</strong><span class="provider-catalog-tag">${catalogLabel}</span></div>
          <p>${escapeHTML([product.brand, product.model].filter(Boolean).join(" · ") || product.category || "Sin marca o modelo")}</p>
          <div class="provider-product-facts"><span>Última revisión: <b>${escapeHTML(lastChecked)}</b></span><span>Precio proveedor: <b>${escapeHTML(checkedPrice)}</b></span><span>Estado proveedor: <b>${escapeHTML(availability)}</b></span></div>
          ${review.provider_url ? '<a class="provider-source-link" href="' + escapeHTML(review.provider_url) + '" target="_blank" rel="noopener noreferrer">Abrir ficha del proveedor ↗</a>' : ""}
        </div>
        <div class="provider-product-actions"><span class="provider-review-state ${state.code}">${state.label}</span>
          <button type="button" class="button button-outline provider-action" data-provider-review="${escapeHTML(product.id)}">${state.code === "missing" ? "Registrar revisión" : "Actualizar revisión"}</button>
          ${review.last_reviewed_at ? '<button type="button" class="button button-quiet provider-history-action" data-provider-history="' + escapeHTML(product.id) + '">Historial</button>' : ""}
        </div>
      </article>`;
    }).join("");
  }

  async function refresh() {
    const supabase = getSupabase();
    const user = getCurrentUser();
    if (!supabase || !user) {
      lastRefreshError = "";
      renderProviderList();
      return false;
    }
    const button = $("#provider-refresh");
    if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
    lastRefreshError = "";
    try {
      const { data, error } = await supabase.from("product_provider_status").select("*").order("last_reviewed_at", { ascending: false }).limit(5000);
      if (error) throw error;
      providerStatuses = new Map((data || []).map(row => [String(row.product_id), row]));
      renderProviderList();
      refreshImportPlanIfPresent();
      return true;
    } catch (error) {
      lastRefreshError = "No se pudo cargar el seguimiento del proveedor: " + (error?.message || "error desconocido");
      renderProviderList();
      say(statusMessage, lastRefreshError, "error");
      return false;
    } finally {
      if (button) { button.disabled = false; button.removeAttribute("aria-busy"); }
    }
  }

  function openReview(productId) {
    const product = activeProducts().find(item => String(item.id) === String(productId));
    if (!product || !reviewDialog) return;
    const review = providerStatuses.get(String(product.id)) || {};
    $("#provider-review-product-id").value = product.id;
    $("#provider-review-product-title").textContent = product.name || "Producto sin nombre";
    $("#provider-review-product-subtitle").textContent = importCatalogType(product.catalog_type, "technology") === "perfumery" ? "JB Parfums" : "JB TECH";
    $("#provider-review-name").value = review.provider_name || "GoPartner";
    $("#provider-review-id").value = review.provider_product_id || "";
    $("#provider-review-url").value = review.provider_url || "";
    $("#provider-review-price-usd").value = review.provider_price_usd ?? "";
    $("#provider-review-price-nio").value = review.provider_price_nio ?? "";
    $("#provider-review-availability").value = review.provider_availability || "unknown";
    $("#provider-review-notes").value = review.review_notes || "";
    say(statusMessage, "");
    if (typeof reviewDialog.showModal === "function") reviewDialog.showModal();
    else reviewDialog.setAttribute("open", "");
  }

  async function saveReview(event) {
    event.preventDefault();
    const supabase = getSupabase();
    const user = getCurrentUser();
    const productId = $("#provider-review-product-id").value;
    const product = activeProducts().find(item => String(item.id) === String(productId));
    if (!supabase || !user || !product) { say(statusMessage, "Tu sesión venció o el producto ya no está disponible.", "error"); return; }

    const providerName = $("#provider-review-name").value.trim() || "GoPartner";
    const providerURL = $("#provider-review-url").value.trim();
    if (providerURL) {
      let parsed;
      try { parsed = new URL(providerURL); } catch { say(statusMessage, "La dirección del proveedor no es válida.", "error"); return; }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") { say(statusMessage, "El enlace del proveedor debe comenzar con http:// o https://.", "error"); return; }
    }
    let priceUSD, priceNIO;
    try {
      priceUSD = cleanPrice($("#provider-review-price-usd").value);
      priceNIO = cleanPrice($("#provider-review-price-nio").value);
    } catch (error) { say(statusMessage, error.message, "error"); return; }

    const previous = providerStatuses.get(String(product.id)) || {};
    const payload = {
      product_id: product.id,
      provider_name: providerName,
      provider_product_id: $("#provider-review-id").value.trim() || null,
      provider_url: providerURL || null,
      provider_price_usd: priceUSD,
      provider_price_nio: priceNIO,
      provider_availability: $("#provider-review-availability").value || "unknown",
      review_notes: $("#provider-review-notes").value.trim() || null,
      last_reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
      created_at: previous.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const button = $("#provider-review-save");
    if (button) { button.disabled = true; button.textContent = "Guardando…"; }
    try {
      const { error } = await supabase.from("product_provider_status").upsert(payload, { onConflict: "product_id" });
      if (error) throw error;
      providerStatuses.set(String(product.id), payload);
      if (typeof reviewDialog.close === "function") reviewDialog.close(); else reviewDialog.removeAttribute("open");
      say(statusMessage, "Revisión guardada. Se añadió una entrada al historial privado.", "success");
      await refresh();
    } catch (error) {
      say(statusMessage, "No se pudo guardar la revisión: " + (error?.message || "error desconocido"), "error");
    } finally {
      if (button) { button.disabled = false; button.textContent = "Guardar revisión"; }
    }
  }

  async function openHistory(productId) {
    const supabase = getSupabase();
    const product = activeProducts().find(item => String(item.id) === String(productId));
    if (!supabase || !getCurrentUser() || !product || !historyDialog) return;
    $("#provider-history-title").textContent = "Historial · " + (product.name || "Producto");
    const body = $("#provider-history-content");
    body.innerHTML = '<p class="provider-empty-state">Cargando historial…</p>';
    if (typeof historyDialog.showModal === "function") historyDialog.showModal();
    else historyDialog.setAttribute("open", "");
    try {
      const { data, error } = await supabase.from("product_provider_review_history")
        .select("provider_name,provider_product_id,provider_url,provider_price_usd,provider_price_nio,provider_availability,review_notes,reviewed_at")
        .eq("product_id", product.id).order("reviewed_at", { ascending: false }).limit(30);
      if (error) throw error;
      if (!data?.length) { body.innerHTML = '<p class="provider-empty-state">No hay revisiones anteriores para este producto.</p>'; return; }
      body.innerHTML = data.map(row => `<article class="provider-history-entry">
        <div class="provider-history-entry-heading"><strong>${escapeHTML(displayDate(row.reviewed_at))}</strong><span>${escapeHTML(row.provider_name || "GoPartner")}</span></div>
        <p>Precio proveedor: ${escapeHTML(money(row.provider_price_usd, "USD"))} ${row.provider_price_nio != null ? " · " + escapeHTML(money(row.provider_price_nio, "NIO")) : ""}</p>
        <p>Disponibilidad: ${escapeHTML(availabilityLabel(row.provider_availability))}</p>
        ${row.provider_product_id ? "<p>ID proveedor: " + escapeHTML(row.provider_product_id) + "</p>" : ""}
        ${row.review_notes ? "<p>" + escapeHTML(row.review_notes) + "</p>" : ""}
        ${row.provider_url ? '<a href="' + escapeHTML(row.provider_url) + '" target="_blank" rel="noopener noreferrer">Abrir ficha del proveedor ↗</a>' : ""}
      </article>`).join("");
    } catch (error) {
      body.innerHTML = '<p class="provider-empty-state is-error">' + escapeHTML("No se pudo leer el historial: " + (error?.message || "error")) + '</p>';
    }
  }

  function parseImportFile(file) {
    const ext = String(file.name.split(".").pop() || "").toLowerCase();
    return file.text().then(text => {
      if (ext === "csv") return parseCSV(text);
      const parsed = JSON.parse(text);
      const rows = Array.isArray(parsed) ? parsed : parsed.products;
      if (!Array.isArray(rows)) throw new Error("El JSON debe contener una lista de productos en products o ser un arreglo.");
      return rows;
    });
  }

  function planImportedRows(rows) {
    const products = activeProducts();
    const importCatalog = $("#provider-import-catalog")?.value || "technology";
    const plan = [];
    const seen = new Set();
    rows.forEach((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        plan.push({ index: index + 1, error: "Fila no válida", row });
        return;
      }
      const match = matchProduct(row, products, providerStatuses, importCatalog);
      if (!match.product) {
        plan.push({
          index: index + 1, row, product: null, ambiguous: match.ambiguous,
          error: match.ambiguous ? "Coincidencia ambigua; no se actualizará automáticamente." : "No coincide con un producto existente."
        });
        return;
      }
      const id = String(match.product.id);
      if (seen.has(id)) {
        plan.push({ index: index + 1, row, product: match.product, error: "Duplicado dentro del archivo; se omite para evitar sobrescritura." });
        return;
      }
      seen.add(id);
      let provider;
      let catalogFields;
      try {
        provider = getProviderFields(row);
        catalogFields = getImportedCatalogFields(row);
      } catch (error) {
        plan.push({ index: index + 1, row, product: match.product, error: error.message || "Datos de importación inválidos." });
        return;
      }
      const hasProviderData = Boolean(provider.provider_product_id || provider.provider_url ||
        provider.provider_price_usd !== null || provider.provider_price_nio !== null ||
        provider.provider_availability !== null || provider.review_notes !== null ||
        firstValue(row, ["provider_name", "supplier_name", "proveedor"]) !== null);
      plan.push({ index: index + 1, row, product: match.product, provider, catalogFields, hasProviderData, rowType: match.rowType });
    });
    return plan;
  }

  function refreshImportPlanIfPresent() {
    if (!rawImportRows.length) return;
    importPlan = planImportedRows(rawImportRows);
    renderImportPreview();
  }

  function renderImportPreview() {
    if (!importPreview) return;
    const matched = importPlan.filter(item => item.product && !item.error).length;
    const unmatched = importPlan.length - matched;
    const summary = $("#provider-import-summary");
    if (summary) summary.textContent = `${matched} coincidencia(s) segura(s) · ${unmatched} fila(s) que requieren revisión o se omitirán.`;
    if (!importPlan.length) {
      importPreview.innerHTML = "";
      if (importButton) importButton.disabled = true;
      return;
    }
    importPreview.innerHTML = `<div class="provider-import-table-wrap"><table class="provider-import-table">
      <thead><tr><th>Fila</th><th>Producto reconocido</th><th>Datos del proveedor</th><th>Resultado</th></tr></thead>
      <tbody>${importPlan.map(item => {
        const name = item.product?.name || firstValue(item.row || {}, ["name", "product_name", "nombre", "product", "producto"]) || "Producto no identificado";
        const provider = item.provider || {};
        const sourcePrice = provider.provider_price_usd != null ? money(provider.provider_price_usd, "USD")
          : provider.provider_price_nio != null ? money(provider.provider_price_nio, "NIO") : "Sin precio";
        const sourceAvailability = provider.provider_availability ? availabilityLabel(provider.provider_availability) : "Sin estado";
        const result = item.error || (item.product ? "Listo para aplicar" : "Omitido");
        return `<tr><td>${item.index}</td><td>${escapeHTML(name)}<small>${item.product ? escapeHTML(item.product.catalog_type === "perfumery" ? "JB Parfums" : "JB TECH") : ""}</small></td><td>${escapeHTML(sourcePrice)}<small>${escapeHTML(sourceAvailability)}</small></td><td><span class="${item.error ? "provider-import-error" : "provider-import-ready"}">${escapeHTML(result)}</span></td></tr>`;
      }).join("")}</tbody></table></div>`;
    if (importButton) importButton.disabled = matched === 0;
  }

  async function previewImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      say(importMessage, "El archivo supera 8 MB. Separalo en archivos más pequeños.", "error");
      event.target.value = "";
      return;
    }
    say(importMessage, "Leyendo y comparando el archivo…");
    rawImportRows = [];
    importPlan = [];
    if (importButton) importButton.disabled = true;
    try {
      rawImportRows = await parseImportFile(file);
      if (!rawImportRows.length) throw new Error("No hay productos en el archivo.");
      if (rawImportRows.length > 1500) throw new Error("El archivo supera 1.500 filas. Separalo para revisar cada lote.");
      importPlan = planImportedRows(rawImportRows);
      renderImportPreview();
      say(importMessage, "Vista previa lista. Ningún producto se ha modificado todavía.", "success");
    } catch (error) {
      say(importMessage, error?.message || "No se pudo leer el archivo.", "error");
      if (importPreview) importPreview.innerHTML = "";
      const summary = $("#provider-import-summary");
      if (summary) summary.textContent = "";
    } finally {
      event.target.value = "";
    }
  }

  async function applyImport() {
    const supabase = getSupabase();
    const user = getCurrentUser();
    if (!supabase || !user) { say(importMessage, "Iniciá sesión antes de aplicar los cambios.", "error"); return; }
    const matchedItems = importPlan.filter(item => item.product && !item.error);
    if (!matchedItems.length) { say(importMessage, "No hay coincidencias seguras para aplicar.", "error"); return; }
    const updateCatalogFields = $("#provider-import-update-catalog")?.checked === true;
    const updateDescription = $("#provider-import-update-description")?.checked === true;
    const updateVariants = $("#provider-import-update-variants")?.checked === true;
    const updatePerfumeDetails = $("#provider-import-update-perfume")?.checked === true;
    const messageText = `Se procesarán ${matchedItems.length} producto(s). No se cambiarán fotografías, publicación ni categorías de publicación. ¿Continuar?`;
    if (!window.confirm(messageText)) return;

    importButton.disabled = true;
    importButton.textContent = "Aplicando cambios…";
    let succeeded = 0, failed = 0, providerUpdates = 0;
    const problems = [];
    try {
      for (const item of matchedItems) {
        const product = item.product;
        try {
          const prior = providerStatuses.get(String(product.id)) || {};
          const p = item.provider || {};
          if (item.hasProviderData) {
            const reviewedAt = new Date().toISOString();
            const providerPayload = {
              product_id: product.id,
              provider_name: p.provider_name || prior.provider_name || "GoPartner",
              provider_product_id: p.provider_product_id ?? prior.provider_product_id ?? null,
              provider_url: p.provider_url ?? prior.provider_url ?? null,
              provider_price_usd: p.provider_price_usd ?? prior.provider_price_usd ?? null,
              provider_price_nio: p.provider_price_nio ?? prior.provider_price_nio ?? null,
              provider_availability: p.provider_availability ?? prior.provider_availability ?? "unknown",
              review_notes: p.review_notes ?? prior.review_notes ?? null,
              last_reviewed_at: reviewedAt,
              reviewed_by: user.id,
              created_at: prior.created_at || reviewedAt,
              updated_at: reviewedAt
            };
            const { error } = await supabase.from("product_provider_status").upsert(providerPayload, { onConflict: "product_id" });
            if (error) throw error;
            providerStatuses.set(String(product.id), providerPayload);
            providerUpdates++;
          }

          const fields = item.catalogFields || {};
          const productUpdate = { updated_at: new Date().toISOString(), updated_by: user.id };
          if (updateCatalogFields) {
            for (const field of ["name", "brand", "model", "category", "price_usd", "price_nio", "availability"]) {
              if (Object.prototype.hasOwnProperty.call(fields, field)) productUpdate[field] = fields[field] === "" && ["brand", "model", "category"].includes(field) ? null : fields[field];
            }
          }
          if (updateDescription && Object.prototype.hasOwnProperty.call(fields, "description")) productUpdate.description = fields.description || null;
          if (updateVariants && fields.variants !== undefined) {
            productUpdate.variants = mergeVariantImages(fields.variants, product.variants);
            const usdPrices = productUpdate.variants.map(v => Number(v.price_usd)).filter(n => Number.isFinite(n) && n >= 0);
            const nioPrices = productUpdate.variants.map(v => Number(v.price_nio)).filter(n => Number.isFinite(n) && n >= 0);
            if (usdPrices.length) productUpdate.price_usd = Math.min(...usdPrices);
            if (nioPrices.length) productUpdate.price_nio = Math.min(...nioPrices);
          }
          // Never change publication state from a supplier feed.
          delete productUpdate.workflow_status;
          delete productUpdate.is_published;

          if (Object.keys(productUpdate).some(key => !["updated_at", "updated_by"].includes(key))) {
            const { error } = await supabase.from("products").update(productUpdate).eq("id", product.id);
            if (error) throw error;
          }

          if (updatePerfumeDetails && product.catalog_type === "perfumery") {
            const row = item.row;
            const existing = product.perfume_details || {};
            const detail = { product_id: product.id };
            const family = firstValue(row, ["family", "perfume_family", "familia_olfativa"]);
            if (family !== null) {
              const cleanFamily = normalizedText(family);
              const normalizedFamily = ["arabes", "arabe"].includes(cleanFamily) ? "arabes"
                : ["nicho"].includes(cleanFamily) ? "nicho"
                : ["disenador", "designer"].includes(cleanFamily) ? "disenador" : null;
              if (normalizedFamily) detail.family = normalizedFamily;
            }
            const detailAliases = {
              concentration: ["concentration", "concentracion"],
              volume_ml: ["volume_ml", "volume", "volumen_ml", "ml"],
              audience: ["audience", "publico", "target"],
              scent_family: ["scent_family", "olfactory_profile", "perfil_olfativo"]
            };
            for (const [field, aliases] of Object.entries(detailAliases)) {
              const value = firstValue(row, aliases);
              if (value !== null) detail[field] = field === "volume_ml" ? cleanPrice(value) : String(value).trim();
            }
            for (const field of ["top_notes", "heart_notes", "base_notes"]) {
              const value = firstValue(row, [field, field.replace("_", "-"), field.replace("_", " ")]);
              if (value !== null) {
                const parsed = parseMaybeJSON(value, null);
                detail[field] = Array.isArray(parsed) ? parsed.map(String) : String(value).split(/[;,|]/).map(s => s.trim()).filter(Boolean);
              }
            }
            const original = firstValue(row, ["is_original", "original"]);
            if (original !== null) {
              const parsed = parseBoolean(original);
              if (parsed !== null) detail.is_original = parsed;
            }
            if (Object.keys(detail).length > 1) {
              const { error } = await supabase.from("perfume_details").upsert(detail, { onConflict: "product_id" });
              if (error) throw error;
            }
          }
          succeeded++;
        } catch (error) {
          failed++;
          problems.push((product.name || "Producto") + ": " + (error?.message || "error desconocido"));
        }
      }
      await refresh();
      if (typeof window.dispatchEvent === "function") window.dispatchEvent(new CustomEvent("jb-catalog-provider-updated"));
      const summary = `Resultado: ${succeeded} producto(s) procesados; ${providerUpdates} revisión(es) del proveedor guardadas; ${failed} error(es). Las fotos y el estado de publicación se conservaron.`;
      say(importMessage, problems.length ? summary + " Detalles: " + problems.slice(0, 3).join(" · ") : summary, problems.length ? "error" : "success");
      if (!failed) {
        rawImportRows = [];
        importPlan = [];
        if (importPreview) importPreview.innerHTML = "";
        const summaryNode = $("#provider-import-summary");
        if (summaryNode) summaryNode.textContent = "";
        const fileNode = $("#provider-import-file");
        if (fileNode) fileNode.value = "";
      }
    } finally {
      importButton.disabled = false;
      importButton.textContent = "Aplicar actualizaciones";
    }
  }

  $("#provider-refresh")?.addEventListener("click", () => { void refresh(); });
  ["#provider-catalog-filter", "#provider-review-filter", "#provider-search"].forEach(selector =>
    $(selector)?.addEventListener(selector === "#provider-search" ? "input" : "change", renderProviderList)
  );
  $("#provider-product-list")?.addEventListener("click", event => {
    const review = event.target.closest("[data-provider-review]");
    const history = event.target.closest("[data-provider-history]");
    if (review) openReview(review.dataset.providerReview);
    else if (history) void openHistory(history.dataset.providerHistory);
  });
  $("#provider-review-form")?.addEventListener("submit", saveReview);
  $$("[data-provider-dialog-close]").forEach(button => button.addEventListener("click", () => {
    const dialog = button.closest("dialog");
    if (dialog?.close) dialog.close(); else dialog?.removeAttribute("open");
  }));
  $("#provider-import-file")?.addEventListener("change", event => { void previewImport(event); });
  $("#provider-import-apply")?.addEventListener("click", () => { void applyImport(); });
  $("#provider-import-download-template")?.addEventListener("click", () => {
    const template = {
      products: [
        {
          catalog_type: "technology",
          provider_product_id: "ID-DEL-PROVEEDOR",
          name: "Nombre del producto tal como aparece en el proveedor",
          brand: "Marca",
          model: "Modelo",
          provider_price_usd: 199.99,
          provider_availability: "available",
          provider_url: "https://example.com/producto",
          catalog_price_usd: 219.99,
          catalog_availability: "available",
          catalog_variants: []
        },
        {
          catalog_type: "perfumery",
          provider_product_id: "ID-PERFUME-PROVEEDOR",
          name: "Nombre de la fragancia",
          brand: "Marca",
          provider_price_usd: 39.99,
          provider_availability: "on_order",
          provider_url: "https://example.com/fragancia",
          catalog_price_usd: 44.99,
          catalog_availability: "on_order",
          family: "arabes",
          concentration: "Eau de Parfum",
          volume_ml: 100,
          audience: "unisex",
          scent_family: "amaderado",
          top_notes: ["bergamota"],
          heart_notes: ["lavanda"],
          base_notes: ["ámbar"]
        }
      ]
    };
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "jb-collections-plantilla-actualizaciones.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  });
  ["#provider-import-catalog", "#provider-import-update-catalog", "#provider-import-update-description",
   "#provider-import-update-variants", "#provider-import-update-perfume"].forEach(selector =>
    $(selector)?.addEventListener("change", () => {
      if (rawImportRows.length) {
        importPlan = planImportedRows(rawImportRows);
        renderImportPreview();
      }
    })
  );

  renderProviderList();
  return {
    refresh,
    render: renderProviderList,
    getStatus(productId) { return providerStatuses.get(String(productId)) || null; }
  };
}
