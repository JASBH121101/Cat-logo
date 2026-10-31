const $ = selector => document.querySelector(selector);
export function scannerErrorMessage(payload, httpStatus) {
  const code = String(payload?.error || "");
  const providerStatus = String(payload?.provider_status || "").trim();
  const providerMessage = String(payload?.provider_message || "").trim();
  const detail = providerMessage ? " Detalle de Gemini: " + providerMessage : "";
  const statusDetail = Number.isFinite(Number(payload?.provider_code || httpStatus))
    ? " (HTTP " + Number(payload?.provider_code || httpStatus) + ")" : "";
  if (code === "gemini_quota_exhausted") return "Gemini alcanzó su límite de solicitudes o cuota disponible. El texto OCR se conservó; esperá un poco y volvé a revisar." + statusDetail + detail;
  if (code === "gemini_authentication_failed") return "Gemini rechazó la autenticación del servicio. Hay que revisar la clave de Gemini configurada en Cloudflare." + statusDetail + detail;
  if (code === "gemini_model_unavailable") return "El modelo Gemini configurado no está disponible para esta clave o proyecto." + statusDetail + detail;
  if (code === "gemini_invalid_request") return "Gemini rechazó el formato de la solicitud del escáner. Se conservó el OCR para reintentar después de corregirlo." + statusDetail + detail;
  if (code === "gemini_temporarily_unavailable") return "Gemini presenta un fallo temporal. El OCR sigue guardado en el dispositivo; podés volver a intentar." + statusDetail + detail;
  if (code === "gemini_unreachable") return "JB Manager no pudo conectar con Gemini. Revisá la conexión y volvé a intentar.";
  if (code === "gemini_not_configured") return "Falta configurar la clave de Gemini en el servicio del escáner de Cloudflare.";
  if (code === "admin_verification_unavailable") return "No se pudo validar la sesión administrativa con Supabase. Volvé a iniciar sesión y reintentá.";
  if (code === "authentication_required" || code === "admin_only") return "La sesión administrativa venció o no tiene permisos. Iniciá sesión nuevamente.";
  if (code === "origin_not_allowed") return "El servicio de escaneo rechazó el origen de la aplicación. La APK necesita actualizar su configuración de conexión.";
  if (code.startsWith("gemini_")) return "Gemini no pudo completar el análisis." + statusDetail + (providerStatus ? " Estado del proveedor: " + providerStatus + "." : "") + detail;
  return code || "No se pudo analizar el catálogo. El texto OCR se conservó para volver a intentarlo.";
}

