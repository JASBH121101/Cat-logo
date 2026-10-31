const $ = selector => document.querySelector(selector);

function safeText(value, max = 180) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function formatCopilotText(value) {
  return String(value ?? "")
    .replace(/\bproduct_draft\b/gi, "borrador de producto")
    .replace(/\bmissing_fields\b/gi, "datos pendientes")
    .replace(/\bintent\b/gi, "tipo de solicitud");
}

function appendInlineFormatting(target, text) {
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|\x60[^\x60]+\x60)/g;
  let cursor = 0;
  for (const match of String(text).matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > cursor) target.append(document.createTextNode(text.slice(cursor, index)));
    let node;
    if (token.startsWith("**")) {
      node = document.createElement("strong");
      node.textContent = token.slice(2, -2);
    } else if (token.startsWith("*")) {
      node = document.createElement("em");
      node.textContent = token.slice(1, -1);
    } else {
      node = document.createElement("code");
      node.textContent = token.slice(1, -1);
    }
    target.append(node);
    cursor = index + token.length;
  }
  if (cursor < text.length) target.append(document.createTextNode(text.slice(cursor)));
}

function appendFormattedAssistantText(container, value) {
  const lines = String(value ?? "").replace(/\r/g, "").split("\n");
  let list = null;
  let inserted = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      list = null;
      continue;
    }
    const bullet = line.match(/^[-•]\s+(.+)$/);
    if (bullet) {
      if (!list) {
        list = document.createElement("ul");
        container.append(list);
      }
      const item = document.createElement("li");
      appendInlineFormatting(item, bullet[1]);
      list.append(item);
      inserted = true;
      continue;
    }
    list = null;
    const paragraph = document.createElement("p");
    appendInlineFormatting(paragraph, line);
    container.append(paragraph);
    inserted = true;
  }
  if (!inserted) {
    const paragraph = document.createElement("p");
    paragraph.textContent = String(value ?? "");
    container.append(paragraph);
  }
}

function catalogContext(products) {
  const rows = Array.isArray(products) ? products : [];
  return rows.filter(item => item && !["trash", "deleting"].includes(item.workflow_status)).slice(0, 80).map(item => ({
    id: safeText(item.id, 80),
    name: safeText(item.name, 140),
    brand: safeText(item.brand, 80),
    model: safeText(item.model, 100),
    category: safeText(item.category, 80),
    subcategory: safeText(item.subcategory, 80),
    description: safeText(item.description, 180),
    specifications: safeText(typeof item.specifications === "string" ? item.specifications : JSON.stringify(item.specifications || {}), 420),
    perfume_details: item.perfume_details ? {
      family: safeText(item.perfume_details.family, 40),
      concentration: safeText(item.perfume_details.concentration, 50),
      volume_ml: item.perfume_details.volume_ml == null ? null : Number(item.perfume_details.volume_ml),
      audience: safeText(item.perfume_details.audience, 30)
    } : null,
    catalog_type: item.catalog_type === "perfumery" ? "perfumery" : "technology",
    price_usd: item.price_usd == null ? null : Number(item.price_usd),
    price_nio: item.price_nio == null ? null : Number(item.price_nio),
    variants: Array.isArray(item.variants) ? item.variants.slice(0, 8).map(variant => ({
      ram: safeText(variant.ram, 30),
      storage: safeText(variant.storage || variant.capacity, 30),
      color: safeText(variant.color, 40),
      price_usd: variant.price_usd == null ? null : Number(variant.price_usd),
      price_nio: variant.price_nio == null ? null : Number(variant.price_nio)
    })) : []
  }));
}

