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
  if (["available", "disponible", "in_stock", "en_stock", "instock", "stock", "si"].includes(normalized)) return "available";
  if (["on_order", "order", "por_pedido", "pedido", "bajo_pedido", "backorder", "preorder", "pre_order"].includes(normalized)) return "on_order";
  if (["out_of_stock", "agotado", "no_disponible", "sin_stock", "unavailable", "sold_out"].includes(normalized)) return "out_of_stock";
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
  // CSV exports commonly use labels like "Provider Price USD"; normalize headers as a fallback.
  const headerKey = value => normalizedText(value).replace(/\s+/g, "_");
  const headers = Object.keys(row);
  for (const alias of aliases) {
    const matchedHeader = headers.find(header => headerKey(header) === headerKey(alias));
    if (matchedHeader && row[matchedHeader] !== "" && row[matchedHeader] !== null && row[matchedHeader] !== undefined) return row[matchedHeader];
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

function providerVariantConfigKey(variant) {
  const part = value => normalizedText(value).replace(/\s+/g, "");
  const storage = variant?.storage ?? variant?.capacity ??
    (variant?.storage_value != null ? String(variant.storage_value) + " " + String(variant.storage_unit || "GB") : "");
  return [part(variant?.ram), part(storage)].join("|");
}

function providerConfigLabel(group) {
  const storage = String(group?.storage || "").trim();
  const ramValue = String(group?.ram || "").trim().replace(/\s*GB\s*/i, "");
  const ram = ramValue ? (ramValue + " GB RAM") : "";
  return [storage, ram].filter(Boolean).join(" · ") || "Configuración principal";
}

function providerVariantSnapshotSummary(value) {
  const snapshot = parseMaybeJSON(value, []);
  if (!Array.isArray(snapshot) || !snapshot.length) return "";
  const groups = snapshot.length;
  const colors = snapshot.reduce((sum, group) => sum + (Array.isArray(group.colors) ? group.colors.length : 0), 0);
  const statuses = { available: 0, on_order: 0, out_of_stock: 0, unknown: 0 };
  snapshot.forEach(group => (Array.isArray(group.colors) ? group.colors : []).forEach(color => {
    const status = normalizeAvailability(color.provider_availability, false) || "unknown";
    statuses[status] += 1;
  }));
  const colorState = [
    statuses.available ? statuses.available + " disponibles" : "",
    statuses.on_order ? statuses.on_order + " por pedido" : "",
    statuses.out_of_stock ? statuses.out_of_stock + " agotados" : "",
    statuses.unknown ? statuses.unknown + " sin confirmar" : ""
  ].filter(Boolean).join(", ");
  return groups + " configuración(es) · " + colors + " color(es)" + (colorState ? " · " + colorState : "");
}

function catalogVariantSummary(product) {
  const variants = parseMaybeJSON(product?.variants, []);
  if (!Array.isArray(variants) || !variants.length) return "";
  const groups = new Map();
  for (const variant of variants) {
    if (!variant || typeof variant !== "object") continue;
    const key = providerVariantConfigKey(variant);
    if (!groups.has(key)) {
      groups.set(key, {
        label: providerConfigLabel(variant),
        availability: normalizeAvailability(variant.configuration_availability, false) || "unknown",
        colors: []
      });
    }
    const group = groups.get(key);
    const color = String(variant.color || "").trim();
    if (color && !group.colors.some(item => normalizedText(item.name) === normalizedText(color))) {
      group.colors.push({
        name: color,
        availability: normalizeAvailability(variant.availability, false) || "unknown"
      });
    }
  }
  return [...groups.values()].slice(0, 3).map(group => {
    const colorSummary = group.colors.length
      ? " · " + group.colors.length + " color(es): " + group.colors.slice(0, 3).map(color =>
          color.name + " (" + availabilityLabel(color.availability) + ")"
        ).join(", ") + (group.colors.length > 3 ? "…" : "")
      : "";
    return group.label + ": " + availabilityLabel(group.availability) + colorSummary;
  }).join(" | ") + (groups.size > 3 ? " | …" : "");
}

function providerVariantSnapshotHistoryHTML(value) {
  const snapshot = parseMaybeJSON(value, []);
  if (!Array.isArray(snapshot) || !snapshot.length) return "";
  const groups = snapshot.map(group => {
    const colors = (Array.isArray(group.colors) ? group.colors : []).map(color => {
      const swatch = /^#[0-9a-f]{6}$/i.test(String(color.color_hex || "")) ? color.color_hex : "#68758d";
      return '<li><span class="provider-history-variant-color"><i style="--provider-review-swatch:' +
        escapeHTML(swatch) + '"></i><strong>' + escapeHTML(color.color || "Color sin nombre") +
        '</strong></span><span>Catálogo: ' + escapeHTML(availabilityLabel(color.catalog_availability)) +
        ' → GoPartner: <b>' + escapeHTML(availabilityLabel(color.provider_availability)) + '</b></span></li>';
    }).join("");
    const catalogPrice = [
      group.catalog_price_usd != null && group.catalog_price_usd !== "" ? money(group.catalog_price_usd, "USD") : "",
      group.catalog_price_nio != null && group.catalog_price_nio !== "" ? money(group.catalog_price_nio, "NIO") : ""
    ].filter(Boolean).join(" · ") || "Sin registrar";
    const providerPrice = [
      group.provider_price_usd != null && group.provider_price_usd !== "" ? money(group.provider_price_usd, "USD") : "",
      group.provider_price_nio != null && group.provider_price_nio !== "" ? money(group.provider_price_nio, "NIO") : ""
    ].filter(Boolean).join(" · ") || "Sin registrar";
    return '<article class="provider-history-variant-group"><strong>' + escapeHTML(providerConfigLabel(group)) +
      '</strong><p>Disponibilidad · Catálogo: ' + escapeHTML(availabilityLabel(group.catalog_availability)) +
      ' → GoPartner: <b>' + escapeHTML(availabilityLabel(group.provider_availability)) + '</b></p>' +
      '<p>Precio catálogo: ' + escapeHTML(catalogPrice) + ' · Precio GoPartner: ' + escapeHTML(providerPrice) + '</p>' +
      (colors ? '<ul>' + colors + '</ul>' : '<p>Sin colores registrados.</p>') + '</article>';
  }).join("");
  return '<details class="provider-history-variants"><summary>Ver precios y disponibilidad por variante y color</summary><div>' + groups + '</div></details>';
}function mergeVariantImages(incomingValue, currentValue) {
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
  const resolve = (matches, method) => ({
    product: matches.length === 1 ? matches[0] : null,
    ambiguous: matches.length > 1,
    rowType,
    matchMethod: matches.length === 1 ? method : matches.length > 1 ? method + " · ambiguo" : method + " · sin coincidencia"
  });

  // An explicit identifier must never silently fall back to a different product.
  if (internalId) return resolve(candidates.filter(product => String(product.id) === String(internalId)), "ID interno exacto");
  if (catalogKey) return resolve(candidates.filter(product => String(product.catalog_key || "") === String(catalogKey)), "Clave de catálogo exacta");
  if (providerId) return resolve(candidates.filter(product =>
    String(statuses.get(String(product.id))?.provider_product_id || "") === String(providerId)
  ), "ID de proveedor exacto");

  const model = normalizedText(firstValue(row, ["model", "modelo", "product_model"]));
  const brand = normalizedText(firstValue(row, ["brand", "marca", "product_brand"]));
  if (model && brand) {
    return resolve(candidates.filter(product =>
      normalizedText(product.model) === model && normalizedText(product.brand) === brand
    ), "Marca + modelo exactos");
  }

  const name = normalizedText(firstValue(row, ["name", "product_name", "nombre", "product", "producto"]));
  if (name) {
    return resolve(candidates.filter(product =>
      normalizedText(product.name) === name && (!brand || normalizedText(product.brand) === brand)
    ), brand ? "Nombre + marca exactos" : "Nombre exacto");
  }
  return { product: null, ambiguous: false, rowType, matchMethod: "Sin identificador verificable" };
}

export function initProviderTools({ getSupabase, getCurrentUser, getProducts }) {
  let providerStatuses = new Map();
  let importPlan = [];
  let rawImportRows = [];
  let lastRefreshError = "";
  const statusMessage = $("#provider-status-message");
  const reviewedStatusMessage = $("#provider-reviewed-status-message");
  const reviewMessage = $("#provider-review-message");
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

  function renderProviderProductRow(product) {
    const state = reviewState(product);
    const review = state.review || {};
    const type = importCatalogType(product.catalog_type, "technology");
    const catalogLabel = type === "perfumery" ? "JB Parfums" : "JB TECH";
    const lastChecked = review.last_reviewed_at ? displayDate(review.last_reviewed_at) : "Nunca revisado";
    const checkedPrice = review.provider_price_usd != null ? money(review.provider_price_usd, "USD")
      : review.provider_price_nio != null ? money(review.provider_price_nio, "NIO") : "Precio sin registrar";
    const availability = availabilityLabel(review.provider_availability || "unknown");
    const variantReviewSummary = providerVariantSnapshotSummary(review.provider_variant_snapshot);
    const currentVariantSummary = catalogVariantSummary(product);
    const variantSummary = variantReviewSummary
      ? '<p class="provider-product-variant-summary"><strong>Última revisión del proveedor:</strong> ' + escapeHTML(variantReviewSummary) + '</p>'
      : currentVariantSummary
        ? '<p class="provider-product-variant-summary"><strong>Estados actuales del catálogo:</strong> ' + escapeHTML(currentVariantSummary) + '</p>'
        : "";
    return `<article class="provider-product-row">
      <div class="provider-product-main">
        <div class="provider-product-title-line"><strong>${escapeHTML(product.name || "Producto sin nombre")}</strong><span class="provider-catalog-tag">${catalogLabel}</span></div>
        <p>${escapeHTML([product.brand, product.model].filter(Boolean).join(" · ") || product.category || "Sin marca o modelo")}</p>
        <div class="provider-product-facts"><span>Última revisión: <b>${escapeHTML(lastChecked)}</b></span><span>Precio proveedor: <b>${escapeHTML(checkedPrice)}</b></span><span>Estado proveedor: <b>${escapeHTML(availability)}</b></span></div>
        ${variantSummary}
        ${review.provider_url ? '<a class="provider-source-link" href="' + escapeHTML(review.provider_url) + '" target="_blank" rel="noopener noreferrer">Abrir ficha del proveedor ↗</a>' : ""}
      </div>
      <div class="provider-product-actions"><span class="provider-review-state ${state.code}">${state.label}</span>
        <button type="button" class="button button-outline provider-action" data-provider-review="${escapeHTML(product.id)}">${state.code === "missing" ? "Registrar revisión" : "Actualizar revisión"}</button>
        ${review.last_reviewed_at ? '<button type="button" class="button button-quiet provider-history-action" data-provider-history="' + escapeHTML(product.id) + '">Historial</button>' : ""}
      </div>
    </article>`;
  }

  function setText(id, value) {
    const node = $("#" + id);
    if (node) node.textContent = String(value);
  }

  function renderProviderList() {
    const list = $("#provider-product-list");
    if (!list) return;
    const products = activeProducts();
    const typeFilter = $("#provider-catalog-filter")?.value || "all";
    const query = normalizedText($("#provider-search")?.value || "");
    const all = products.map(reviewState);
    const missing = all.filter(state => state.code === "missing").length;
    const overdue = all.filter(state => state.code === "overdue").length;
    const current = all.filter(state => state.code === "current").length;
    setText("provider-count-missing", missing);
    setText("provider-count-overdue", overdue);
    setText("provider-count-current", current);
    setText("provider-nav-count", missing);

    if (lastRefreshError) {
      list.innerHTML = '<p class="provider-empty-state is-error">' + escapeHTML(lastRefreshError) + '</p>';
      return;
    }
    const rows = products.filter(product => {
      const type = importCatalogType(product.catalog_type, "technology");
      const state = reviewState(product);
      const blob = normalizedText([product.name, product.brand, product.model, product.category].join(" "));
      return state.code === "missing" &&
        (typeFilter === "all" || type === typeFilter) &&
        (!query || blob.includes(query));
    }).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"));

    if (!rows.length) {
      list.innerHTML = '<p class="provider-empty-state">No hay productos pendientes de una primera revisión con estos filtros. Los productos ya revisados están en la sección Revisados.</p>';
      return;
    }
    list.innerHTML = rows.map(renderProviderProductRow).join("");
  }

  function renderReviewedList() {
    const list = $("#provider-reviewed-list");
    if (!list) return;
    const products = activeProducts();
    const typeFilter = $("#provider-reviewed-catalog-filter")?.value || "all";
    const stateFilter = $("#provider-reviewed-filter")?.value || "all";
    const query = normalizedText($("#provider-reviewed-search")?.value || "");
    const rows = products.filter(product => {
      const type = importCatalogType(product.catalog_type, "technology");
      const state = reviewState(product);
      const blob = normalizedText([product.name, product.brand, product.model, product.category].join(" "));
      return state.code !== "missing" &&
        (typeFilter === "all" || type === typeFilter) &&
        (stateFilter === "all" || state.code === stateFilter) &&
        (!query || blob.includes(query));
    }).sort((a, b) => {
      const order = { overdue: 0, current: 1 };
      return order[reviewState(a).code] - order[reviewState(b).code] ||
        String(a.name || "").localeCompare(String(b.name || ""), "es");
    });

    const reviewed = products.map(reviewState).filter(state => state.code !== "missing");
    const overdue = reviewed.filter(state => state.code === "overdue").length;
    const current = reviewed.filter(state => state.code === "current").length;
    setText("provider-reviewed-count", reviewed.length);
    setText("provider-reviewed-overdue", overdue);
    setText("provider-reviewed-current", current);
    setText("reviewed-nav-count", reviewed.length);

    if (lastRefreshError) {
      list.innerHTML = '<p class="provider-empty-state is-error">' + escapeHTML(lastRefreshError) + '</p>';
      const message = $("#provider-reviewed-status-message");
      if (message) message.textContent = lastRefreshError;
      return;
    }
    const message = $("#provider-reviewed-status-message");
    if (message) message.textContent = "";
    if (!rows.length) {
      list.innerHTML = '<p class="provider-empty-state">Todavía no hay productos revisados que coincidan con estos filtros. Al guardar la primera revisión, cada producto aparecerá aquí con acceso a su historial.</p>';
      return;
    }
    list.innerHTML = rows.map(renderProviderProductRow).join("");
  }

  async function refresh() {
    const supabase = getSupabase();
    const user = getCurrentUser();
    if (!supabase || !user) {
      lastRefreshError = "";
      renderProviderList();
      renderReviewedList();
      return false;
    }
    const buttons = [$("#provider-refresh"), $("#provider-refresh-reviewed")].filter(Boolean);
    buttons.forEach(button => { button.disabled = true; button.setAttribute("aria-busy", "true"); });
    lastRefreshError = "";
    try {
      const { data, error } = await supabase.from("product_provider_status").select("*").order("last_reviewed_at", { ascending: false }).limit(5000);
      if (error) throw error;
      providerStatuses = new Map((data || []).map(row => [String(row.product_id), row]));
      renderProviderList();
      renderReviewedList();
      refreshImportPlanIfPresent();
      return true;
    } catch (error) {
      lastRefreshError = "No se pudo cargar el seguimiento del proveedor: " + (error?.message || "error desconocido");
      renderProviderList();
      renderReviewedList();
      say(statusMessage, lastRefreshError, "error");
      return false;
    } finally {
      buttons.forEach(button => { button.disabled = false; button.removeAttribute("aria-busy"); });
    }
  }

  function reviewDetailLabel(value) {
    const key = normalizedText(value);
    const labels = {
      arabes: "Árabe", arabe: "Árabe", nicho: "Nicho", disenador: "Diseñador", designer: "Diseñador",
      hombre: "Hombre", men: "Hombre", masculino: "Hombre", mujer: "Mujer", women: "Mujer", femenino: "Mujer",
      unisex: "Unisex", edt: "EDT", edp: "EDP", parfum: "Parfum", extrait: "Extrait de parfum",
      perfume: "Perfume", set: "Set"
    };
    return labels[key] || String(value || "").trim();
  }

  function renderReviewProductDetails(product) {
    const container = $("#provider-review-product-details");
    if (!container) return;
    const detail = product.perfume_details || {};
    const isPerfume = importCatalogType(product.catalog_type, "technology") === "perfumery";
    const image = product.image_url
      ? '<img class="provider-review-product-image" src="' + escapeHTML(product.image_url) + '" alt="" loading="lazy">'
      : "";
    const fields = isPerfume ? [
      ["Marca / casa", product.brand],
      ["Público", detail.audience ? reviewDetailLabel(detail.audience) : ""],
      ["Concentración", detail.concentration ? reviewDetailLabel(detail.concentration) : ""],
      ["Contenido", detail.volume_ml !== null && detail.volume_ml !== undefined && detail.volume_ml !== "" ? Number(detail.volume_ml).toLocaleString("es-NI") + " ml" : ""],
      ["Tipo de fragancia", detail.family ? reviewDetailLabel(detail.family) : ""],
      ["Tipo de producto", product.product_type ? reviewDetailLabel(product.product_type) : ""],
      ["Modelo / presentación", product.model]
    ] : [
      ["Marca", product.brand], ["Modelo", product.model], ["Categoría", product.category]
    ];
    container.innerHTML = image + '<dl class="provider-review-detail-grid">' + fields.map(([label, value]) =>
      '<div><dt>' + escapeHTML(label) + '</dt><dd>' + escapeHTML(value || "Sin registrar") + '</dd></div>'
    ).join("") + '</dl>';
    container.dataset.catalogType = isPerfume ? "perfumery" : "technology";
  }

  function priceDifferenceText(currentValue, providerValue, currency) {
    if (providerValue === null || providerValue === undefined || providerValue === "") {
      return "Ingresá el precio del proveedor para calcular la diferencia.";
    }
    const providerAmount = Number(providerValue);
    if (!Number.isFinite(providerAmount)) return "El precio indicado no es válido.";
    if (currentValue === null || currentValue === undefined || currentValue === "" || !Number.isFinite(Number(currentValue))) {
      return "No hay precio público registrado para comparar.";
    }
    const currentAmount = Number(currentValue);
    const difference = Math.round((providerAmount - currentAmount + Number.EPSILON) * 100) / 100;
    if (difference === 0) return "Sin diferencias: ambos precios coinciden.";
    const sign = difference > 0 ? "+" : "−";
    const percent = currentAmount === 0 ? "" : " (" + sign +
      Math.abs((difference / currentAmount) * 100).toLocaleString("es-NI", { maximumFractionDigits: 2 }) + "%)";
    const direction = difference > 0 ? "por encima" : "por debajo";
    return "Diferencia: " + sign + money(Math.abs(difference), currency) + percent +
      ". El proveedor está " + direction + " del precio público.";
  }

  function renderReviewPriceComparison(product, review = {}) {
    const container = $("#provider-review-price-comparison");
    if (!container) return;
    const format = (value, currency) => value === null || value === undefined || value === ""
      ? "Sin registrar" : money(value, currency);
    const usdDiff = priceDifferenceText(product.price_usd, review.provider_price_usd, "USD");
    const nioDiff = priceDifferenceText(product.price_nio, review.provider_price_nio, "NIO");
    const diffClass = value => value.startsWith("Sin diferencias") ? "is-match"
      : value.startsWith("Diferencia:") ? "is-different" : "is-pending";
    container.innerHTML =
      '<div class="provider-price-compare-card"><span>Precio publicado actual · US$</span><strong>' +
        escapeHTML(format(product.price_usd, "USD")) + '</strong><small>Precio público en córdobas: ' +
        escapeHTML(format(product.price_nio, "NIO")) + '</small></div>' +
      '<div class="provider-price-compare-card"><span>Precio del proveedor introducido · US$</span><strong>' +
        escapeHTML(format(review.provider_price_usd, "USD")) + '</strong><small>Precio del proveedor en córdobas: ' +
        escapeHTML(format(review.provider_price_nio, "NIO")) + '</small></div>' +
      '<div class="provider-price-difference ' + diffClass(usdDiff) + '"><strong>US$ · diferencia</strong><span>' +
        escapeHTML(usdDiff) + '</span></div>' +
      '<div class="provider-price-difference ' + diffClass(nioDiff) + '"><strong>C$ · diferencia</strong><span>' +
        escapeHTML(nioDiff) + '</span></div>';
  }

  function availabilityOptions(selected) {
    const value = normalizeAvailability(selected, false) || "unknown";
    return [
      ["unknown", "Sin confirmar"],
      ["available", "Disponible"],
      ["on_order", "Por pedido"],
      ["out_of_stock", "Agotado / no disponible"]
    ].map(([key, label]) => '<option value="' + key + '"' + (value === key ? " selected" : "") + '>' + label + '</option>').join("");
  }

  function providerVariantReviewGroups(product, savedSnapshot) {
    const variants = parseMaybeJSON(product?.variants, []);
    if (!Array.isArray(variants) || !variants.length) return [];
    const saved = Array.isArray(parseMaybeJSON(savedSnapshot, [])) ? parseMaybeJSON(savedSnapshot, []) : [];
    const savedByConfig = new Map(saved.map(group => [String(group.config_key || providerVariantConfigKey(group)), group]));
    const groups = new Map();
    for (const variant of variants) {
      if (!variant || typeof variant !== "object") continue;
      const configKey = providerVariantConfigKey(variant);
      if (!groups.has(configKey)) {
        const savedGroup = savedByConfig.get(configKey) || {};
        groups.set(configKey, {
          config_key: configKey,
          storage: String(variant.storage || variant.capacity || "").trim(),
          ram: String(variant.ram || "").trim(),
          catalog_availability: normalizeAvailability(variant.configuration_availability, false) || "unknown",
          provider_availability: normalizeAvailability(savedGroup.provider_availability, false) || "unknown",
          catalog_price_usd: variant.price_usd ?? null,
          catalog_price_nio: variant.price_nio ?? null,
          provider_price_usd: savedGroup.provider_price_usd ?? "",
          provider_price_nio: savedGroup.provider_price_nio ?? "",
          colors: [],
          catalog_status_conflict: false
        });
      }
      const group = groups.get(configKey);
      const configStatus = normalizeAvailability(variant.configuration_availability, false) || "unknown";
      if (group.catalog_availability !== configStatus && configStatus !== "unknown") group.catalog_status_conflict = true;

      const colorName = String(variant.color || "").trim();
      if (!colorName) continue;
      const colorKey = normalizedText(colorName);
      let color = group.colors.find(item => item.key === colorKey);
      const savedGroup = savedByConfig.get(configKey) || {};
      const savedColors = Array.isArray(savedGroup.colors) ? savedGroup.colors : [];
      const savedColor = savedColors.find(item =>
        String(item.key || normalizedText(item.color || "")) === colorKey
      );
      if (!color) {
        group.colors.push({
          key: colorKey,
          color: colorName,
          color_hex: String(variant.color_hex || variant.hex || "#68758d"),
          catalog_availability: normalizeAvailability(variant.availability, false) || "unknown",
          provider_availability: normalizeAvailability(savedColor?.provider_availability, false) || "unknown"
        });
      }
    }
    return [...groups.values()];
  }

  function renderProviderVariantReview(product, savedSnapshot = []) {
    const section = $("#provider-review-variants-section");
    const container = $("#provider-review-variants");
    if (!section || !container) return;
    const groups = providerVariantReviewGroups(product, savedSnapshot);
    container.replaceChildren();
    section.hidden = groups.length === 0;
    if (!groups.length) {
      updateProviderVariantReviewReadiness();
      return;
    }
    container.innerHTML = groups.map(group => {
      const label = providerConfigLabel(group);
      const configConflict = group.catalog_status_conflict
        ? '<p class="provider-variant-warning">Los colores de esta configuración tienen estados diferentes en el catálogo. Compará cada color individualmente antes de confirmar.</p>'
        : "";
      const catalogPriceSummary = "Catálogo actual: " + money(group.catalog_price_usd, "USD") + " · " + money(group.catalog_price_nio, "NIO");
      const configPriceFields = '<div class="provider-variant-price-block">' +
        '<p class="provider-variant-catalog-price">' + escapeHTML(catalogPriceSummary) + '</p>' +
        '<div class="provider-variant-config-prices">' +
          '<label><span>GoPartner · US$</span><input type="number" min="0" step="0.01" inputmode="decimal" data-provider-config-price-usd aria-label="Precio GoPartner en dólares para ' + escapeHTML(label) + '" value="' + escapeHTML(group.provider_price_usd ?? "") + '"></label>' +
          '<label><span>GoPartner · C$</span><input type="number" min="0" step="0.01" inputmode="decimal" data-provider-config-price-nio aria-label="Precio GoPartner en córdobas para ' + escapeHTML(label) + '" value="' + escapeHTML(group.provider_price_nio ?? "") + '"></label>' +
        '</div><small>Si dejás un campo vacío, se conserva el precio actual de esa moneda para esta configuración.</small></div>';
      const colors = group.colors.length
        ? '<div class="provider-variant-colors">' + group.colors.map(color =>
          '<div class="provider-variant-color-row" data-provider-color-row data-color-key="' + escapeHTML(color.key) +
          '" data-color-name="' + escapeHTML(color.color) + '" data-color-hex="' + escapeHTML(color.color_hex) +
          '" data-catalog-availability="' + escapeHTML(color.catalog_availability) + '">' +
            '<span class="provider-review-color-dot" style="--provider-review-swatch:' + escapeHTML(color.color_hex) + '" aria-hidden="true"></span>' +
            '<span class="provider-variant-color-copy"><strong>' + escapeHTML(color.color) + '</strong><small>Catálogo: ' +
              escapeHTML(availabilityLabel(color.catalog_availability)) + '</small></span>' +
            '<label class="provider-variant-select"><span>GoPartner</span><select data-provider-color-availability aria-label="Disponibilidad de ' +
              escapeHTML(color.color) + ' en GoPartner">' + availabilityOptions(color.provider_availability) + '</select></label>' +
          '</div>'
        ).join("") + '</div>'
        : '<p class="provider-variant-warning">Esta configuración no tiene colores registrados. Confirmá su disponibilidad general en GoPartner.</p>';
      return '<article class="provider-variant-review-config" data-provider-variant-config-row data-config-key="' +
        escapeHTML(group.config_key) + '" data-config-label="' + escapeHTML(label) +
        '" data-storage="' + escapeHTML(group.storage) + '" data-ram="' + escapeHTML(group.ram) +
        '" data-catalog-price-usd="' + escapeHTML(group.catalog_price_usd ?? "") +
        '" data-catalog-price-nio="' + escapeHTML(group.catalog_price_nio ?? "") +
        '" data-catalog-availability="' + escapeHTML(group.catalog_availability) + '">' +
        '<header class="provider-variant-config-header"><div><strong>' + escapeHTML(label) +
          '</strong><small>Configuración en catálogo: ' + escapeHTML(availabilityLabel(group.catalog_availability)) +
          '</small></div><span class="provider-variant-current-state">' + (group.catalog_status_conflict ? "Revisar diferencias" : "Proveedor por verificar") + '</span></header>' +
        configConflict +
        configPriceFields +
        '<label class="provider-variant-config-select"><span>Disponibilidad de esta configuración en GoPartner</span>' +
          '<select data-provider-config-availability aria-label="Disponibilidad de ' + escapeHTML(label) + ' en GoPartner">' +
          availabilityOptions(group.provider_availability) + '</select></label>' +
        colors +
      '</article>';
    }).join("");
    container.querySelectorAll("select").forEach(select => {
      select.addEventListener("change", updateProviderVariantReviewReadiness);
    });
    updateProviderVariantReviewReadiness();
  }

  function collectProviderVariantSnapshot() {
    const container = $("#provider-review-variants");
    if (!container) return [];
    const optionalPrice = (row, selector, label) => {
      const raw = String(row.querySelector(selector)?.value ?? "").trim();
      if (!raw) return null;
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error("El precio de GoPartner para " + label + " debe ser un número igual o mayor que cero.");
      }
      return amount;
    };
    return Array.from(container.querySelectorAll("[data-provider-variant-config-row]")).map(row => ({
      config_key: row.dataset.configKey || "",
      configuration: row.dataset.configLabel || "",
      storage: row.dataset.storage || "",
      ram: row.dataset.ram || "",
      catalog_price_usd: row.dataset.catalogPriceUsd === "" ? null : Number(row.dataset.catalogPriceUsd),
      catalog_price_nio: row.dataset.catalogPriceNio === "" ? null : Number(row.dataset.catalogPriceNio),
      provider_price_usd: optionalPrice(row, "[data-provider-config-price-usd]", row.dataset.configLabel || "la configuración"),
      provider_price_nio: optionalPrice(row, "[data-provider-config-price-nio]", row.dataset.configLabel || "la configuración"),
      catalog_availability: row.dataset.catalogAvailability || "unknown",
      provider_availability: row.querySelector("[data-provider-config-availability]")?.value || "unknown",
      colors: Array.from(row.querySelectorAll("[data-provider-color-row]")).map(color => ({
        key: color.dataset.colorKey || "",
        color: color.dataset.colorName || "",
        color_hex: color.dataset.colorHex || "#68758d",
        catalog_availability: color.dataset.catalogAvailability || "unknown",
        provider_availability: color.querySelector("[data-provider-color-availability]")?.value || "unknown"
      }))
    }));
  }

  function updateProviderVariantReviewReadiness() {
    const overall = normalizeAvailability($("#provider-review-availability")?.value, false) || "unknown";
    const selects = Array.from($("#provider-review-variants")?.querySelectorAll("[data-provider-config-availability], [data-provider-color-availability]") || []);
    const missing = selects.filter(select => (normalizeAvailability(select.value, false) || "unknown") === "unknown").length +
      (overall === "unknown" ? 1 : 0);
    const mismatchLabels = selects.filter(select => {
      const row = select.closest("[data-provider-variant-config-row], [data-provider-color-row]");
      const catalog = row?.dataset.catalogAvailability || "unknown";
      const incoming = normalizeAvailability(select.value, false) || "unknown";
      return incoming !== "unknown" && catalog !== "unknown" && incoming !== catalog;
    }).map(select => {
      const row = select.closest("[data-provider-color-row]");
      if (row) {
        const group = row.closest("[data-provider-variant-config-row]");
        return (group?.dataset.configLabel ? group.dataset.configLabel + " · " : "") +
          (row.dataset.colorName || "Color") + ": " + availabilityLabel(row.dataset.catalogAvailability) +
          " → " + availabilityLabel(normalizeAvailability(select.value, false) || "unknown");
      }
      const config = select.closest("[data-provider-variant-config-row]");
      return (config?.dataset.configLabel || "Configuración") + ": " +
        availabilityLabel(config?.dataset.catalogAvailability || "unknown") + " → " +
        availabilityLabel(normalizeAvailability(select.value, false) || "unknown");
    });
    const mismatches = mismatchLabels.length;
    const button = $("#provider-review-save");
    if (button) {
      button.disabled = savingReview || missing > 0;
      button.textContent = savingReview ? "Guardando…" : "Confirmar revisión";
      button.title = missing
        ? "Confirmá la disponibilidad general, cada configuración y cada color antes de guardar."
        : mismatches
          ? "Hay " + mismatches + " diferencia(s) respecto al catálogo; revisalas antes de confirmar."
          : "Todas las disponibilidades están confirmadas.";
    }
    const status = $("#provider-review-variant-validation");
    if (status) {
      status.className = "provider-variant-validation " + (missing ? "is-pending" : mismatches ? "is-warning" : "is-ready");
      status.textContent = missing
        ? "Faltan " + missing + " estado(s) por confirmar (incluida la disponibilidad general). No se puede confirmar la revisión todavía."
        : mismatches
          ? "Revisión completa: " + mismatches + " diferencia(s) frente al catálogo. " + mismatchLabels.slice(0, 5).join("; ") +
            (mismatches > 5 ? "; y " + (mismatches - 5) + " diferencia(s) más" : "") +
            ". Verificá que cada cambio coincida con GoPartner antes de guardar."
          : "Revisión completa: disponibilidad general, configuraciones y colores confirmados.";
    }
  }

  function renderReviewAvailabilityComparison(product, providerAvailability) {
    const container = $("#provider-review-validation-summary");
    if (!container) return;
    const current = normalizeAvailability(product.availability, false);
    const incoming = normalizeAvailability(providerAvailability, false);
    let availabilityHTML;
    if (!incoming || incoming === "unknown") {
      availabilityHTML = '<p class="provider-validation-line is-pending"><strong>Disponibilidad:</strong> seleccioná un estado confirmado del proveedor para compararlo.</p>';
    } else if (!current || current === "unknown") {
      availabilityHTML = '<p class="provider-validation-line is-pending"><strong>Disponibilidad:</strong> el catálogo no tiene un estado comparable; proveedor: ' +
        escapeHTML(availabilityLabel(incoming)) + '.</p>';
    } else if (current === incoming) {
      availabilityHTML = '<p class="provider-validation-line is-match"><strong>Disponibilidad:</strong> coincide (' +
        escapeHTML(availabilityLabel(current)) + ').</p>';
    } else {
      availabilityHTML = '<p class="provider-validation-line is-different"><strong>Diferencia de disponibilidad:</strong> catálogo: ' +
        escapeHTML(availabilityLabel(current)) + ' · proveedor: ' + escapeHTML(availabilityLabel(incoming)) + '.</p>';
    }
    container.innerHTML = availabilityHTML;
  }

  function updateReviewComparison() {
    const productId = $("#provider-review-product-id")?.value;
    const product = activeProducts().find(item => String(item.id) === String(productId));
    if (!product) return;
    let priceUSD = null, priceNIO = null;
    try {
      priceUSD = cleanPrice($("#provider-review-price-usd")?.value);
      priceNIO = cleanPrice($("#provider-review-price-nio")?.value);
    } catch (error) {
      const container = $("#provider-review-validation-summary");
      if (container) container.innerHTML = '<p class="provider-validation-line is-different">' +
        escapeHTML(error.message || "Revisá los precios indicados.") + '</p>';
      return;
    }
    renderReviewPriceComparison(product, {
      provider_price_usd: priceUSD,
      provider_price_nio: priceNIO
    });
    renderReviewAvailabilityComparison(product, $("#provider-review-availability")?.value || "unknown");
    updateProviderVariantReviewReadiness();
  }

  function openReview(productId) {
    const product = activeProducts().find(item => String(item.id) === String(productId));
    if (!product || !reviewDialog) return;
    const review = providerStatuses.get(String(product.id)) || {};
    $("#provider-review-product-id").value = product.id;
    $("#provider-review-product-title").textContent = product.name || "Producto sin nombre";
    $("#provider-review-product-subtitle").textContent = importCatalogType(product.catalog_type, "technology") === "perfumery" ? "JB Parfums" : "JB TECH";
    renderReviewProductDetails(product);
    $("#provider-review-name").value = review.provider_name || "GoPartner";
    $("#provider-review-price-usd").value = review.provider_price_usd ?? "";
    $("#provider-review-price-nio").value = review.provider_price_nio ?? "";
    $("#provider-review-availability").value = review.provider_availability || "unknown";
    $("#provider-review-notes").value = review.review_notes || "";
    renderProviderVariantReview(product, review.provider_variant_snapshot || []);
    updateReviewComparison();
    say(reviewMessage, "");
    if (typeof reviewDialog.showModal === "function") reviewDialog.showModal();
    else reviewDialog.setAttribute("open", "");
  }

  let savingReview = false;
  async function saveReview(event) {
    event?.preventDefault?.();
    if (savingReview) return;
    const supabase = getSupabase();
    const user = getCurrentUser();
    const productId = $("#provider-review-product-id").value;
    const product = activeProducts().find(item => String(item.id) === String(productId));
    if (!supabase || !user || !product) { say(reviewMessage, "Tu sesión venció o el producto ya no está disponible.", "error"); return; }

    const providerName = $("#provider-review-name").value.trim() || "GoPartner";
    let priceUSD, priceNIO;
    try {
      priceUSD = cleanPrice($("#provider-review-price-usd").value);
      priceNIO = cleanPrice($("#provider-review-price-nio").value);
    } catch (error) { say(reviewMessage, error.message, "error"); return; }

    const previous = providerStatuses.get(String(product.id)) || {};
    const overallAvailability = normalizeAvailability($("#provider-review-availability").value, false) || "unknown";
    let variantSnapshot;
    try {
      variantSnapshot = collectProviderVariantSnapshot();
    } catch (error) {
      say(reviewMessage, error.message || "Revisá los precios por configuración.", "error");
      return;
    }
    const unconfirmedVariantStatus = variantSnapshot.some(group =>
      (normalizeAvailability(group.provider_availability, false) || "unknown") === "unknown" ||
      group.colors.some(color => (normalizeAvailability(color.provider_availability, false) || "unknown") === "unknown")
    );
    if (overallAvailability === "unknown" || unconfirmedVariantStatus) {
      updateProviderVariantReviewReadiness();
      say(reviewMessage, "Antes de confirmar, seleccioná una disponibilidad comprobada para el producto, cada configuración y cada color.", "error");
      return;
    }
    const payload = {
      product_id: product.id,
      provider_name: providerName,
      provider_product_id: previous.provider_product_id ?? null,
      provider_url: previous.provider_url ?? null,
      // Blank fields mean "not provided this time"; retain the latest known supplier values.
      provider_price_usd: priceUSD ?? previous.provider_price_usd ?? null,
      provider_price_nio: priceNIO ?? previous.provider_price_nio ?? null,
      provider_availability: overallAvailability,
      provider_variant_snapshot: variantSnapshot,
      review_notes: $("#provider-review-notes").value.trim() || null,
      last_reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
      created_at: previous.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const button = $("#provider-review-save");
    savingReview = true;
    if (button) { button.disabled = true; button.textContent = "Guardando…"; }
    try {
      const syncCatalogAvailability = $("#provider-review-sync-catalog-availability")?.checked === true;
      const { data, error } = await supabase.rpc("confirm_provider_product_review", {
        p_product_id: product.id,
        p_review_payload: payload,
        p_sync_catalog_availability: syncCatalogAvailability
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error("No se pudo confirmar la revisión del proveedor.");
      providerStatuses.set(String(product.id), payload);
      if (syncCatalogAvailability && typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new CustomEvent("jb-catalog-provider-updated"));
      }

      const catalogPriceMessage = syncCatalogAvailability
        ? " Se sincronizaron disponibilidad general, configuraciones y colores. Los precios GoPartner ingresados por configuración se aplicaron; los campos vacíos conservaron el precio actual. En productos sin variantes se aplicó el precio general ingresado. Las fotos y el estado de publicación no cambiaron."
        : " Se guardó el historial privado; ni la disponibilidad ni los precios públicos se modificaron.";
      if (typeof reviewDialog.close === "function") reviewDialog.close(); else reviewDialog.removeAttribute("open");
      const successMessage = "Revisión confirmada. Se añadió una entrada al historial privado." + catalogPriceMessage;
      say(statusMessage, successMessage, "success");
      await refresh();
      say(reviewedStatusMessage, successMessage, "success");
    } catch (error) {
      const errorMessage = "No se pudo guardar la revisión: " + (error?.message || "error desconocido");
      say(reviewMessage, errorMessage, "error");
      say(reviewedStatusMessage, errorMessage, "error");
    } finally {
      savingReview = false;
      if (button) { button.disabled = false; button.textContent = "Confirmar revisión"; }
      updateProviderVariantReviewReadiness();
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
      const historyRows = [];
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase.from("product_provider_review_history")
          .select("provider_name,provider_product_id,provider_url,provider_price_usd,provider_price_nio,provider_availability,review_notes,provider_variant_snapshot,reviewed_at")
          .eq("product_id", product.id).order("reviewed_at", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        const page = data || [];
        historyRows.push(...page);
        if (page.length < pageSize) break;
      }
      $("#provider-history-title").textContent = "Historial · " + (product.name || "Producto") +
        " (" + historyRows.length.toLocaleString("es-NI") + " revisiones)";
      if (!historyRows.length) { body.innerHTML = '<p class="provider-empty-state">No hay revisiones anteriores para este producto.</p>'; return; }
      body.innerHTML = historyRows.map(row => `<article class="provider-history-entry">
        <div class="provider-history-entry-heading"><strong>${escapeHTML(displayDate(row.reviewed_at))}</strong><span>${escapeHTML(row.provider_name || "GoPartner")}</span></div>
        <p>Precio proveedor: ${escapeHTML(money(row.provider_price_usd, "USD"))} ${row.provider_price_nio != null ? " · " + escapeHTML(money(row.provider_price_nio, "NIO")) : ""}</p>
        <p>Disponibilidad: ${escapeHTML(availabilityLabel(row.provider_availability))}</p>
        ${row.provider_product_id ? "<p>ID proveedor: " + escapeHTML(row.provider_product_id) + "</p>" : ""}
        ${row.review_notes ? "<p>" + escapeHTML(row.review_notes) + "</p>" : ""}
        ${providerVariantSnapshotHistoryHTML(row.provider_variant_snapshot)}
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
          index: index + 1, row, product: null, ambiguous: match.ambiguous, matchMethod: match.matchMethod,
          error: match.ambiguous ? "Coincidencia ambigua; no se actualizará automáticamente." : "No coincide con un producto existente. Verificá identificadores, marca y modelo."
        });
        return;
      }
      const id = String(match.product.id);
      if (seen.has(id)) {
        plan.push({ index: index + 1, row, product: match.product, matchMethod: match.matchMethod, error: "Duplicado dentro del archivo; se omite para evitar sobrescritura." });
        return;
      }
      seen.add(id);
      let provider;
      let catalogFields;
      try {
        provider = getProviderFields(row);
        catalogFields = getImportedCatalogFields(row);
      } catch (error) {
        plan.push({ index: index + 1, row, product: match.product, matchMethod: match.matchMethod, error: error.message || "Datos de importación inválidos." });
        return;
      }
      const hasProviderData = Boolean(provider.provider_product_id || provider.provider_url ||
        provider.provider_price_usd !== null || provider.provider_price_nio !== null ||
        provider.provider_availability !== null || provider.review_notes !== null ||
        firstValue(row, ["provider_name", "supplier_name", "proveedor"]) !== null);
      plan.push({ index: index + 1, row, product: match.product, provider, catalogFields, hasProviderData, rowType: match.rowType, matchMethod: match.matchMethod });
    });
    return plan;
  }

  function refreshImportPlanIfPresent() {
    if (!rawImportRows.length) return;
    importPlan = planImportedRows(rawImportRows);
    renderImportPreview();
  }

  function importDifferenceSummary(item) {
    const product = item.product;
    if (!product) return [];
    const provider = item.provider || {};
    const fields = item.catalogFields || {};
    const lines = [];
    const addPriceDifference = (label, current, incoming, currency) => {
      if (incoming === null || incoming === undefined || incoming === "") return;
      if (current === null || current === undefined || current === "" || !Number.isFinite(Number(current))) {
        lines.push(label + ": sin valor actual; nuevo " + money(incoming, currency));
        return;
      }
      const difference = Math.round((Number(incoming) - Number(current) + Number.EPSILON) * 100) / 100;
      if (difference === 0) {
        lines.push(label + ": coincide (" + money(incoming, currency) + ")");
        return;
      }
      const sign = difference > 0 ? "+" : "−";
      const percentage = Number(current) === 0 ? "" : " (" + sign +
        Math.abs((difference / Number(current)) * 100).toLocaleString("es-NI", { maximumFractionDigits: 2 }) + "%)";
      lines.push(label + ": diferencia " + sign + money(Math.abs(difference), currency) + percentage);
    };
    const addAvailabilityDifference = (label, currentValue, incomingValue) => {
      const current = normalizeAvailability(currentValue, false);
      const incoming = normalizeAvailability(incomingValue, false);
      if (!incoming || incoming === "unknown") return;
      if (!current || current === "unknown") {
        lines.push(label + ": sin estado actual comparable; nuevo " + availabilityLabel(incoming));
      } else if (current === incoming) {
        lines.push(label + ": coincide (" + availabilityLabel(incoming) + ")");
      } else {
        lines.push(label + ": " + availabilityLabel(current) + " → " + availabilityLabel(incoming));
      }
    };
    addPriceDifference("Proveedor US$ vs precio público", product.price_usd, provider.provider_price_usd, "USD");
    addPriceDifference("Proveedor C$ vs precio público", product.price_nio, provider.provider_price_nio, "NIO");
    if (Object.prototype.hasOwnProperty.call(fields, "price_usd")) {
      addPriceDifference("Nuevo precio público US$", product.price_usd, fields.price_usd, "USD");
    }
    if (Object.prototype.hasOwnProperty.call(fields, "price_nio")) {
      addPriceDifference("Nuevo precio público C$", product.price_nio, fields.price_nio, "NIO");
    }
    addAvailabilityDifference("Disponibilidad del proveedor", product.availability, provider.provider_availability);
    if (Object.prototype.hasOwnProperty.call(fields, "availability")) {
      addAvailabilityDifference("Disponibilidad importada", product.availability, fields.availability);
    }
    for (const field of ["name", "brand", "model", "category", "description"]) {
      if (!Object.prototype.hasOwnProperty.call(fields, field)) continue;
      const current = String(product[field] ?? "").trim();
      const incoming = String(fields[field] ?? "").trim();
      if (current !== incoming) {
        const label = ({name:"Nombre",brand:"Marca",model:"Modelo",category:"Categoría",description:"Descripción"})[field];
        lines.push(label + ": " + (current || "sin dato") + " → " + (incoming || "sin dato"));
      } else {
        lines.push(({name:"Nombre",brand:"Marca",model:"Modelo",category:"Categoría",description:"Descripción"})[field] + ": coincide");
      }
    }
    if (fields.variants !== undefined) {
      if (!Array.isArray(fields.variants)) {
        lines.push("Variantes: el campo importado no es un arreglo JSON válido");
      } else {
        const currentVariants = Array.isArray(product.variants) ? product.variants : parseMaybeJSON(product.variants, []);
        const current = Array.isArray(currentVariants) ? currentVariants : [];
        const currentMap = new Map(current.map(variant => [stableVariantKey(variant), variant]));
        const incomingKeys = new Set();
        const detailLines = [];
        for (const variant of fields.variants) {
          if (!variant || typeof variant !== "object") {
            detailLines.push("Hay una variante no válida en el archivo.");
            continue;
          }
          const key = stableVariantKey(variant);
          incomingKeys.add(key);
          const old = currentMap.get(key);
          const config = [String(variant.storage || variant.capacity || "").trim(),
            String(variant.ram || "").trim() ? String(variant.ram).trim() + " RAM" : ""].filter(Boolean).join(" · ") || "Configuración principal";
          const color = String(variant.color || "").trim();
          const label = config + (color ? " · " + color : "");
          if (!old) {
            detailLines.push("No existe en el catálogo: " + label + " (requiere verificación; no se puede confirmar automáticamente).");
            continue;
          }
          for (const field of ["ram", "storage", "color", "price_usd", "price_nio"]) {
            if (Object.prototype.hasOwnProperty.call(variant, field) &&
                String(variant[field] ?? "") !== String(old[field] ?? "")) {
              detailLines.push(label + " · " + field + ": " + String(old[field] ?? "sin dato") + " → " + String(variant[field] ?? "sin dato"));
            }
          }
          if (Object.prototype.hasOwnProperty.call(variant, "configuration_availability")) {
            addAvailabilityDifference(label + " · disponibilidad de configuración",
              old.configuration_availability, variant.configuration_availability);
          }
          if (Object.prototype.hasOwnProperty.call(variant, "availability")) {
            addAvailabilityDifference(label + " · disponibilidad de color", old.availability, variant.availability);
          }
        }
        const omitted = current.filter(variant => !incomingKeys.has(stableVariantKey(variant)));
        omitted.forEach(variant => {
          const label = [String(variant.storage || variant.capacity || "").trim(),
            String(variant.ram || "").trim() ? String(variant.ram).trim() + " RAM" : "",
            String(variant.color || "").trim()].filter(Boolean).join(" · ") || "Variante sin nombre";
          detailLines.push("No aparece en el archivo: " + label + ". No la retires automáticamente; comprobá si sigue disponible, está por pedido o se agotó.");
        });
        if (fields.variants.length !== current.length) {
          detailLines.push("Cantidad de entradas: catálogo " + current.length + " · archivo " + fields.variants.length + ".");
        }
        if (!detailLines.length) detailLines.push("No se detectaron diferencias en configuración, precio o disponibilidad incluida.");
        lines.push(...detailLines.slice(0, 24));
        if (detailLines.length > 24) lines.push("Hay " + (detailLines.length - 24) + " diferencia(s) adicionales; revisá el archivo completo antes de aplicar.");
      }
    }
    return lines;
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
      <thead><tr><th>Fila</th><th>Producto reconocido</th><th>Datos del proveedor</th><th>Diferencias detectadas</th><th>Resultado</th></tr></thead>
      <tbody>${importPlan.map(item => {
        const name = item.product?.name || firstValue(item.row || {}, ["name", "product_name", "nombre", "product", "producto"]) || "Producto no identificado";
        const provider = item.provider || {};
        const sourcePrice = provider.provider_price_usd != null ? money(provider.provider_price_usd, "USD")
          : provider.provider_price_nio != null ? money(provider.provider_price_nio, "NIO") : "Sin precio";
        const sourceAvailability = provider.provider_availability ? availabilityLabel(provider.provider_availability) : "Sin estado";
        const differences = importDifferenceSummary(item);
        const differenceMarkup = differences.length
          ? '<ul class="provider-diff-list">' + differences.map(line => '<li>' + escapeHTML(line) + '</li>').join("") + '</ul>'
          : '<small class="provider-diff-empty">' + (item.error ? "No se puede comparar esta fila." : "El archivo no incluye campos comparables.") + '</small>';
        const result = item.error || (item.product ? "Listo para aplicar" : "Omitido");
        return `<tr><td>${item.index}</td><td>${escapeHTML(name)}<small>${item.product ? escapeHTML(item.product.catalog_type === "perfumery" ? "JB Parfums" : "JB TECH") : ""}${item.matchMethod ? " · " + escapeHTML(item.matchMethod) : ""}</small></td><td>${escapeHTML(sourcePrice)}<small>${escapeHTML(sourceAvailability)}</small></td><td>${differenceMarkup}</td><td><span class="${item.error ? "provider-import-error" : "provider-import-ready"}">${escapeHTML(result)}</span></td></tr>`;
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
    if (updateVariants) {
      const invalidVariantUpdate = matchedItems.find(item => {
        const imported = item.catalogFields?.variants;
        if (imported === undefined) return false;
        return !Array.isArray(imported) ||
          (imported.length === 0 && Array.isArray(item.product.variants) && item.product.variants.length > 0);
      });
      if (invalidVariantUpdate) {
        say(importMessage, "La fila " + invalidVariantUpdate.index + " no contiene una lista válida de variantes o intenta borrar todas las variantes. Corregí el archivo antes de aplicar cambios; esta protección evita perder configuraciones por accidente.", "error");
        return;
      }

      const omittedVariantUpdate = matchedItems.find(item => {
        const imported = item.catalogFields?.variants;
        if (!Array.isArray(imported)) return false;
        const current = Array.isArray(item.product.variants)
          ? item.product.variants
          : parseMaybeJSON(item.product.variants, []);
        if (!Array.isArray(current) || !current.length) return false;
        const incomingKeys = new Set(imported.map(stableVariantKey));
        return current.some(variant => !incomingKeys.has(stableVariantKey(variant)));
      });
      if (omittedVariantUpdate) {
        say(importMessage,
          "La fila " + omittedVariantUpdate.index +
          " omite una o más variantes o colores que existen en el catálogo. Por seguridad no se aplicó ninguna actualización de variantes. Revisá si siguen disponibles, están por pedido o se agotaron; incluilas en el archivo con su estado actualizado o desactivá «Actualizar variantes» si solo vas a registrar una revisión del proveedor.",
          "error");
        return;
      }
    }
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
            // Keep the product color summary synchronized without losing color metadata/images already saved.
            const previousColors = Array.isArray(product.colors) ? product.colors : parseMaybeJSON(product.colors, []);
            const colorByName = new Map((Array.isArray(previousColors) ? previousColors : []).map(color => [
              normalizedText(typeof color === "string" ? color : color?.color || color?.name),
              typeof color === "string" ? { color } : color
            ]));
            for (const variant of productUpdate.variants) {
              const colorName = String(variant.color || "").trim();
              if (!colorName) continue;
              const key = normalizedText(colorName);
              const previousColor = colorByName.get(key) || {};
              const variantImages = Array.isArray(variant.images) ? variant.images.filter(Boolean) : [variant.image_url].filter(Boolean);
              colorByName.set(key, {
                ...previousColor,
                color: colorName,
                color_hex: variant.color_hex || previousColor.color_hex || previousColor.hex || "",
                images: variantImages.length ? variantImages : previousColor.images || [],
                image_url: variantImages[0] || previousColor.image_url || ""
              });
            }
            productUpdate.colors = Array.from(colorByName.values());
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

  ["#provider-refresh", "#provider-refresh-reviewed"].forEach(selector =>
    $(selector)?.addEventListener("click", () => { void refresh(); })
  );
  ["#provider-catalog-filter", "#provider-search"].forEach(selector =>
    $(selector)?.addEventListener(selector === "#provider-search" ? "input" : "change", renderProviderList)
  );
  ["#provider-reviewed-catalog-filter", "#provider-reviewed-filter", "#provider-reviewed-search"].forEach(selector =>
    $(selector)?.addEventListener(selector === "#provider-reviewed-search" ? "input" : "change", renderReviewedList)
  );
  ["#provider-product-list", "#provider-reviewed-list"].forEach(selector => $(selector)?.addEventListener("click", event => {
    const review = event.target.closest("[data-provider-review]");
    const history = event.target.closest("[data-provider-history]");
    if (review) openReview(review.dataset.providerReview);
    else if (history) void openHistory(history.dataset.providerHistory);
  }));
  const reviewForm = $("#provider-review-form");
  const reviewSaveButton = $("#provider-review-save");
  ["#provider-review-price-usd", "#provider-review-price-nio", "#provider-review-availability"].forEach(selector =>
    $(selector)?.addEventListener("input", updateReviewComparison)
  );
  $("#provider-review-availability")?.addEventListener("change", () => {
    updateReviewComparison();
    updateProviderVariantReviewReadiness();
  });
  // Explicit click handling is reliable in desktop browsers and Android WebView.
  // Keep the button out of native submit dispatch to avoid duplicate writes.
  reviewSaveButton?.addEventListener("click", () => { void saveReview(); });
  reviewForm?.addEventListener("submit", event => {
    event.preventDefault();
    void saveReview(event);
  });
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
          name: "Nombre del producto tal como aparece en el proveedor",
          brand: "Marca",
          model: "Modelo",
          provider_price_usd: 199.99,
          provider_availability: "available",
          catalog_price_usd: 219.99,
          catalog_availability: "available"
        },
        {
          catalog_type: "perfumery",
          name: "Nombre de la fragancia",
          brand: "Marca",
          provider_price_usd: 39.99,
          provider_availability: "on_order",
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
  renderReviewedList();
  return {
    refresh,
    render: renderProviderList,
    renderReviewed: renderReviewedList,
    getStatus(productId) { return providerStatuses.get(String(productId)) || null; }
  };
}
