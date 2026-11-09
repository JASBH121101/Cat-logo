const TOKEN_KEY = "jb-supabase-r2-migration-cursor-v1";

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
  try { continuationToken = sessionStorage.getItem(TOKEN_KEY) || ""; } catch {}

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
      copied = 0;
      alreadyPresent = 0;
      failed = 0;
      conflicts = 0;
      bytesCopied = 0;
      processed = 0;
      renderSummary();
      const size = formatBytes(inventory.totalBytes);
      const message = inventory.objectCount + " objetos encontrados · " + size +
        " · " + inventory.invalidObjectCount + " rutas fuera del formato esperado.";
      writeLog(message);
      if (inventory.isTruncated) {
        setStatus("El inventario requiere paginación adicional. No iniciamos la copia.", "warning");
      } else if (inventory.invalidObjectCount > 0) {
        setStatus("Hay rutas que requieren revisión. No iniciamos la copia.", "warning");
      } else {
        setStatus("Conexión S3 correcta. Inventario listo; no se modificó ningún archivo.", "success");
        startButton.disabled = inventory.objectCount === 0;
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No se pudo verificar el origen.", "error");
      writeLog("Inventario detenido: " + (error instanceof Error ? error.message : "error desconocido"));
    } finally {
      inventoryButton.disabled = false;
    }
  }

  async function runMigration() {
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
        copied += Number(data.copied || 0);
        alreadyPresent += Number(data.alreadyPresent || 0);
        failed += Number(data.failed || 0);
        conflicts += Number(data.conflicts || 0);
        bytesCopied += Number(data.bytesCopied || 0);
        processed += Number(data.processed || 0);

        if (data.failed || data.conflicts) {
          // Keep the cursor at the beginning of the current batch so a retry
          // safely skips successful objects and retries only missing ones.
          continuationToken = tokenBeforeBatch;
          writeLog("Lote con incidencias: " + data.failed + " errores y " + data.conflicts + " conflictos.");
          setStatus("La copia se pausó para revisar incidencias. Los objetos originales siguen intactos.", "warning");
          break;
        }

        continuationToken = data.nextContinuationToken || "";
        try {
          if (continuationToken) sessionStorage.setItem(TOKEN_KEY, continuationToken);
          else sessionStorage.removeItem(TOKEN_KEY);
        } catch {}

        writeLog(data.copied + " copiados, " + data.alreadyPresent + " ya existentes; " + formatBytes(data.bytesCopied) + " en este lote.");
        renderSummary();

        if (!data.isTruncated) {
          continuationToken = "";
          try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
          setStatus("Migración terminada. Cada objeto copiado fue verificado por tamaño en R2. Supabase no se modificó.", "success");
          writeLog("Migración completada; no se borró ningún objeto del bucket de origen.");
          break;
        }
      }

      if (stopRequested) {
        try {
          if (continuationToken) sessionStorage.setItem(TOKEN_KEY, continuationToken);
          else sessionStorage.removeItem(TOKEN_KEY);
        } catch {}
        setStatus("Migración pausada entre lotes. Podés continuar desde este mismo dispositivo.", "info");
        writeLog("Pausa solicitada; el cursor de continuación quedó guardado en esta sesión.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "La migración se interrumpió.", "error");
      writeLog("Migración interrumpida; el origen permanece intacto.");
    } finally {
      running = false;
      stopRequested = false;
      inventoryButton.disabled = false;
      startButton.disabled = !inventory || !inventory.objectCount;
      startButton.textContent = "Continuar migración";
      renderSummary();
    }
  }

  inventoryButton.addEventListener("click", () => void checkInventory());
  startButton.addEventListener("click", () => void runMigration());
  renderSummary();
  return { checkInventory };
}