export function normalizeScannerKey(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "");
}
export function scannerSessionReviewable(state) {
  return state?.running === true || state?.processing === true || state?.interrupted === true ||
    Number(state?.observationsCount || 0) > 0;
}
export function scannerSessionStatus(state) {
  const count = Number(state?.observationsCount || 0);
  if (state?.interrupted === true) {
    const reason = String(state?.interruptionReason || "Android detuvo la captura.").trim();
    return "Captura interrumpida por Android. " + count + " pantalla(s) parcial(es) siguen disponibles para revisión. " + reason;
  }
  if (state?.running === true) return "Captura activa. Se han leído " + count + " pantalla(s). Podés continuar o finalizar.";
  if (count > 0) return "La captura se detuvo. Hay " + count + " pantalla(s) en memoria listas para revisar.";
  if (state?.processing === true) return "Android todavía está procesando la última pantalla. Los resultados se conservarán.";
  return "No hay una sesión de captura pendiente.";
}
export function scannerDuplicateGroups(candidates) {
  const groups = new Map();
  (Array.isArray(candidates) ? candidates : []).forEach((candidate, index) => {
    const key = [candidate.brand || "", candidate.model || candidate.product_name || "",
      candidate.ram || "", candidate.storage || "", candidate.color || ""].map(normalizeScannerKey).join("|");
    if (!key.replace(/\|/g, "")) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  return [...groups.entries()].filter(([, indexes]) => indexes.length > 1)
    .map(([key, indexes], index) => ({ id: "duplicate-" + (index + 1), key, indexes, decision: "", selectedIndex: null, hasPriceConflict: false }));
}
export function matchScannerCandidate(candidate, products) {
  const brandKey = normalizeScannerKey(candidate.brand), modelKey = normalizeScannerKey(candidate.model);
  const nameKey = normalizeScannerKey(candidate.product_name), ramKey = normalizeScannerKey(candidate.ram);
  const storageKey = normalizeScannerKey(candidate.storage);
  return (Array.isArray(products) ? products : []).filter(product => !["trash", "deleting"].includes(product.workflow_status))
    .map(product => {
      const brand = normalizeScannerKey(product.brand), model = normalizeScannerKey(product.model), name = normalizeScannerKey(product.name);
      let score = 0;
      if (brandKey && brand === brandKey) score += 0.25;
      if (modelKey && model === modelKey) score += 0.55;
      else if (modelKey && (model.includes(modelKey) || modelKey.includes(model)) && Math.min(model.length, modelKey.length) >= 4) score += 0.30;
      if (nameKey && name === nameKey) score += 0.45;
      else if (nameKey && (name.includes(nameKey) || nameKey.includes(name)) && Math.min(name.length, nameKey.length) >= 6) score += 0.22;
      if (ramKey || storageKey) {
        const variants = Array.isArray(product.variants) ? product.variants : [];
        if (variants.some(v => (!ramKey || normalizeScannerKey(v.ram) === ramKey) &&
          (!storageKey || normalizeScannerKey(v.storage || v.capacity) === storageKey))) score += 0.15;
      }
      return { product, score: Math.min(1, score) };
    }).filter(item => item.score >= 0.32)
    .sort((a, b) => b.score - a.score || String(a.product.name).localeCompare(String(b.product.name), "es")).slice(0, 8);
}
export function initGoPartnersScanner({ getSupabase, getCurrentUser, getProducts, providerTools, onPrepareNewProduct }) {
  const root = $("#jb-gp-scanner");
  if (!root) return null;
  const startButton = $("#jb-gp-scan-start"), finishButton = $("#jb-gp-scan-finish"), clearButton = $("#jb-gp-scan-clear");
  const status = $("#jb-gp-scan-status"), results = $("#jb-gp-scan-results"), summary = $("#jb-gp-scan-summary");
  const duplicateReview = $("#jb-gp-scan-duplicates"), productList = $("#jb-gp-scan-products");
  if (!startButton || !finishButton || !status || !results || !summary || !duplicateReview || !productList) return null;
  let scanning = false, startInProgress = false, finishing = false, pendingOverlayPermission = false;
  let scanCandidates = [], duplicateGroups = [];
  const duplicateState = new Map();
  const plugin = () => {
    const cap = window.Capacitor;
    return cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform() ? cap.Plugins?.GoPartnersScanner || null : null;
  };
  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle("is-error", error);
    status.classList.toggle("is-success", !error);
  };
  function updateControls() {
    startButton.disabled = scanning; finishButton.disabled = !scanning;
    clearButton.disabled = !scanning && scanCandidates.length === 0;
    root.classList.toggle("is-scanning", scanning);
  }
  async function getAccessToken() {
    const supabase = getSupabase();
    if (!getCurrentUser() || !supabase) throw new Error("Iniciá sesión como administrador.");
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session?.access_token) throw new Error("Tu sesión administrativa venció.");
    return data.session.access_token;
  }
  function renderReview() {
    const catalog = getProducts() || [];
    scanCandidates.forEach(candidate => {
      candidate.matches = matchScannerCandidate(candidate, catalog);
      candidate.matchId = candidate.matchId || (candidate.matches[0]?.score >= 0.78 ? String(candidate.matches[0].product.id) : "");
    });
    duplicateGroups = scannerDuplicateGroups(scanCandidates).map(group => {
      const prior = duplicateState.get(group.key) || {};
      group.decision = prior.decision || "";
      group.selectedIndex = Number.isInteger(prior.selectedIndex) ? prior.selectedIndex : null;
      group.indexes.forEach(index => { scanCandidates[index].duplicateGroupId = group.id; });
      const prices = new Set(group.indexes.map(i => scanCandidates[i].price_usd + "|" + scanCandidates[i].price_nio));
      group.hasPriceConflict = prices.size > 1;
      return group;
    });
    summary.textContent = scanCandidates.length + " configuración(es) detectada(s) en " +
      new Set(scanCandidates.map(row => row.source_observation)).size + " observación(es).";
    duplicateReview.replaceChildren();
    if (!duplicateGroups.length) duplicateReview.textContent = "No se detectaron repeticiones exactas en esta sesión.";
    else {
      const heading = document.createElement("h4"); heading.textContent = "Reconfirmación de posibles duplicados"; duplicateReview.append(heading);
      duplicateGroups.forEach(group => {
        const card = document.createElement("article"); card.className = "jb-gp-duplicate-card";
        const first = scanCandidates[group.indexes[0]], title = document.createElement("strong");
        title.textContent = [first.brand, first.model || first.product_name, first.ram, first.storage, first.color].filter(Boolean).join(" · ");
        const desc = document.createElement("p"); desc.textContent = "JARVIS encontró " + group.indexes.length + " capturas que parecen corresponder a la misma configuración.";
        const decision = document.createElement("select"); decision.className = "jb-gp-duplicate-decision";
        decision.dataset.key = group.key; decision.setAttribute("aria-label", "Confirmación de duplicado");
        decision.innerHTML = '<option value="">Confirmá si es repetido</option><option value="same">Sí, es el mismo producto repetido</option><option value="separate">No, son registros distintos</option>';
        decision.value = group.decision;
        const info = document.createElement("p");
        info.textContent = group.hasPriceConflict ? "Los precios no coinciden. Elegí qué captura contiene el precio correcto." : "Los precios coinciden entre las capturas.";
        card.append(title, desc, decision, info);
        if (group.hasPriceConflict) {
          const choice = document.createElement("select"); choice.className = "jb-gp-duplicate-price";
          choice.dataset.key = group.key; choice.setAttribute("aria-label", "Elegir precio detectado");
          const blank = document.createElement("option"); blank.value = ""; blank.textContent = "Elegir captura y precio"; choice.append(blank);
          group.indexes.forEach(index => {
            const row = scanCandidates[index], option = document.createElement("option");
            option.value = String(index);
            const price = row.price_usd != null ? "US$ " + Number(row.price_usd).toFixed(2) :
              row.price_nio != null ? "C$ " + Number(row.price_nio).toFixed(2) : "Sin precio";
            option.textContent = "Captura " + (row.source_observation || index + 1) + " · " + price;
            choice.append(option);
          });
          choice.value = group.selectedIndex === null ? "" : String(group.selectedIndex);
          card.append(choice);
        }
        duplicateReview.append(card);
      });
    }
    productList.replaceChildren();
    const newProductGroups = new Map();
    scanCandidates.forEach((candidate, index) => {
      const brandKey = normalizeScannerKey(candidate.brand);
      const productKey = normalizeScannerKey(candidate.model || candidate.product_name);
      if (!brandKey || !productKey) return;
      const key = brandKey + "|" + productKey;
      if (!newProductGroups.has(key)) newProductGroups.set(key, { key, indexes: [], first: candidate, hasExistingMatch: false });
      const group = newProductGroups.get(key);
      group.indexes.push(index);
      if (candidate.matches?.length) group.hasExistingMatch = true;
    });
    const preparedNewProductKeys = new Set();
    scanCandidates.forEach((candidate, index) => {
      const card = document.createElement("article"); card.className = "jb-gp-product-card";
      const heading = document.createElement("h4"); heading.textContent = candidate.product_name || candidate.model || "Producto sin nombre";
      const specs = document.createElement("p");
      specs.textContent = [candidate.brand, candidate.model, candidate.ram, candidate.storage, candidate.color].filter(Boolean).join(" · ") || "Características insuficientes";
      const price = document.createElement("p");
      const amounts = [candidate.price_usd != null ? "US$ " + Number(candidate.price_usd).toFixed(2) : "",
        candidate.price_nio != null ? "C$ " + Number(candidate.price_nio).toFixed(2) : ""].filter(Boolean);
      price.textContent = "Precio detectado: " + (amounts.join(" · ") || "No identificado");
      const confidence = document.createElement("small");
      const attemptedCount = Array.isArray(candidate.attempted_fields) ? candidate.attempted_fields.length : 8;
      const groundedCount = Array.isArray(candidate.grounded_fields) ? candidate.grounded_fields.length : 0;
      confidence.textContent = "Respaldo OCR comprobado: " + groundedCount + "/" + attemptedCount + " dato(s) · Captura " + (candidate.source_observation || "—");
      const evidence = document.createElement("small");
      evidence.textContent = candidate.evidence ? "Fragmento OCR verificado: " + candidate.evidence : "Sin fragmento OCR verificable.";
      const warning = document.createElement("small");
      warning.className = "jb-gp-candidate-warning";
      const fieldLabels = { product_name: "nombre", brand: "marca", model: "modelo", category: "categoría", ram: "RAM", storage: "almacenamiento", color: "color", price_usd: "precio USD", price_nio: "precio NIO" };
      const unverifiedFields = Array.isArray(candidate.unverified_fields) ? candidate.unverified_fields : [];
      warning.textContent = unverifiedFields.length
        ? "Se dejaron en blanco por falta de respaldo OCR: " + unverifiedFields.map(field => fieldLabels[field] || field).join(", ") + "."
        : "Los datos detectados tienen respaldo en el fragmento OCR mostrado.";

      const corrections = document.createElement("details");
      corrections.className = "jb-gp-corrections";
      const correctionsSummary = document.createElement("summary");
      correctionsSummary.textContent = "Corregir lectura antes de revisar";
      const correctionGrid = document.createElement("div");
      correctionGrid.className = "jb-gp-correction-grid";
      const editableFields = [
        ["product_name", "Nombre del producto", "text"],
        ["brand", "Marca", "text"],
        ["model", "Modelo", "text"],
        ["ram", "RAM", "text"],
        ["storage", "Almacenamiento", "text"],
        ["color", "Color", "text"],
        ["price_usd", "Precio proveedor · USD", "number"],
        ["price_nio", "Precio proveedor · NIO", "number"]
      ];
      editableFields.forEach(([field, labelText, type]) => {
        const label = document.createElement("label");
        label.className = "jb-gp-correction-field";
        const caption = document.createElement("span");
        caption.textContent = labelText;
        const input = document.createElement("input");
        input.type = type;
        input.value = candidate[field] == null ? "" : String(candidate[field]);
        input.dataset.scannerField = field;
        input.setAttribute("aria-label", labelText);
        if (type === "number") {
          input.min = "0";
          input.step = "0.01";
          input.inputMode = "decimal";
        }
        input.addEventListener("change", () => {
          const raw = input.value.trim();
          candidate[field] = type === "number" ? (raw === "" ? null : Number(raw)) : raw;
          if (["product_name", "brand", "model", "ram", "storage"].includes(field)) {
            candidate.matchId = "";
          }
          renderReview();
        });
        label.append(caption, input);
        correctionGrid.append(label);
      });
      corrections.append(correctionsSummary, correctionGrid);

      const matchSelect = document.createElement("select"); matchSelect.className = "jb-gp-match-select";
      matchSelect.setAttribute("aria-label", "Producto de JB Collections al que corresponde");
      const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "Seleccionar producto de JB Collections"; matchSelect.append(placeholder);
      candidate.matches.forEach(match => {
        const option = document.createElement("option"); option.value = String(match.product.id);
        option.textContent = (match.product.name || "Sin nombre") + (match.product.model ? " · " + match.product.model : "") + " · " + Math.round(match.score * 100) + "%";
        matchSelect.append(option);
      });
      matchSelect.value = candidate.matchId || "";
      matchSelect.addEventListener("change", () => { candidate.matchId = matchSelect.value; });
      const newProductKey = normalizeScannerKey(candidate.brand) + "|" + normalizeScannerKey(candidate.model || candidate.product_name);
      const newProductGroup = newProductGroups.get(newProductKey);
      if (newProductGroup && !newProductGroup.hasExistingMatch && !preparedNewProductKeys.has(newProductKey)) {
        preparedNewProductKeys.add(newProductKey);
        const createNew = document.createElement("button");
        createNew.type = "button";
        createNew.className = "button button-primary jb-gp-prepare-new-product";
        createNew.textContent = "Preparar producto nuevo (" + newProductGroup.indexes.length + " captura(s))";
        const newProductStatus = document.createElement("small");
        newProductStatus.className = "jb-gp-candidate-status";
        newProductStatus.textContent = "Agrupa únicamente las configuraciones del mismo modelo. Revisá cada precio y color antes de guardar.";
        createNew.addEventListener("click", async () => {
          if (typeof onPrepareNewProduct !== "function") {
            setStatus("La preparación de productos nuevos no está disponible en esta versión.", true);
            return;
          }
          const includedIndexes = new Set(newProductGroup.indexes);
          for (const duplicate of duplicateGroups.filter(group => group.indexes.some(rowIndex => newProductGroup.indexes.includes(rowIndex)))) {
            if (duplicate.decision !== "same") {
              setStatus(duplicate.decision === "separate"
                ? "Hay capturas idénticas marcadas como registros separados. Revisá esa decisión antes de crear un solo producto."
                : "Confirmá los posibles duplicados de esta configuración antes de preparar el producto.", true);
              return;
            }
            if (duplicate.hasPriceConflict && duplicate.selectedIndex === null) {
              setStatus("Elegí la captura cuyo precio sea correcto antes de preparar el producto.", true);
              return;
            }
            const chosenIndex = duplicate.selectedIndex === null ? duplicate.indexes[duplicate.indexes.length - 1] : duplicate.selectedIndex;
            duplicate.indexes.forEach(rowIndex => includedIndexes.delete(rowIndex));
            includedIndexes.add(chosenIndex);
          }
          const includedRows = [...includedIndexes].sort((a, b) => a - b).map(rowIndex => scanCandidates[rowIndex]);
          const variantMap = new Map();
          for (const row of includedRows) {
            const configurationKey = normalizeScannerKey(row.ram) + "|" + normalizeScannerKey(row.storage);
            if (!variantMap.has(configurationKey)) variantMap.set(configurationKey, { ram: String(row.ram || ""), storage: String(row.storage || ""), rows: [] });
            variantMap.get(configurationKey).rows.push(row);
          }
          const variants = [];
          for (const group of variantMap.values()) {
            const uniquePrices = field => [...new Set(group.rows.map(row => row[field]).filter(value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))).map(Number))];
            const usd = uniquePrices("price_usd"), nio = uniquePrices("price_nio");
            const usdHasMissing = group.rows.some(row => row.price_usd === null || row.price_usd === undefined || row.price_usd === "");
            const nioHasMissing = group.rows.some(row => row.price_nio === null || row.price_nio === undefined || row.price_nio === "");
            if (usd.length > 1 || nio.length > 1) {
              setStatus("El mismo modelo y configuración tiene precios distintos entre colores/capturas. Corregí los datos antes de preparar el producto.", true);
              return;
            }
            variants.push({
              ram: group.ram,
              storage: group.storage,
              price_usd: usd.length && !usdHasMissing ? usd[0] : null,
              price_nio: nio.length && !nioHasMissing ? nio[0] : null,
              configuration_availability: "unknown",
              colors: group.rows.filter(row => String(row.color || "").trim()).map(row => ({
                color: String(row.color).trim(),
                color_hex: "",
                availability: "unknown"
              }))
            });
          }
          const first = newProductGroup.first;
          const categories = new Set(["Celulares", "Laptops", "Tablets", "Gaming", "Consolas", "Televisores", "Audio", "Accesorios", "Otros"]);
          const draft = {
            name: String(first.product_name || first.model || "").trim(),
            brand: String(first.brand || "").trim(),
            model: String(first.model || "").trim(),
            catalog_type: "technology",
            category: categories.has(String(first.category || "").trim()) ? String(first.category).trim() : "",
            subcategory: "",
            description: "",
            specs: "",
            availability: "unknown",
            warranty_months: null,
            price_usd: null,
            price_nio: null,
            variants,
            perfume: null
          };
          if (!draft.name) {
            setStatus("La lectura OCR no contiene un nombre de producto fiable. Corregí el nombre antes de preparar el formulario.", true);
            return;
          }
          createNew.disabled = true;
          createNew.textContent = "Preparando…";
          try {
            const prepared = await onPrepareNewProduct(draft);
            if (prepared) {
              createNew.textContent = "✓ Formulario preparado";
              newProductStatus.textContent = "Formulario abierto. Revisá el nombre, categoría, variantes y precios. No se guardó nada.";
            } else {
              createNew.disabled = false;
              createNew.textContent = "Preparar producto nuevo (" + newProductGroup.indexes.length + " captura(s))";
            }
          } catch (error) {
            createNew.disabled = false;
            createNew.textContent = "Preparar producto nuevo (" + newProductGroup.indexes.length + " captura(s))";
            setStatus(error?.message || "No se pudo preparar el producto nuevo.", true);
          }
        });
        card.append(createNew, newProductStatus);
      }

      const prepare = document.createElement("button"); prepare.type = "button"; prepare.className = "button button-outline jb-gp-prepare-review";
      prepare.textContent = "Preparar revisión de proveedor";
      const line = document.createElement("small"); line.className = "jb-gp-candidate-status";
      const group = duplicateGroups.find(item => item.indexes.includes(index));
      if (candidate.price_usd == null && candidate.price_nio == null) { prepare.disabled = true; line.textContent = "No se leyó un precio; verificá la ficha y volvé a capturarla."; }
      if (!candidate.matches.length) { prepare.disabled = true; line.textContent = "Sin coincidencia suficiente en JB Collections. No se modificará ningún producto."; }
      if (group) {
        if (!group.decision) { prepare.disabled = true; line.textContent = "Pendiente de reconfirmar el posible duplicado."; }
        else if (group.decision === "same" && group.hasPriceConflict && group.selectedIndex === null) {
          prepare.disabled = true; line.textContent = "Elegí qué captura contiene el precio correcto.";
        } else if (group.decision === "same" && group.selectedIndex !== index) {
          prepare.disabled = true; line.textContent = "Se consolidará con la captura " + (scanCandidates[group.selectedIndex]?.source_observation || group.selectedIndex + 1) + ".";
        }
      }
      prepare.addEventListener("click", () => {
        const chosen = catalog.find(item => String(item.id) === String(candidate.matchId));
        if (!chosen) { setStatus("Seleccioná un producto existente antes de preparar la revisión.", true); return; }
        const row = group?.decision === "same" && group.selectedIndex !== null ? scanCandidates[group.selectedIndex] : candidate;
        if (group?.decision === "same" && group.selectedIndex !== index) return;
        const prepared = providerTools?.openReviewFromScan?.(chosen.id, [row]);
        if (!prepared?.ok) { setStatus(prepared?.message || "No se pudo asociar la variante.", true); return; }
        line.textContent = "Datos preparados. Confirmá los campos y guardá desde la revisión del proveedor.";
        setStatus("Revisión preparada para " + (chosen.name || "el producto") + ". No se guardó ningún cambio todavía.");
      });
      card.append(heading, specs, price, confidence, evidence, warning, corrections, matchSelect, prepare, line);
      productList.append(card);
    });
    duplicateReview.querySelectorAll(".jb-gp-duplicate-decision").forEach(select => {
      select.addEventListener("change", () => {
        const group = duplicateGroups.find(item => item.key === select.dataset.key);
        if (!group) return;
        const state = duplicateState.get(group.key) || {};
        state.decision = select.value;
        state.selectedIndex = group.hasPriceConflict ? null : group.indexes[group.indexes.length - 1];
        duplicateState.set(group.key, state);
        renderReview();
      });
    });
    duplicateReview.querySelectorAll(".jb-gp-duplicate-price").forEach(select => {
      select.addEventListener("change", () => {
        const group = duplicateGroups.find(item => item.key === select.dataset.key);
        if (!group) return;
        const state = duplicateState.get(group.key) || {};
        state.selectedIndex = select.value === "" ? null : Number(select.value);
        duplicateState.set(group.key, state);
        renderReview();
      });
    });
    results.hidden = false;
  }
  async function start() {
    if (scanning || startInProgress) return;
    const native = plugin();
    if (!native) {
      setStatus("El escáner está disponible en la APK Android. El navegador no puede capturar otras aplicaciones.", true);
      return;
    }
    startInProgress = true;
    try {
      const supabase = getSupabase();
      if (!getCurrentUser() || !supabase) throw new Error("Iniciá sesión como administrador.");
      await getAccessToken();

      if (typeof native.hasOverlayPermission !== "function" || typeof native.requestOverlayPermission !== "function") {
        throw new Error("Actualizá JB Manager para habilitar el control flotante de JARVIS.");
      }
      const overlayPermission = await native.hasOverlayPermission();
      if (!overlayPermission?.granted) {
        if (!window.confirm("Para controlar el escaneo sin salir de Go Partners, JB Manager necesita permiso para mostrar un pequeño control flotante sobre otras aplicaciones. ¿Abrimos los ajustes de Android?")) {
          setStatus("El escaneo no se inició. Podés habilitar el control flotante cuando estés listo.");
          return;
        }
        pendingOverlayPermission = true;
        const permissionRequest = await native.requestOverlayPermission();
        if (permissionRequest?.opened !== true && permissionRequest?.granted !== true) {
          pendingOverlayPermission = false;
          throw new Error("Android no pudo abrir el permiso para mostrar el control flotante.");
        }
        setStatus("Habilitá «Mostrar sobre otras aplicaciones» para JB Manager. Al regresar, JARVIS iniciará el escaneo automáticamente.");
        return;
      }

      const pendingSession = await native.getScanState();
      if (scannerSessionReviewable(pendingSession)) {
        scanning = true;
        setStatus(scannerSessionStatus(pendingSession), pendingSession?.interrupted === true);
        updateControls();
        return;
      }
      await native.clearScan();
      scanCandidates = []; duplicateGroups = []; duplicateState.clear(); results.hidden = true;
      const result = await native.startScan();
      if (!result?.started) {
        if (result?.overlayPermissionRequired) {
          pendingOverlayPermission = true;
          const accepted = window.confirm("Necesitamos permiso para mostrar el control flotante de JARVIS. ¿Abrimos los ajustes de Android?");
          if (accepted) await native.requestOverlayPermission();
          else pendingOverlayPermission = false;
          setStatus("Habilitá el permiso y regresá a JB Manager para continuar.", !accepted);
          return;
        }
        throw new Error(result?.message || "No se concedió el permiso de captura.");
      }
      pendingOverlayPermission = false;
      let nativeState = await native.getScanState();
      for (let attempt = 0; attempt < 5 && !nativeState?.running && !scannerSessionReviewable(nativeState); attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 400));
        nativeState = await native.getScanState();
      }
      if (!nativeState?.running) {
        if (scannerSessionReviewable(nativeState)) {
          scanning = true;
          setStatus(scannerSessionStatus(nativeState), nativeState?.interrupted === true);
          updateControls();
          return;
        }
        throw new Error("Android no pudo iniciar la captura. Volvé a intentarlo y aceptá el permiso de compartir pantalla.");
      }
      scanning = true;
      root.hidden = false;
      setStatus("Escaneo activo. Navegá por Go Partners; el control flotante de JARVIS te permitirá finalizar y volver automáticamente para revisar los resultados.");
    } catch (error) {
      pendingOverlayPermission = false;
      setStatus(error?.message || "No se pudo iniciar el escaneo.", true);
    } finally {
      startInProgress = false;
      updateControls();
    }
  }
  async function finish() {
    if (!scanning || finishing) return;
    finishing = true;
    const native = plugin();
    if (!native) { finishing = false; setStatus("No se encontró el servicio nativo de captura.", true); return; }
    finishButton.disabled = true; setStatus("Finalizando captura y recuperando texto OCR…");
    let recoverableSession = false;
    try {
      const session = await native.stopScan();
      if (session?.running === true || session?.processing === true) {
        scanning = true;
        setStatus("Android todavía está cerrando la captura. Los resultados parciales se conservaron; pulsá Finalizar y revisar nuevamente en unos segundos.", true);
        updateControls();
        return;
      }
      scanning = false; updateControls();
      const observations = Array.isArray(session?.observations) ? session.observations : [];
      const wasTruncated = session?.truncated === true;
      const wasInterrupted = session?.interrupted === true;
      const interruptionReason = String(session?.interruptionReason || "").trim();
      if (!observations.length) {
        await native.clearScan().catch(() => {});
        setStatus(wasInterrupted
          ? "Android interrumpió la captura y no quedaron pantallas OCR para revisar. " + interruptionReason
          : "No se reconoció texto. Comprobá que Go Partners permita capturas y repetí la sesión.", true);
        return;
      }
      recoverableSession = true;
      setStatus("Se leyeron " + observations.length + " pantallas. JARVIS está identificando productos y variantes…");
      const response = await fetch("https://jb-collections.pages.dev/api/jb-gopartners-scan", {
        method: "POST", headers: { Authorization: "Bearer " + await getAccessToken(), "Content-Type": "application/json" },
        cache: "no-store", body: JSON.stringify({ observations: observations.slice(0, 80) })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(scannerErrorMessage(payload, response.status));
      scanCandidates = Array.isArray(payload.products) ? payload.products.map(item => ({
        ...item, price_usd: item.price_usd == null ? null : Number(item.price_usd),
        price_nio: item.price_nio == null ? null : Number(item.price_nio)
      })) : [];
      if (!scanCandidates.length) {
        scanning = true;
        setStatus("No se identificaron productos con nombre o modelo legible. El texto OCR permanece en memoria; podés volver a finalizar para reintentar o descartar la sesión.", true);
        return;
      }
      renderReview();
      const cleared = await native.clearScan();
      if (cleared?.cleared !== true) {
        throw new Error("Los productos quedaron listos para revisión, pero Android no confirmó la eliminación del OCR temporal.");
      }
      recoverableSession = false;
      setStatus(wasInterrupted
        ? "Revisión parcial lista. Android interrumpió la captura, pero se recuperaron " + observations.length + " pantalla(s). " + interruptionReason + " Revisá cuidadosamente los resultados."
        : wasTruncated
          ? "Análisis listo. Se alcanzó el límite de 80 pantallas; revisá estos resultados y, si faltan productos, iniciá otra sesión."
          : "Análisis listo. Revisá las coincidencias y reconfirmá los duplicados antes de preparar actualizaciones.");
    } catch (error) {
      if (recoverableSession) {
        scanning = true;
        setStatus((error?.message || "Falló el análisis de la sesión.") +
          " El texto OCR sigue guardado temporalmente en este dispositivo; pulsá Finalizar y revisar para reintentar o Descartar sesión para eliminarlo.", true);
      } else {
        setStatus(error?.message || "Falló el análisis de la sesión.", true);
      }
    } finally { finishing = false; updateControls(); }
  }
  async function clearSession() {
    const native = plugin();
    if (!native) {
      setStatus("La sesión OCR solo puede descartarse desde la APK Android.", true);
      return;
    }
    try {
      let state = await native.getScanState();
      if (state?.running === true || state?.processing === true) {
        setStatus("Deteniendo la captura antes de descartar los resultados…");
        state = await native.stopScan();
      }
      if (state?.running === true || state?.processing === true) {
        scanning = true;
        setStatus("Android todavía está procesando la última pantalla. No se eliminó ningún resultado; esperá unos segundos y volvé a descartar.", true);
        updateControls();
        return;
      }
      const cleared = await native.clearScan();
      if (cleared?.cleared !== true) throw new Error("Android no confirmó la eliminación de la sesión.");
      scanning = false;
      scanCandidates = []; duplicateGroups = []; duplicateState.clear(); results.hidden = true;
      setStatus("Sesión descartada. Android confirmó que se eliminó el texto OCR temporal.");
    } catch (error) {
      scanning = false;
      try { restoreSessionState(await native.getScanState()); } catch {}
      setStatus((error?.message || "No se pudo descartar la sesión.") + " Los resultados no se consideran eliminados.", true);
    }
    updateControls();
  }
  startButton.addEventListener("click", () => { void start(); });
  finishButton.addEventListener("click", () => { void finish(); });
  clearButton.addEventListener("click", () => { void clearSession(); });
  function restoreSessionState(state) {
    if (!scannerSessionReviewable(state)) return;
    scanning = true;
    setStatus(scannerSessionStatus(state), state?.interrupted === true);
    updateControls();
  }
  async function handleNativeResume() {
    const native = plugin();
    if (!native) return;
    try {
      if (pendingOverlayPermission) {
        const permission = await native.hasOverlayPermission();
        if (permission?.granted) {
          pendingOverlayPermission = false;
          setStatus("Permiso concedido. JARVIS está iniciando el escaneo…");
          void start();
        } else {
          setStatus("El control flotante aún no tiene permiso. Activá «Mostrar sobre otras aplicaciones» en Android.", true);
        }
        return;
      }
      const state = await native.getScanState();
      if (state?.finishRequested === true) {
        scanning = true;
        updateControls();
        void finish();
        return;
      }
      restoreSessionState(state);
    } catch (error) {
      console.warn("No se pudo recuperar el estado del escáner JARVIS:", error);
    }
  }
  window.addEventListener("focus", () => { void handleNativeResume(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void handleNativeResume();
  });
  const native = plugin();
  if (!native) setStatus("Disponible en la APK Android. El navegador no puede capturar otras aplicaciones.");
  else void native.getScanState?.().then(restoreSessionState).catch(() => {});
  updateControls();
  return { clearSession, isScanning: () => scanning };
}