export function initJbManagerAI({ getSupabase, getCurrentUser, getProducts, onPrepareProductDraft }) {
  const page = $(".jb-manager-ai-page");
  const launcher = $("#jb-ai-floating-launcher");
  const form = $("#jb-ai-form");
  const input = $("#jb-ai-input");
  const messages = $("#jb-ai-messages");
  const send = $("#jb-ai-send");
  const voice = $("#jb-ai-voice");
  const speechToggle = $("#jb-ai-speech-toggle");
  const status = $("#jb-ai-status");
  const clear = $("#jb-ai-clear");
  if (!page || !launcher || !form || !input || !messages) return null;

  let authenticatedUser = null;
  let busy = false;
  let recognition = null;
  let listening = false;
  let speechEnabled = false;
  let nativeVoiceActive = false;
  let nativeVoiceListenersReady = false;
  let nativeVoiceListeners = [];
  let voiceSettingsAction = null;

  function clearVoiceSettingsAction() {
    voiceSettingsAction?.remove();
    voiceSettingsAction = null;
  }

  function setStatus(text, error = false) {
    clearVoiceSettingsAction();
    status.textContent = text;
    status.classList.toggle("is-error", error);
  }

  function showVoiceSettingsAction(native) {
    if (!native || typeof native.openAppSettings !== "function") return;
    clearVoiceSettingsAction();
    const action = document.createElement("button");
    action.type = "button";
    action.className = "jb-ai-permission-settings";
    action.textContent = "Abrir permisos del micrófono";
    action.addEventListener("click", async () => {
      action.disabled = true;
      try {
        await native.openAppSettings();
        setStatus("Se abrieron los ajustes de JB Manager. Activá Micrófono y regresá a la app.");
      } catch (error) {
        action.disabled = false;
        setStatus(error?.message || "No se pudieron abrir los ajustes de la aplicación.", true);
        showVoiceSettingsAction(native);
      }
    });
    status.append(" ", action);
    voiceSettingsAction = action;
  }

  function withTimeout(promise, timeoutMs, message) {
    let timer = null;
    const timeout = new Promise((resolve, reject) => {
      timer = window.setTimeout(() => {
        const error = new Error(message);
        error.code = "VOICE_PERMISSION_TIMEOUT";
        reject(error);
      }, timeoutMs);
    });
    return Promise.race([Promise.resolve(promise), timeout])
      .finally(() => window.clearTimeout(timer));
  }

  function withRequestDeadline(promise, timeoutMs, message) {
    let timer = null;
    const timeout = new Promise((resolve, reject) => {
      timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([Promise.resolve(promise), timeout])
      .finally(() => window.clearTimeout(timer));
  }

  function resizeInput() {
    if (!input) return;
    input.style.height = "auto";
    const viewportHeight = window.visualViewport?.height || window.innerHeight || 700;
    const maxHeight = Math.min(176, Math.max(112, Math.round(viewportHeight * 0.24)));
    const nextHeight = Math.min(input.scrollHeight, maxHeight);
    input.style.height = nextHeight + "px";
    input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  function appendMessage(role, text, meta = null) {
    const article = document.createElement("article");
    article.className = "jb-manager-ai-message " + (role === "user" ? "is-user" : "is-assistant");
    if (role === "assistant") {
      appendFormattedAssistantText(article, formatCopilotText(text));
    } else {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      article.append(paragraph);
    }
    if (meta && meta.intent === "add_product" && meta.product_draft &&
        typeof meta.product_draft === "object" && String(meta.product_draft.name || "").trim()) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "jb-ai-prefill-action";
      action.textContent = "✦ Rellenar formulario";
      action.addEventListener("click", async () => {
        if (typeof onPrepareProductDraft !== "function") {
          setStatus("No se pudo abrir el formulario de producto desde Copilot.", true);
          return;
        }
        action.disabled = true;
        action.textContent = "Preparando formulario…";
        try {
          const prepared = await onPrepareProductDraft(meta.product_draft);
          if (prepared) {
            action.textContent = "✓ Formulario preparado";
            action.classList.add("is-complete");
          } else {
            action.disabled = false;
            action.textContent = "✦ Rellenar formulario";
          }
        } catch (error) {
          action.disabled = false;
          action.textContent = "✦ Rellenar formulario";
          setStatus(error?.message || "No se pudo preparar el formulario.", true);
        }
      });
      article.append(action);
      const safetyNote = document.createElement("small");
      safetyNote.className = "jb-ai-prefill-note";
      safetyNote.textContent = "Solo completa el formulario; no guarda, publica ni añade fotografías.";
      article.append(safetyNote);
    }
    if (meta && meta.intent && meta.intent !== "question" && meta.intent !== "unknown") {
      const tag = document.createElement("small");
      tag.className = "jb-manager-ai-intent";
      const labels = {
        search_product: "CONSULTA DE CATÁLOGO",
        provider_price_update: "PROPUESTA · PRECIO DE PROVEEDOR",
        add_product: "ASISTENTE DE ALTA DE PRODUCTO"
      };
      tag.textContent = labels[meta.intent] || "PROPUESTA";
      article.append(tag);
      if (Array.isArray(meta.missing_fields) && meta.missing_fields.length) {
        const labels = {"product_query":"Producto o modelo","product":"Producto","model":"Modelo","model_name":"Modelo","brand":"Marca","catalog_type":"Catálogo (tecnología o perfumería)","category":"Categoría","variant":"Configuración o variante","configuration":"Configuración (RAM y almacenamiento)","ram":"Memoria RAM","storage":"Almacenamiento","color":"Color","currency":"Moneda","price":"Precio del proveedor","provider_price":"Precio del proveedor","provider_price_usd":"Precio del proveedor (USD)","provider_price_nio":"Precio del proveedor (C$)","price_usd":"Precio de venta (USD)","price_nio":"Precio de venta (C$)","audience":"Público (masculino, femenino o unisex)","volume":"Volumen (ml)","volume_ml":"Volumen (ml)","concentration":"Concentración (EDP, EDT, Parfum)","sku":"Código o referencia","availability":"Disponibilidad","name":"Nombre del producto","description":"Descripción comercial","specs":"Especificaciones","specifications":"Especificaciones","subcategory":"Subcategoría","warranty_months":"Garantía (meses)","variants":"Configuraciones y variantes","family":"Familia de perfume","scent_family":"Familia olfativa","top_notes":"Notas de salida","heart_notes":"Notas de corazón","base_notes":"Notas de fondo"};
        const displayFields = [...new Set(meta.missing_fields
          .map(value => String(value ?? "").trim())
          .filter(Boolean)
          .map(value => {
            const key = value.toLowerCase().trim().replace(/[\\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
            return labels[key] || value.replace(/[_-]+/g, " ").replace(/\\b\\w/g, letter => letter.toUpperCase());
          }))];
        if (displayFields.length) {
          const missing = document.createElement("div");
          missing.className = "jb-manager-ai-missing";
          const title = document.createElement("strong");
          title.textContent = "Para continuar necesito:";
          const list = document.createElement("span");
          list.textContent = displayFields.join(" · ");
          missing.append(title, list);
          article.append(missing);
        }
      }
      if (meta.intent === "provider_price_update") {
        const prices = [];
        if (Number.isFinite(meta.provider_price_usd)) prices.push("US$ " + meta.provider_price_usd.toFixed(2));
        if (Number.isFinite(meta.provider_price_nio)) prices.push("C$ " + meta.provider_price_nio.toFixed(2));
        if (prices.length) {
          const price = document.createElement("strong");
          price.className = "jb-manager-ai-proposed-price";
          price.textContent = "Precio detectado: " + prices.join(" · ");
          article.append(price);
        }
      }
    }
    messages.append(article);
    messages.scrollTop = messages.scrollHeight;
    return article;
  }

  function setBusy(value) {
    busy = value;
    send.disabled = value;
    input.disabled = value;
    form.classList.toggle("is-busy", value);
  }

  function updateSpeechToggle() {
    if (!speechToggle) return;
    speechToggle.classList.toggle("is-enabled", speechEnabled);
    speechToggle.setAttribute("aria-pressed", speechEnabled ? "true" : "false");
    speechToggle.setAttribute("aria-label", speechEnabled ? "Desactivar respuestas por voz" : "Activar respuestas por voz");
    speechToggle.title = speechEnabled ? "Desactivar respuestas por voz" : "Activar respuestas por voz";
    speechToggle.textContent = speechEnabled ? "🔊" : "🔇";
  }

  function setSpeechEnabled(enabled) {
    speechEnabled = Boolean(enabled) && ("speechSynthesis" in window) &&
      typeof window.SpeechSynthesisUtterance === "function";
    if (!speechEnabled) window.speechSynthesis?.cancel?.();
    updateSpeechToggle();
    if (speechEnabled) setStatus("Modo de voz activado. Las próximas respuestas se leerán en voz alta; podés apagarlo cuando quieras.");
    else setStatus("Modo de voz apagado. JB Copilot responderá solo por texto.");
  }

  function speak(text) {
    if (!speechEnabled || document.hidden || !("speechSynthesis" in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new window.SpeechSynthesisUtterance(text.slice(0, 700));
      utterance.lang = "es-NI";
      utterance.rate = 1.02;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
    } catch {}
  }

  async function sendMessage(text) {
    const message = safeText(text, 3000);
    if (!message || busy) return;
    const supabase = getSupabase();
    if (!authenticatedUser || !supabase) {
      setStatus("Iniciá sesión como administrador para usar el copiloto.", true);
      return;
    }
    appendMessage("user", message);
    input.value = "";
    resizeInput();
    setBusy(true);
    setStatus("JB Copilot está procesando tu solicitud…");
    let requestController = null;
    let requestTimer = null;
    let requestTimedOut = false;
    try {
      const { data, error } = await withRequestDeadline(
        supabase.auth.getSession(),
        12000,
        "No se pudo recuperar la sesión a tiempo. Revisá tu conexión e intentá nuevamente."
      );
      if (error || !data?.session?.access_token) throw new Error("Tu sesión expiró. Iniciá sesión nuevamente.");
      requestController = new AbortController();
      requestTimer = window.setTimeout(() => {
        requestTimedOut = true;
        requestController?.abort();
      }, 45000);
      const response = await fetch("https://jb-collections.pages.dev/api/jb-manager-ai", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + data.session.access_token,
          "Content-Type": "application/json"
        },
        signal: requestController.signal,
        body: JSON.stringify({
          message,
          products: catalogContext(getProducts())
        })
      });
      let payload;
      try { payload = await response.json(); } catch { payload = {}; }
      if (!response.ok) {
        const errors = {
          gemini_not_configured: "El servicio de Gemini todavía no está configurado en Cloudflare. La consulta no se procesó.",
          gemini_billing_required: "El proyecto de Google AI Studio necesita una cuenta de facturación activa para usar Gemini. Revisá la facturación del proyecto asociado a la clave.",
          gemini_api_access_denied: "Google rechazó el acceso a Gemini. Revisá que la clave siga activa, no esté bloqueada y que Gemini API esté habilitada en el proyecto.",
          gemini_model_unavailable: "El modelo Gemini configurado no está disponible para este proyecto. La consulta no se procesó.",
          gemini_invalid_request: "Gemini rechazó el formato de la solicitud. El diagnóstico ya identificó el tipo de error; no se modificó el catálogo.",
          gemini_temporarily_unavailable: "Gemini está temporalmente indisponible. Esperá un momento y volvé a intentarlo.",
          gemini_quota_exhausted: "Gemini alcanzó su cuota disponible. Esperá un momento y volvé a intentarlo.",
          gemini_request_failed: "Gemini no pudo completar la consulta. Revisá el diagnóstico del servicio e intentá nuevamente.",
          gemini_invalid_response: "Gemini respondió con un formato que JB Copilot no pudo leer. Probá reformulando la instrucción.",
          gemini_unstructured_response: "La respuesta de Gemini no llegó en el formato esperado. No se hizo ningún cambio; podés repetir la consulta.",
          admin_verification_unavailable: "No se pudo verificar tu cuenta administradora con Supabase. Revisá tu conexión e intentá otra vez.",
          admin_only: "Tu usuario no tiene permisos de administrador.",
          authentication_required: "La sesión no es válida o expiró. Iniciá sesión nuevamente.",
          rate_limit_exceeded: "Se alcanzó el límite temporal de consultas. Esperá un minuto.",
          request_too_large: "La solicitud es demasiado extensa. Resumí la instrucción y volvé a enviarla.",
          origin_not_allowed: "La solicitud llegó desde un origen no autorizado. Abrí JB Manager desde su dirección oficial.",
          message_required: "Escribí una instrucción antes de enviarla."
        };
        const baseMessage = errors[payload.error] || "No se pudo completar la consulta (" + response.status + "). No se modificó el catálogo.";
        const diagnostic = typeof payload.detail === "string"
          ? payload.detail.replace(/[\x00-\x1F\x7F]/g, " ").slice(0, 320)
          : "";
        throw new Error(baseMessage + (diagnostic ? " Detalle de Google: " + diagnostic : ""));
      }
      const assistant = payload.assistant || {};
      appendMessage("assistant", assistant.message || "No pude interpretar la solicitud.", assistant);
      setStatus("Respuesta lista. No se realizó ningún cambio en el catálogo.");
      speak(assistant.message || "");
    } catch (error) {
      const messageError = requestTimedOut
        ? "La consulta tardó más de 45 segundos y se canceló para desbloquear JB Copilot. Podés volver a intentarlo."
        : error?.name === "AbortError"
          ? "La consulta se interrumpió antes de recibir respuesta. Podés volver a intentarlo."
          : error?.message || "Ocurrió un error al procesar la solicitud.";
      appendMessage("assistant", messageError);
      setStatus(messageError, true);
      if (!input.value.trim()) input.value = message;
    } finally {
      if (requestTimer) window.clearTimeout(requestTimer);
      setBusy(false);
      input.focus();
      resizeInput();
    }
  }

  function setVoiceListening(active) {
    listening = active;
    voice.classList.toggle("is-listening", active);
    voice.setAttribute("aria-label", active ? "Detener dictado" : "Dictar mensaje");
    voice.title = active ? "Detener dictado" : "Dictar mensaje";
  }

  function finishVoiceUI(message = "") {
    setVoiceListening(false);
    nativeVoiceActive = false;
    if (message) setStatus(message);
  }

  function nativeVoicePlugin() {
    const cap = window.Capacitor;
    return cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()
      ? cap.Plugins?.JbVoiceInput || null
      : null;
  }

  async function attachNativeVoiceListeners(native) {
    if (nativeVoiceListenersReady) return;
    const partial = await native.addListener("partialResult", event => {
      const transcript = safeText(event?.transcript, 3000);
      if (transcript) input.value = transcript;
      resizeInput();
    });
    const final = await native.addListener("result", event => {
      const transcript = safeText(event?.transcript, 3000);
      if (transcript) input.value = transcript;
      resizeInput();
      finishVoiceUI(input.value.trim()
        ? "Dictado listo. Revisá el texto y presioná enviar."
        : "No se reconocieron palabras. Podés volver a intentarlo.");
    });
    const failure = await native.addListener("recognitionError", event => {
      const messages = {
        audio: "No se pudo acceder al micrófono. Revisá los permisos de JB Manager.",
        network: "El servicio de reconocimiento de voz no pudo conectarse.",
        no_match: "No se reconocieron palabras. Acercate al micrófono y probá de nuevo.",
        busy: "El servicio de voz está ocupado. Intentá nuevamente.",
        unavailable: "No hay un servicio de reconocimiento de voz disponible en Android.",
        permission: "Android no concedió el acceso al micrófono."
      };
      finishVoiceUI(messages[event?.code] || "No se pudo reconocer la voz. Podés escribir el mensaje.");
      setStatus(messages[event?.code] || "No se pudo reconocer la voz. Podés escribir el mensaje.", true);
    });
    nativeVoiceListeners = [partial, final, failure].filter(Boolean);
    nativeVoiceListenersReady = true;
  }

  async function startNativeVoice(native) {
    let current;
    try {
      current = await withTimeout(
        native.checkPermission(),
        8000,
        "Android no respondió al consultar el permiso del micrófono."
      );
    } catch (error) {
      if (error?.code === "VOICE_PERMISSION_TIMEOUT") {
        setStatus("No se pudo consultar el permiso. Abrí los ajustes de JB Manager y habilitá Micrófono.", true);
        showVoiceSettingsAction(native);
        return;
      }
      throw error;
    }
    let permission = current;
    if (!current?.granted) {
      if (current?.permanentlyDenied) {
        setStatus("Android ya no muestra la solicitud del micrófono. Abrí los permisos de JB Manager y habilitá Micrófono.", true);
        showVoiceSettingsAction(native);
        return;
      }
      setStatus("Android solicitará permiso para usar el micrófono…");
      try {
        permission = await withTimeout(
          native.requestPermission(),
          12000,
          "Android no respondió a la solicitud del permiso del micrófono."
        );
      } catch (error) {
        if (error?.code === "VOICE_PERMISSION_TIMEOUT") {
          setStatus("No llegó la respuesta del permiso. Abrí los ajustes de JB Manager y habilitá Micrófono.", true);
          showVoiceSettingsAction(native);
          return;
        }
        throw error;
      }
    }
    if (!permission?.granted) {
      setStatus(permission?.permanentlyDenied
        ? "El permiso del micrófono está bloqueado. Habilitalo desde los ajustes de JB Manager."
        : "No se concedió el permiso del micrófono. Podés habilitarlo desde los ajustes de JB Manager.", true);
      showVoiceSettingsAction(native);
      return;
    }
    await attachNativeVoiceListeners(native);
    setVoiceListening(true);
    setStatus("Activando el reconocimiento de voz de Android…");
    try {
      const started = await native.startListening({ language: "es-NI" });
      if (started?.started === false) throw new Error(started.message || "Android no pudo iniciar el reconocimiento.");
      nativeVoiceActive = true;
      setStatus("Escuchando… El servicio de voz de Android puede procesar el audio según su configuración. JARVIS no recibirá el texto hasta que presionés Enviar.");
    } catch (error) {
      finishVoiceUI();
      throw error;
    }
  }

  function startBrowserVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatus("Este navegador no ofrece dictado por voz. En la APK se requiere el puente nativo actualizado; podés escribir el mensaje.", true);
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = "es-NI";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => {
      setVoiceListening(true);
      setStatus("Escuchando… El servicio de voz del dispositivo puede procesar el audio según su configuración. JARVIS no recibirá el texto hasta que presionés Enviar.");
    };
    recognition.onresult = event => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript || "";
      }
      if (transcript) input.value = transcript.trim();
      resizeInput();
    };
    recognition.onerror = event => {
      const reason = event.error === "not-allowed"
        ? "El navegador bloqueó el micrófono. Revisá los permisos de JB Manager en Android."
        : "No se pudo reconocer la voz. Podés escribir el mensaje.";
      setStatus(reason, true);
    };
    recognition.onend = () => {
      finishVoiceUI(input.value.trim()
        ? "Dictado listo. Revisá el texto y presioná enviar."
        : "");
    };
    try { recognition.start(); }
    catch (error) {
      finishVoiceUI();
      setStatus(error?.message || "No se pudo iniciar el micrófono.", true);
    }
  }

  async function startVoice() {
    if (listening) {
      if (nativeVoiceActive) {
        try { await nativeVoicePlugin()?.stopListening?.(); }
        catch { setStatus("No se pudo detener el dictado de voz.", true); }
      } else {
        try { recognition?.stop?.(); } catch {}
      }
      return;
    }
    const native = nativeVoicePlugin();
    if (native) {
      try {
        await startNativeVoice(native);
      } catch (error) {
        finishVoiceUI();
        const message = error?.message || "No se pudo iniciar el reconocimiento de voz de Android.";
        setStatus(message + " Podés escribir el mensaje.", true);
      }
      return;
    }
    startBrowserVoice();
  }

  input.addEventListener("input", resizeInput);
  // WebViews can restore a form while retaining a stale disabled DOM state.
  // Always recover the send controls when the Copilot module initializes.
  setBusy(false);
  resizeInput();

  form.addEventListener("submit", event => {
    event.preventDefault();
    void sendMessage(input.value);
  });
  voice.addEventListener("click", startVoice);
  if (speechToggle) {
    speechToggle.addEventListener("click", () => setSpeechEnabled(!speechEnabled));
    if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") {
      speechToggle.disabled = true;
      speechToggle.title = "La lectura por voz no está disponible en este navegador.";
    }
    updateSpeechToggle();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.speechSynthesis?.cancel?.();
      setSpeechEnabled(false);
    }
  });
  window.addEventListener("pagehide", () => {
    window.speechSynthesis?.cancel?.();
    setSpeechEnabled(false);
  });
  clear.addEventListener("click", () => {
    messages.replaceChildren();
    const welcome = document.createElement("article");
    welcome.className = "jb-manager-ai-message is-assistant";
    const p = document.createElement("p");
    p.textContent = "Nueva conversación. ¿Qué necesitás gestionar?";
    welcome.append(p);
    messages.append(welcome);
    setStatus("Conversación reiniciada. No se guardan transcripciones.");
    window.speechSynthesis?.cancel?.();
  });
  document.querySelectorAll("[data-jb-ai-prompt]").forEach(button => {
    button.addEventListener("click", () => {
      input.value = button.dataset.jbAiPrompt || "";
      resizeInput();
      input.focus();
    });
  });
  launcher.addEventListener("click", () => {
    document.querySelector('[data-admin-section="ai"]')?.click();
    input.focus();
  });

  return {
    setAuthenticatedUser(user) {
      authenticatedUser = user || null;
      launcher.hidden = !authenticatedUser;
    },
    clearSession() {
      authenticatedUser = null;
      setBusy(false);
      launcher.hidden = true;
      recognition?.abort?.();
      const nativeVoice = nativeVoicePlugin();
      if (nativeVoiceActive && nativeVoice && typeof nativeVoice.cancelListening === "function") {
        void Promise.resolve(nativeVoice.cancelListening()).catch(() => {});
      }
      nativeVoiceListeners.forEach(handle => handle?.remove?.());
      nativeVoiceListeners = [];
      nativeVoiceListenersReady = false;
      nativeVoiceActive = false;
      setVoiceListening(false);
      window.speechSynthesis?.cancel?.();
      speechEnabled = false;
      updateSpeechToggle();
    }
  };
}
