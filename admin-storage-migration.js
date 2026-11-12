const TOKEN_KEY = "jb-supabase-r2-migration-cursor-v1";
const STATE_KEY = "jb-supabase-r2-migration-progress-v1";

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function parseArrayValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function cacheMediaPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), "https://jb-collections.pages.dev");
    const host = url.hostname.toLowerCase();
    if (host !== "jb-collections.pages.dev" &&
        host !== "fiverr-demo.jb-collections.pages.dev") return null;
    if (!url.pathname.startsWith("/media/")) return null;
    const path = url.pathname.slice("/media/".length).split("/")
      .map(segment => decodeURIComponent(segment)).join("/");
    const parts = path.split("/");
    if (parts.length < 2 || parts.length > 8 || path.length > 900) return null;
    if (parts.some(part => !part || part === "." || part === ".." ||
        !/^[a-z0-9._-]+$/i.test(part))) return null;
    if (!/\.(?:avif|gif|jpe?g|jfif|png|webp)$/i.test(path)) return null;
    return parts.join("/");
  } catch {
    return null;
  }
}

function cacheProductPaths(product) {
  const paths = new Set();
  const add = value => {
    const path = cacheMediaPath(value);
    if (path) paths.add(path);
  };
  const addCollection = value => {
    for (const item of parseArrayValue(value)) {
      if (typeof item === "string") add(item);
      else if (item && typeof item === "object") {
        add(item.image_url);
        for (const image of parseArrayValue(item.images)) {
          if (typeof image === "string") add(image);
        }
      }
    }
  };

  add(product?.image_url);
  addCollection(product?.images);
  for (const variant of parseArrayValue(product?.variants)) {
    if (!variant || typeof variant !== "object") continue;
    add(variant.image_url);
    addCollection(variant.images);
  }
  for (const color of parseArrayValue(product?.colors)) {
    if (!color || typeof color !== "object") continue;
    add(color.image_url);
    addCollection(color.images);
  }
  return Array.from(paths);
}

