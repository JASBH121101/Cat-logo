const TOKEN_KEY = "jb-supabase-r2-migration-cursor-v1";
const STATE_KEY = "jb-supabase-r2-migration-progress-v1";

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

export function initStorageMigration({ getClient, getCurrentUser }) {
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
