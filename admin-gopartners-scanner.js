const $ = selector => document.querySelector(selector);
export function normalizeScannerKey(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "");
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
export function initGoPartnersScanner({ getSupabase, getCurrentUser, getProducts, providerTools }) {
  const root = $("#jb-gp-scanner");
  if (!root) return null;
  const startButton = $("#jb-gp-scan-start"), finishButton = $("#jb-gp-scan-finish"), clearButton = $("#jb-gp-scan-clear");
  const status = $("#jb-gp-scan-status"), results = $("#jb-gp-scan-results"), summary = $("#jb-gp-scan-summary");
  const duplicateReview = $("#jb-gp-scan-duplicates"), productList = $("#jb-gp-scan-products");
  if (!startButton || !finishButton || !status || !results || !summary || !duplicateReview || !productList) return null;
  let scanning = false, scanCandidates = [], duplicateGroups = [];
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
    clearButton.disabled = scanning && scanCandidates.length === 0;
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
      confidence.textContent = "Confianza de lectura: " + Math.round((candidate.confidence || 0) * 100) + "% · Captura " + (candidate.source_observation || "—");
      const evidence = document.createElement("small"); evidence.textContent = candidate.evidence ? "Evidencia: " + candidate.evidence : "Sin evidencia OCR.";
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
      card.append(heading, specs, price, confidence, evidence, matchSelect, prepare, line);
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
    if (scanning) return;
    const native = plugin();
    if (!native) { setStatus("Disponible solo en la APK Android actualizada. La web no puede capturar otras aplicaciones.", true); return; }
    try {
      const supabase = getSupabase();
      if (!getCurrentUser() || !supabase) throw new Error("Iniciá sesión como administrador.");
      await getAccessToken();
      await native.clearScan();
      const result = await native.startScan();
      if (!result?.started) throw new Error(result?.message || "No se concedió el permiso de captura.");
      await new Promise(resolve => setTimeout(resolve, 900));
      const nativeState = await native.getScanState();
      if (!nativeState?.running) {
        await native.clearScan().catch(() => {});
        throw new Error("Android no pudo mantener activa la captura. Revisá el permiso o si Go Partners bloquea las capturas de pantalla.");
      }
      scanning = true; scanCandidates = []; duplicateGroups = []; duplicateState.clear(); results.hidden = true;
      setStatus("Escaneo activo. Abrí Go Partners y recorré los productos manualmente. Mantené cada ficha visible un par de segundos. Las imágenes no se guardan: solo texto OCR temporal.");
    } catch (error) { setStatus(error?.message || "No se pudo iniciar el escaneo.", true); }
    updateControls();
  }
  async function finish() {
    if (!scanning) return;
    const native = plugin();
    if (!native) { setStatus("No se encontró el servicio nativo de captura.", true); return; }
    finishButton.disabled = true; setStatus("Finalizando captura y recuperando texto OCR…");
    try {
      const session = await native.stopScan(); scanning = false; updateControls();
      const observations = Array.isArray(session?.observations) ? session.observations : [];
      await native.clearScan();
      if (!observations.length) { setStatus("No se reconoció texto. Comprobá que Go Partners permita capturas y repetí la sesión.", true); return; }
      if (session?.truncated) setStatus("Se alcanzó el límite de 80 pantallas. Se analizarán las primeras 80; podés continuar con otra sesión después.");
      else setStatus("Se leyeron " + observations.length + " pantallas. JARVIS está identificando productos y variantes…");
      const response = await fetch("/api/jb-gopartners-scan", {
        method: "POST", headers: { Authorization: "Bearer " + await getAccessToken(), "Content-Type": "application/json" },
        cache: "no-store", body: JSON.stringify({ observations: observations.slice(0, 80) })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || "No se pudo analizar el catálogo.");
      scanCandidates = Array.isArray(payload.products) ? payload.products.map(item => ({
        ...item, price_usd: item.price_usd == null ? null : Number(item.price_usd),
        price_nio: item.price_nio == null ? null : Number(item.price_nio)
      })) : [];
      if (!scanCandidates.length) { setStatus("No se encontraron productos con nombre o modelo legible. Mantené cada ficha visible unos segundos.", true); return; }
      renderReview();
      setStatus("Análisis listo. Revisá las coincidencias y reconfirmá los duplicados antes de preparar actualizaciones.");
    } catch (error) { setStatus(error?.message || "Falló el análisis de la sesión.", true); }
    finally { updateControls(); }
  }
  async function clearSession() {
    const native = plugin();
    if (scanning) { scanning = false; try { await native?.stopScan?.(); } catch {} }
    try { await native?.clearScan?.(); } catch {}
    scanCandidates = []; duplicateGroups = []; duplicateState.clear(); results.hidden = true;
    setStatus("Sesión descartada. El texto temporal fue eliminado del dispositivo."); updateControls();
  }
  startButton.addEventListener("click", () => { void start(); });
  finishButton.addEventListener("click", () => { void finish(); });
  clearButton.addEventListener("click", () => { void clearSession(); });
  window.addEventListener("focus", async () => {
    const native = plugin();
    if (!native || scanning) return;
    try { const state = await native.getScanState(); if (state?.running) {
      scanning = true;
      setStatus("La captura sigue activa. Se han leído " + Number(state.observationsCount || 0) + " pantallas. Podés continuar o finalizar aquí.");
      updateControls();
    }} catch {}
  });
  const native = plugin();
  if (!native) setStatus("Disponible en la APK Android. El navegador no puede capturar otras aplicaciones.");
  else void native.getScanState?.().then(state => {
    if (state?.running) { scanning = true; setStatus("Se recuperó una sesión activa. Pantallas reconocidas: " + Number(state.observationsCount || 0) + "."); updateControls(); }
  }).catch(() => {});
  updateControls();
  return { clearSession, isScanning: () => scanning };
}