function initCacheRescue({ getClient, getCurrentUser }) {
  const legacyCheck = document.getElementById("storage-migration-check");
  const legacyStart = document.getElementById("storage-migration-start");
  const legacyStatus = document.getElementById("storage-migration-status");
  if (legacyCheck) {
    legacyCheck.disabled = true;
    legacyCheck.title = "Deshabilitado en Fiverr demo: no se consulta Supabase Storage.";
  }
  if (legacyStart) {
    legacyStart.disabled = true;
    legacyStart.title = "Deshabilitado en Fiverr demo: usá el rescate desde caché.";
  }
  if (legacyStatus) {
    legacyStatus.textContent = "Migración directa desde Supabase deshabilitada en Fiverr demo. Usá el rescate de caché de Cloudflare que aparece abajo.";
    legacyStatus.dataset.state = "warning";
  }

  const probeButton = document.getElementById("cache-rescue-probe");
  const startButton = document.getElementById("cache-rescue-start");
  const unpublishButton = document.getElementById("cache-rescue-unpublish");
  const reportButton = document.getElementById("cache-rescue-report");
  const status = document.getElementById("cache-rescue-status");
  const progress = document.getElementById("cache-rescue-progress");
  const summary = document.getElementById("cache-rescue-summary");
  const log = document.getElementById("cache-rescue-log");
  if (!probeButton || !startButton || !unpublishButton || !reportButton ||
      !status || !progress || !summary || !log) return null;

  const PROD_TABLE_FIELDS = "id,name,is_published,workflow_status,image_url,images,variants,colors";
  let products = [];
  let allPaths = [];
  let resultsByPath = new Map();
  let affectedProducts = [];
  let scanComplete = false;
  let running = false;
  let probeComplete = false;

  function setStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state || "info";
  }

  function writeLog(message) {
    const line = document.createElement("p");
    line.textContent = new Date().toLocaleTimeString() + " · " + message;
    log.prepend(line);
    while (log.children.length > 40) log.lastElementChild.remove();
  }

  function renderSummary(done) {
    const copied = Array.from(resultsByPath.values()).filter(item => item.status === "copied").length;
    const existing = Array.from(resultsByPath.values()).filter(item => item.status === "already").length;
    const misses = Array.from(resultsByPath.values()).filter(item => item.status === "miss").length;
    const errors = Array.from(resultsByPath.values()).filter(item => item.status === "error" || item.status === "invalid").length;
    summary.textContent = allPaths.length
      ? (Number(done || 0) + " de " + allPaths.length + " imágenes revisadas · " +
        copied + " recuperadas · " + existing + " ya estaban en R2 · " +
        misses + " no estaban en caché · " + errors + " con error.")
      : "Primero cargá el inventario de productos.";
  }

  async function getSessionToken() {
    const client = getClient?.();
    if (!client || !getCurrentUser?.()) {
      throw new Error("Iniciá sesión como propietario para usar el rescate de imágenes.");
    }
    const sessionResult = await client.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    const token = sessionResult.data?.session?.access_token;
    if (!token) throw new Error("La sesión administrativa expiró. Volvé a iniciar sesión.");
    return { client, token };
  }

  async function apiRequest(action, paths) {
    const session = await getSessionToken();
    const response = await fetch("./api/migration/cache-rescue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.token,
        "Cache-Control": "no-store"
      },
      body: JSON.stringify({ action, paths })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "El rescate falló (HTTP " + response.status + ").");
    }
    return body.data || {};
  }

  async function loadProducts() {
    const session = await getSessionToken();
    const { data, error } = await session.client.from("products")
      .select(PROD_TABLE_FIELDS);
    if (error) throw error;
    products = Array.isArray(data) ? data : [];
    const byProduct = products.map(product => cacheProductPaths(product));
    allPaths = Array.from(new Set(byProduct.flat())).sort();
    if (!allPaths.length) throw new Error("No se encontraron rutas /media válidas en los productos de la demo.");
    return byProduct;
  }

  function updatePathResults(results) {
    for (const item of results || []) {
      if (item && typeof item.path === "string") resultsByPath.set(item.path, item);
    }
  }

  async function probeCache() {
    if (running) return;
    probeButton.disabled = true;
    startButton.disabled = true;
    unpublishButton.hidden = true;
    reportButton.hidden = true;
    setStatus("Cargando productos y probando cinco imágenes de referencia en la caché de Cloudflare…", "busy");
    try {
      const byProduct = await loadProducts();
      const sample = [];
      for (const paths of byProduct) {
        if (paths.length) sample.push(paths[0]);
        if (sample.length >= 5) break;
      }
      const fallbackSample = allPaths.slice(0, 5);
      const pathsToProbe = Array.from(new Set(sample.length ? sample : fallbackSample)).slice(0, 5);
      const data = await apiRequest("probe", pathsToProbe);
      updatePathResults(data.results);
      probeComplete = true;
      const hits = Number(data.hits || 0);
      const misses = Number(data.misses || 0);
      writeLog("Prueba: " + hits + " aciertos de caché y " + misses + " ausencias en " + pathsToProbe.length + " imágenes. No se copió nada.");
      setStatus(
        hits
          ? "La caché respondió con " + hits + " acierto(s). Ya podés iniciar la recuperación completa."
          : "Las muestras no tuvieron aciertos. Aun así se puede recorrer el inventario completo; la consulta no hará solicitudes a Supabase.",
        hits ? "success" : "warning"
      );
      startButton.disabled = false;
      startButton.textContent = "Recuperar imágenes referenciadas";
      renderSummary(0);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo probar la caché.", "error");
      writeLog("Prueba detenida: " + (error?.message || "error desconocido"));
    } finally {
      probeButton.disabled = false;
    }
  }

  function determineAffectedProducts() {
    affectedProducts = products.filter(product => {
      const paths = cacheProductPaths(product);
      if (!paths.length) return true;
      return paths.some(path => {
        const result = resultsByPath.get(path);
        return !result || (result.status !== "copied" && result.status !== "already");
      });
    });
    const publishedAffected = affectedProducts.filter(product => product.is_published === true);
    unpublishButton.hidden = publishedAffected.length === 0;
    unpublishButton.disabled = publishedAffected.length === 0;
    unpublishButton.textContent = publishedAffected.length
      ? "Pasar " + publishedAffected.length + " producto(s) a No publicados"
      : "No hay productos publicados con imágenes faltantes";
    reportButton.hidden = false;
    return publishedAffected;
  }

  async function recoverAll() {
    if (running) return;
    if (!probeComplete && !allPaths.length) {
      setStatus("Primero ejecutá la prueba de caché.", "warning");
      return;
    }

    running = true;
    scanComplete = false;
    startButton.disabled = true;
    probeButton.disabled = true;
    unpublishButton.hidden = true;
    reportButton.hidden = true;
    startButton.textContent = "Recuperando…";

    try {
      await loadProducts();
      resultsByPath = new Map();
      progress.max = Math.max(1, allPaths.length);
      progress.value = 0;
      setStatus("Recuperando por lotes de diez. Solo se consultará la caché local y se escribirá en el R2 de la demo.", "busy");

      for (let offset = 0; offset < allPaths.length; offset += 10) {
        const batchPaths = allPaths.slice(offset, offset + 10);
        const data = await apiRequest("rescue", batchPaths);
        updatePathResults(data.results);
        const done = Math.min(allPaths.length, offset + batchPaths.length);
        progress.value = done;
        renderSummary(done);
        const copied = Number(data.copied || 0);
        const existing = Number(data.alreadyPresent || 0);
        const misses = Number(data.misses || 0);
        const errors = Number(data.errors || 0);
        writeLog("Lote " + (Math.floor(offset / 10) + 1) + ": " +
          copied + " recuperadas, " + existing + " ya existentes, " +
          misses + " sin caché y " + errors + " incidencias.");
      }

      scanComplete = true;
      const publishedAffected = determineAffectedProducts();
      const copiedCount = Array.from(resultsByPath.values()).filter(item => item.status === "copied").length;
      const alreadyCount = Array.from(resultsByPath.values()).filter(item => item.status === "already").length;
      const missingPaths = allPaths.filter(path => {
        const result = resultsByPath.get(path);
        return !result || (result.status !== "copied" && result.status !== "already");
      });
      const misses = missingPaths.filter(path => resultsByPath.get(path)?.status === "miss").length;
      const errors = missingPaths.length - misses;
      setStatus(
        "Recorrido completo: " + copiedCount + " recuperadas, " + alreadyCount +
        " ya estaban en R2, " + missingPaths.length + " imágenes pendientes. " +
        publishedAffected.length + " producto(s) publicados requieren revisión.",
        missingPaths.length ? "warning" : "success"
      );
      writeLog("Rescate terminado. " + missingPaths.length + " rutas no quedaron disponibles; " +
        publishedAffected.length + " productos publicados se pueden pasar a No publicados.");
      if (missingPaths.length) {
        missingPaths.slice(0, 12).forEach(path => {
          const result = resultsByPath.get(path);
          writeLog(path + ": " + (result?.reason || "No se recuperó desde caché."));
        });
      }
      if (!publishedAffected.length) {
        unpublishButton.hidden = false;
        unpublishButton.disabled = true;
        unpublishButton.textContent = "No hay productos publicados con imágenes faltantes";
      }
      renderSummary(allPaths.length);
      startButton.textContent = "Volver a revisar imágenes";
    } catch (error) {
      scanComplete = false;
      setStatus(error instanceof Error ? error.message : "El rescate se interrumpió.", "error");
      writeLog("Rescate interrumpido. Podés volver a ejecutarlo; los objetos ya guardados en R2 se reconocerán y no se sobrescribirán.");
      startButton.textContent = "Reintentar rescate";
    } finally {
      running = false;
      startButton.disabled = false;
      probeButton.disabled = false;
    }
  }

  async function unpublishAffected() {
    if (!scanComplete || running) return;
    const ids = affectedProducts
      .filter(product => product.is_published === true)
      .map(product => product.id)
      .filter(Boolean);
    if (!ids.length) {
      setStatus("No hay productos publicados que deban pasar a No publicados.", "success");
      unpublishButton.disabled = true;
      return;
    }
    const confirmed = window.confirm(
      "Se pasarán " + ids.length + " productos a No publicados porque les falta al menos una imagen referenciada. ¿Continuar?"
    );
    if (!confirmed) return;

    unpublishButton.disabled = true;
    setStatus("Actualizando el estado de los productos afectados en la base aislada de fiverr-demo…", "busy");
    try {
      const session = await getSessionToken();
      const user = getCurrentUser?.();
      const update = await session.client.from("products")
        .update({
          is_published: false,
          workflow_status: "unpublished",
          updated_at: new Date().toISOString()
        })
        .in("id", ids)
        .select("id");
      if (update.error) throw update.error;
      const updatedIds = new Set((Array.isArray(update.data) ? update.data : []).map(row => String(row.id)));
      products = products.map(product => updatedIds.has(String(product.id))
        ? { ...product, is_published: false, workflow_status: "unpublished" }
        : product);
      unpublishButton.textContent = updatedIds.size + " producto(s) pasaron a No publicados";
      setStatus(
        updatedIds.size === ids.length
          ? "Listo: " + updatedIds.size + " producto(s) quedaron en No publicados. Sus registros y demás datos se conservaron."
          : "La actualización reportó " + updatedIds.size + " de " + ids.length + " productos. Revisá los permisos y el listado No publicados.",
        updatedIds.size === ids.length ? "success" : "warning"
      );
      writeLog(updatedIds.size + " producto(s) actualizados en fiverr-demo; no se eliminó ningún producto ni archivo.");
    } catch (error) {
      unpublishButton.disabled = false;
      setStatus(error instanceof Error ? error.message : "No se pudieron actualizar los productos.", "error");
      writeLog("No se cambió el estado de los productos: " + (error?.message || "error desconocido"));
    }
  }

  function downloadMissingReport() {
    if (!scanComplete) return;
    const missingPaths = allPaths.filter(path => {
      const result = resultsByPath.get(path);
      return !result || (result.status !== "copied" && result.status !== "already");
    });
    const report = {
      generatedAt: new Date().toISOString(),
      source: "Cloudflare Cache API only; no Supabase Storage requests",
      totalUniquePaths: allPaths.length,
      copied: Array.from(resultsByPath.values()).filter(item => item.status === "copied").length,
      alreadyPresent: Array.from(resultsByPath.values()).filter(item => item.status === "already").length,
      missing: missingPaths.map(path => ({
        path,
        status: resultsByPath.get(path)?.status || "not-checked",
        reason: resultsByPath.get(path)?.reason || "No se obtuvo una copia."
      })),
      affectedProducts: affectedProducts.map(product => ({
        id: product.id,
        name: product.name,
        isPublished: product.is_published === true,
        missingPaths: cacheProductPaths(product).filter(path => {
          const result = resultsByPath.get(path);
          return !result || (result.status !== "copied" && result.status !== "already");
        })
      }))
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "jb-fiverr-demo-imagenes-pendientes.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    writeLog("Informe de imágenes pendientes descargado.");
  }

  probeButton.addEventListener("click", () => void probeCache());
  startButton.addEventListener("click", () => void recoverAll());
  unpublishButton.addEventListener("click", () => void unpublishAffected());
  reportButton.addEventListener("click", downloadMissingReport);
  startButton.disabled = true;
  unpublishButton.hidden = true;
  reportButton.hidden = true;
  progress.max = 1;
  progress.value = 0;
  setStatus("Probá primero cinco imágenes. Esta herramienta no consulta Supabase Storage.", "info");
  return { probeCache, recoverAll };
}

