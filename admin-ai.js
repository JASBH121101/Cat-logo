const $ = selector => document.querySelector(selector);

function safeText(value, max = 180) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function catalogContext(products) {
  const rows = Array.isArray(products) ? products : [];
  return rows.filter(item => item && !["trash", "deleting"].includes(item.workflow_status)).slice(0, 80).map(item => ({
    id: safeText(item.id, 80),
    name: safeText(item.name, 140),
    brand: safeText(item.brand, 80),
    catalog_type: item.catalog_type === "perfumery" ? "perfumery" : "technology",
    price_usd: item.price_usd == null ? null : Number(item.price_usd),
    price_nio: item.price_nio == null ? null : Number(item.price_nio),
    variants: Array.isArray(item.variants) ? item.variants.slice(0, 12).map(variant => ({
      ram: safeText(variant.ram, 30),
      storage: safeText(variant.storage || variant.capacity, 30),
      color: safeText(variant.color, 40),
      price_usd: variant.price_usd == null ? null : Number(variant.price_usd),
      price_nio: variant.price_nio == null ? null : Number(variant.price_nio)
    })) : []
  }));
}

export function initJbManagerAI({ getSupabase, getCurrentUser, getProducts }) {
  const page = $(".jb-manager-ai-page");
  const launcher = $("#jb-ai-floating-launcher");
  const form = $("#jb-ai-form");
  const input = $("#jb-ai-input");
  const messages = $("#jb-ai-messages");
  const send = $("#jb-ai-send");
  const voice = $("#jb-ai-voice");
  const status = $("#jb-ai-status");
  const clear = $("#jb-ai-clear");
  if (!page || !launcher || !form || !input || !messages) return null;

  let authenticatedUser = null;
  let busy = false;
  let recognition = null;
  let listening = false;
  let nativeVoiceActive = false;
  let nativeVoiceListenersReady = false;
  let nativeVoiceListeners = [];

  function setStatus(text, error = false) {
    status.textContent = text;
    status.classList.toggle("is-error", error);
  }

  function appendMessage(role, text, meta = null) {
    const article = document.createElement("article");
    article.className = "jb-manager-ai-message " + (role === "user" ? "is-user" : "is-assistant");
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    article.append(paragraph);
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
      if (meta.missing_fields?.length) {
        const missing = document.createElement("small");
        missing.className = "jb-manager-ai-missing";
        missing.textContent = "Datos pendientes: " + meta.missing_fields.join(", ");
        article.append(missing);
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

  function speak(text) {
    if (!("speechSynthesis" in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 500));
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
    setBusy(true);
    setStatus("JB Copilot está procesando tu solicitud…");
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data?.session?.access_token) throw new Error("Tu sesión expiró. Iniciá sesión nuevamente.");
      const response = await fetch("/api/jb-manager-ai", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + data.session.access_token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message,
          products: catalogContext(getProducts())
        })
      });
      let payload;
      try { payload = await response.json(); } catch { payload = {}; }
      if (!response.ok) {
        const errors = {
          gemini_not_configured: "Falta configurar GEMINI_API_KEY en Cloudflare Pages.",
          gemini_quota_exhausted: "Gemini alcanzó su cuota disponible. Podés intentarlo más tarde.",
          admin_only: "Tu usuario no tiene permisos de administrador.",
          authentication_required: "La sesión no es válida. Iniciá sesión nuevamente.",
          rate_limit_exceeded: "Se alcanzó el límite temporal de consultas. Esperá un minuto."
        };
        throw new Error(errors[payload.error] || "No se pudo consultar Gemini (" + response.status + ").");
      }
      const assistant = payload.assistant || {};
      appendMessage("assistant", assistant.message || "No pude interpretar la solicitud.", assistant);
      setStatus("Respuesta lista. No se realizó ningún cambio en el catálogo.");
      speak(assistant.message || "");
    } catch (error) {
      appendMessage("assistant", error?.message || "Ocurrió un error al procesar la solicitud.");
      setStatus("No se pudo completar la consulta.", true);
    } finally {
      setBusy(false);
      input.focus();
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
    });
    const final = await native.addListener("result", event => {
      const transcript = safeText(event?.transcript, 3000);
      if (transcript) input.value = transcript;
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
    const current = await native.checkPermission();
    let permission = current;
    if (!current?.granted) {
      setStatus("Android solicitará permiso para usar el micrófono…");
      permission = await native.requestPermission();
    }
    if (!permission?.granted) {
      setStatus(permission?.permanentlyDenied
        ? "El permiso del micrófono está bloqueado. Abrí Información de la aplicación → Permisos → Micrófono y habilitalo."
        : "No se concedió el permiso del micrófono. Podés volver a tocar el botón para solicitarlo nuevamente.", true);
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

  form.addEventListener("submit", event => {
    event.preventDefault();
    void sendMessage(input.value);
  });
  voice.addEventListener("click", startVoice);
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
    }
  };
}