export function initStorageMigration({ getClient, getCurrentUser }) {
  if (window.location.hostname === "fiverr-demo.jb-collections.pages.dev") {
    return initCacheRescue({ getClient, getCurrentUser });
  }

  const inventoryButton = document.getElementById("storage-migration-check");
  const startButton = document.getElementById("storage-migration-start");
  const status = document.getElementById("storage-migration-status");
  const progress = document.getElementById("storage-migration-progress");
  const summary = document.getElementById("storage-migration-summary");
  const log = document.getElementById("storage-migration-log");
  if (!inventoryButton || !startButton || !status || !progress || !summary || !log) return null;

  let inventory = null;
  let running = false;
  let stopRequested = false;
  let copied = 0;
  let alreadyPresent = 0;
  let failed = 0;
  let conflicts = 0;
  let bytesCopied = 0;
  let processed = 0;
  let continuationToken = "";
  let sourceRestricted = false;
  let migrationCompleted = false;

  function restoreProgress() {
    try {
      continuationToken = sessionStorage.getItem(TOKEN_KEY) || "";
      const saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || "null");
      if (!saved || saved.version !== 1) return;
      migrationCompleted = saved.completed === true;
      for (const [key, setter] of [
        ["copied", value => { copied = value; }],
        ["alreadyPresent", value => { alreadyPresent = value; }],
        ["failed", value => { failed = value; }],
        ["conflicts", value => { conflicts = value; }],
        ["bytesCopied", value => { bytesCopied = value; }],
        ["processed", value => { processed = value; }]
      ]) {
        const value = Number(saved[key]);
        if (Number.isSafeInteger(value) && value >= 0) setter(value);
      }
    } catch {
      continuationToken = "";
    }
  }

  function persistProgress() {
    try {
      if (continuationToken) sessionStorage.setItem(TOKEN_KEY, continuationToken);
      else sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.setItem(STATE_KEY, JSON.stringify({
        version: 1, copied, alreadyPresent, failed, conflicts, bytesCopied, processed,
        completed: migrationCompleted
      }));
    } catch {}
  }

  function explainError(error) {
    const message = error instanceof Error ? error.message : "Error desconocido.";
    if (/HTTP 402|SUPABASE_SERVICE_RESTRICTED/.test(message)) {
      return "Supabase tiene los servicios restringidos por cuota (HTTP 402). La migración quedó detenida; no se eliminaron ni sobrescribieron imágenes. No reintentes la copia hasta que Supabase restablezca el acceso.";
    }
    return message;
  }

  restoreProgress();

  function setStatus(message, state = "info") {
    status.textContent = message;
    status.dataset.state = state;
  }

  function renderSummary() {
    const total = inventory?.objectCount || 0;
    const done = Math.min(total, processed);
    progress.max = Math.max(1, total);
    progress.value = done;
    summary.textContent = total
      ? done + " de " + total + " objetos procesados · " +
        copied + " copiados · " + alreadyPresent + " ya existentes · " +
        failed + " errores · " + conflicts + " conflictos · " +
        formatBytes(bytesCopied) + " transferidos"
      : "Primero verificá la conexión y el inventario de origen.";
  }

  async function request(payload) {
    const client = getClient?.();
    if (!client || !getCurrentUser?.()) throw new Error("Iniciá sesión como administrador antes de continuar.");
    const sessionResult = await client.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    const token = sessionResult.data?.session?.access_token;
    if (!token) throw new Error("La sesión administrativa expiró. Volvé a iniciar sesión.");
    const response = await fetch("./api/migration/supabase-r2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "Cache-Control": "no-store"
      },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "La operación de migración falló (HTTP " + response.status + ").");
    return body.data || {};
  }

  function writeLog(message) {
    const line = document.createElement("p");
    line.textContent = new Date().toLocaleTimeString() + " · " + message;
    log.prepend(line);
    while (log.children.length > 30) log.lastElementChild.remove();
  }

  async function checkInventory() {
    inventoryButton.disabled = true;
    startButton.disabled = true;
    setStatus("Comprobando acceso S3 e inventariando el bucket…", "busy");
    try {
      inventory = await request({ action: "inventory" });
      renderSummary();
      const size = formatBytes(inventory.totalBytes);
      const pageLabel = inventory.pageCount ? " · " + inventory.pageCount + " página(s)" : "";
      const message = inventory.objectCount + " objetos encontrados · " + size + pageLabel +
        " · " + inventory.invalidObjectCount + " rutas fuera del formato esperado.";
      writeLog(message);
      if (inventory.isTruncated) {
        setStatus(inventory.message || "El inventario superó el límite seguro de páginas. No iniciamos la copia.", "warning");
      } else if (inventory.invalidObjectCount > 0) {
        setStatus("Hay rutas que requieren revisión. No iniciamos la copia.", "warning");
      } else {
        setStatus("Conexión S3 correcta. Inventario listo; no se modificó ningún archivo.", "success");
        startButton.disabled = sourceRestricted || migrationCompleted || !inventory || inventory.isTruncated || Number(inventory.invalidObjectCount) > 0 || !inventory.objectCount;
        if (migrationCompleted) {
          setStatus("La migración ya fue completada en esta sesión. No se volverá a copiar automáticamente.", "success");
        }
      }
    } catch (error) {
      const message = explainError(error);
      if (/HTTP 402|SUPABASE_SERVICE_RESTRICTED/.test(message)) sourceRestricted = true;
      setStatus(message, "error");
      writeLog("Inventario detenido: " + message);
    } finally {
      inventoryButton.disabled = sourceRestricted;
      startButton.disabled = sourceRestricted || migrationCompleted || !inventory || inventory.isTruncated || Number(inventory.invalidObjectCount) > 0 || !inventory.objectCount;
    }
  }

  async function runMigration() {
    if (migrationCompleted || sourceRestricted) return;
    if (running) {
      stopRequested = true;
      startButton.textContent = "Deteniendo al terminar este lote…";
      startButton.disabled = true;
      return;
    }
    if (!inventory) await checkInventory();
    if (!inventory || inventory.isTruncated || inventory.invalidObjectCount > 0 || !inventory.objectCount) return;

    running = true;
    stopRequested = false;
    inventoryButton.disabled = true;
    startButton.disabled = false;
    startButton.textContent = "Detener después del lote";
    setStatus("Copiando por lotes. No cerrés esta pestaña hasta pausar o terminar.", "busy");

    try {
      while (!stopRequested) {
        const tokenBeforeBatch = continuationToken;
        const batch = await request({
          action: "copy",
          batchSize: 10,
          continuationToken: tokenBeforeBatch
        });
        const data = batch;

        if (data.failed || data.conflicts) {
          // The cursor remains at this batch. The next attempt rechecks every
          // object by SHA-256 and will not overwrite a different R2 object.
          continuationToken = tokenBeforeBatch;
          failed = Number(data.failed || 0);
          conflicts = Number(data.conflicts || 0);
          const errors = Array.isArray(data.errors) ? data.errors : [];
          if (errors.some(item => /HTTP 402/.test(String(item?.reason || "")))) {
            sourceRestricted = true;
          }
          persistProgress();
          writeLog("Lote con incidencias: " + failed + " errores y " + conflicts + " conflictos. No se avanzó el cursor.");
          errors.slice(0, 10).forEach(item => writeLog(String(item.key || "Objeto") + ": " + String(item.reason || "Error sin detalle")));
          if (sourceRestricted) {
            setStatus(explainError(new Error("HTTP 402")), "error");
          } else {
            setStatus("La copia se pausó para revisar incidencias. Los originales siguen intactos y R2 no sobrescribió conflictos.", "warning");
          }
          break;
        }

        const nextToken = data.nextContinuationToken || "";
        if (data.isTruncated && (!nextToken || nextToken === tokenBeforeBatch)) {
          throw new Error("La paginación S3 no avanzó. La migración se detuvo para evitar repetir el mismo lote.");
        }

        copied += Number(data.copied || 0);
        alreadyPresent += Number(data.alreadyPresent || 0);
        failed = 0;
        conflicts = 0;
        bytesCopied += Number(data.bytesCopied || 0);
        processed += Number(data.processed || 0);
        continuationToken = nextToken;
        persistProgress();

        writeLog(data.copied + " copiados, " + data.alreadyPresent + " ya verificados; " +
          Number(data.sha256Verified || 0) + " verificados por SHA-256; " +
          formatBytes(data.bytesCopied) + " en este lote.");
        renderSummary();

        if (!data.isTruncated) {
          continuationToken = "";
          migrationCompleted = true;
          persistProgress();
          setStatus("Migración terminada. Los archivos nuevos y los ya existentes fueron verificados por SHA-256. Supabase no se modificó.", "success");
          writeLog("Migración completada; no se borró ningún objeto del bucket de origen.");
          break;
        }
      }

      if (stopRequested) {
        persistProgress();
        setStatus("Migración pausada entre lotes. Podés continuar desde este mismo dispositivo.", "info");
        writeLog("Pausa solicitada; el cursor de continuación quedó guardado en esta sesión.");
      }
    } catch (error) {
      const message = explainError(error);
      if (/HTTP 402|SUPABASE_SERVICE_RESTRICTED/.test(message)) sourceRestricted = true;
      setStatus(message, "error");
      writeLog("Migración interrumpida; el origen permanece intacto. " + message);
    } finally {
      running = false;
      stopRequested = false;
      inventoryButton.disabled = sourceRestricted;
      startButton.disabled = sourceRestricted || migrationCompleted || !inventory || inventory.isTruncated || Number(inventory.invalidObjectCount) > 0 || !inventory.objectCount;
      startButton.textContent = "Continuar migración";
      renderSummary();
    }
  }

  inventoryButton.addEventListener("click", () => void checkInventory());
  startButton.addEventListener("click", () => void runMigration());
  renderSummary();
  return { checkInventory };
}
