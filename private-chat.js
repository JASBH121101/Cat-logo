const config = window.CATALOG_CONFIG || {};
const apiBase = String(config.publicCatalogUrl || "https://jb-collections.pages.dev").replace(/\/+$/, "");
const API_URL = apiBase + "/api/private-chat";
const SESSION_KEY = "jb-private-chat-session-token-v1";
const PRIVACY_NOTICE_VERSION = "2026-10-28-v1";
const $ = selector => document.querySelector(selector);

const loading = $("#private-chat-loading");
const errorPanel = $("#private-chat-error");
const appPanel = $("#private-chat-app");
const productLabel = $("#private-chat-product");
const choicePanel = $("#private-chat-choice-panel");
const consentPanel = $("#private-chat-consent-panel");
const declinePanel = $("#private-chat-decline-panel");
const countdownLabel = $("#private-chat-delete-countdown");
const threadPanel = $("#private-chat-thread");
const messagesPanel = $("#private-chat-messages");
const composer = $("#private-chat-composer");
const input = $("#private-chat-input");
const sendButton = $("#private-chat-send");
const statusLine = $("#private-chat-status");

const themeToggle = $("#private-chat-theme-toggle");
function applyPrivateChatTheme(theme) {
  const selected = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = selected;
  if (themeToggle) {
    const nextTheme = selected === "dark" ? "light" : "dark";
    themeToggle.textContent = selected === "dark" ? "☀" : "☾";
    themeToggle.setAttribute("aria-label", selected === "dark" ? "Cambiar al tema claro" : "Cambiar al tema oscuro");
    themeToggle.setAttribute("title", selected === "dark" ? "Cambiar al tema claro" : "Cambiar al tema oscuro");
    themeToggle.setAttribute("aria-pressed", String(selected === "dark"));
    themeToggle.dataset.nextTheme = nextTheme;
  }
  try { localStorage.setItem("ct-catalog-theme", selected); } catch {}
}
function initializePrivateChatTheme() {
  let selected = "light";
  try {
    const saved = localStorage.getItem("ct-catalog-theme");
    if (saved === "light" || saved === "dark") selected = saved;
  } catch {}
  applyPrivateChatTheme(selected);
  themeToggle?.addEventListener("click", () => applyPrivateChatTheme(themeToggle.dataset.nextTheme));
}

let sessionToken = "";
let conversation = null;
let lastMessagesSignature = "";
let refreshInProgress = false;
let sending = false;
let expired = false;
let countdownTimer = null;
let activeCountdownExpiry = 0;

function showFatal(message) {
  expired = true;
  loading.hidden = true;
  appPanel.hidden = true;
  errorPanel.hidden = false;
  errorPanel.textContent = message;
  sessionStorage.removeItem(SESSION_KEY);
  if (countdownTimer) clearInterval(countdownTimer);
}
function updateStatus(message, kind = "") {
  statusLine.textContent = message || "";
  statusLine.className = "private-chat-status" + (kind ? " is-" + kind : "");
}
async function api(action, payload = {}) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    credentials: "omit",
    body: JSON.stringify({ action, ...payload })
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok || data.ok === false) {
    const error = new Error(String(data.message || "No pudimos completar la solicitud."));
    error.code = String(data.error || "");
    error.status = response.status;
    throw error;
  }
  return data;
}
function niceTime(value) {
  try {
    return new Intl.DateTimeFormat("es-NI", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "";
  }
}
function renderMessages(items) {
  const list = Array.isArray(items) ? items : [];
  const signature = list.map(item => item.id + ":" + item.sender_type + ":" + item.content).join("|");
  if (signature === lastMessagesSignature) return;
  const thread = threadPanel;
  const wasNearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 90;
  lastMessagesSignature = signature;
  messagesPanel.replaceChildren();
  for (const item of list) {
    // The consent panel is the single source of the purchase notice.
    // Older conversations may still contain a duplicated database message.
    if (item.sender_type === "assistant" &&
        /^Antes de continuar con una compra:/i.test(String(item.content || ""))) continue;
    const bubble = document.createElement("article");
    const sender = String(item.sender_type || "assistant");
    bubble.className = "private-chat-message " +
      (sender === "customer" ? "is-customer" : sender === "advisor" ? "is-advisor" : "is-assistant");
    const text = document.createElement("p");
    text.textContent = String(item.content || "");
    const meta = document.createElement("time");
    meta.dateTime = String(item.created_at || "");
    meta.textContent = (sender === "customer" ? "Vos" : sender === "advisor" ? "Asesor JB Collections" : "JB Collections") +
      (item.created_at ? " · " + niceTime(item.created_at) : "");
    bubble.append(text, meta);
    messagesPanel.appendChild(bubble);
  }
  if (wasNearBottom || list.length <= 1) thread.scrollTop = thread.scrollHeight;
}
function startDeleteCountdown(value) {
  const endTime = new Date(value || Date.now() + 10 * 60_000).getTime();
  if (countdownTimer && activeCountdownExpiry === endTime) return;
  if (countdownTimer) clearInterval(countdownTimer);
  activeCountdownExpiry = endTime;
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    const minutesLeft = Math.floor(seconds / 60);
    const secondsLeft = seconds % 60;
    countdownLabel.textContent = seconds > 0
      ? "Este chat se cerrará y eliminará en " + minutesLeft + ":" + String(secondsLeft).padStart(2, "0") + ". Podés cambiar de opinión antes de que termine el tiempo."
      : "El plazo para cambiar de opinión terminó. Esta sesión ya no está disponible.";
    if (seconds <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      activeCountdownExpiry = 0;
      sessionStorage.removeItem(SESSION_KEY);
      expired = true;
      $("#private-chat-change-mind").disabled = true;
      updateStatus("El acceso expiró. Podés iniciar otra conversación desde el catálogo.");
    }
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}
function renderConversationState() {
  if (!conversation) return;
  const status = String(conversation.status || "");
  const route = String(conversation.contact_route || "");
  const consent = conversation.consent_choice;
  productLabel.textContent = conversation.product_name && conversation.product_name !== "Consulta general"
    ? "Consulta sobre: " + conversation.product_name
    : "Atención de JB Collections";

  const routeNotChosen = !route && status === "pending_consent";
  const isWaitingConsent = route === "buy" && consent == null && status === "pending_consent";
  const isDeclined = status === "declined_pending_delete";
  const isClosed = status === "closed";
  const canSend = !isClosed &&
    ["pending_advisor", "advisor_active"].includes(status) &&
    (route === "support" || (route === "buy" && consent === "yes"));

  choicePanel.hidden = !routeNotChosen;
  consentPanel.hidden = !isWaitingConsent;
  declinePanel.hidden = !isDeclined;
  threadPanel.hidden = routeNotChosen;
  composer.hidden = !canSend;
  if (countdownTimer && !isDeclined) {
    clearInterval(countdownTimer);
    countdownTimer = null;
    activeCountdownExpiry = 0;
  }
  if (isDeclined) startDeleteCountdown(conversation.delete_after);
  if (isClosed) {
    composer.hidden = true;
    updateStatus("La conversación fue cerrada. Podés volver al catálogo para iniciar otra.");
  } else if (isWaitingConsent) {
    updateStatus("Leé la información antes de decidir. Tu elección no te obliga a comprar.");
  } else if (isDeclined) {
    updateStatus("No enviaremos recordatorios comerciales.");
  } else if (status === "pending_advisor") {
    updateStatus("Tu solicitud quedó registrada. El asesor te responderá personalmente por este chat.");
  } else if (status === "advisor_active") {
    updateStatus("Estás conectado con el equipo de JB Collections.");
  }
}
async function refreshConversation() {
  if (refreshInProgress || expired || !sessionToken) return;
  refreshInProgress = true;
  try {
    const statusResult = await api("status", { sessionToken });
    conversation = statusResult.conversation || conversation;
    renderConversationState();
    const messagesResult = await api("messages", { sessionToken });
    renderMessages(messagesResult.messages);
  } catch (error) {
    if (error.code === "personal_data_not_allowed") {
      updateStatus(error.message, "error");
    } else if (error.code === "session_expired" || error.status === 410) {
      showFatal(error.message || "El enlace o la sesión de este chat ya venció.");
    } else {
      updateStatus(error.message || "No pudimos actualizar la conversación. Volvé a intentarlo.", "error");
    }
  } finally {
    refreshInProgress = false;
  }
}
async function submitRoute(route) {
  try {
    $("#private-chat-support-choice").disabled = true;
    $("#private-chat-buy-choice").disabled = true;
    await api("route", { sessionToken, route });
    await refreshConversation();
  } catch (error) {
    updateStatus(error.message, "error");
  } finally {
    $("#private-chat-support-choice").disabled = false;
    $("#private-chat-buy-choice").disabled = false;
  }
}
async function submitConsent(choice) {
  try {
    $("#private-chat-consent-yes").disabled = true;
    $("#private-chat-consent-no").disabled = true;
    const result = await api("consent", { sessionToken, choice, noticeVersion: PRIVACY_NOTICE_VERSION });
    if (choice === "yes" && countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    await refreshConversation();
    if (result.result?.delete_after) conversation.delete_after = result.result.delete_after;
  } catch (error) {
    updateStatus(error.message, "error");
  } finally {
    $("#private-chat-consent-yes").disabled = false;
    $("#private-chat-consent-no").disabled = false;
  }
}
async function submitMessage(event) {
  event.preventDefault();
  if (sending || expired) return;
  const content = String(input.value || "").trim();
  if (!content) return;
  sending = true;
  sendButton.disabled = true;
  try {
    await api("send", { sessionToken, content });
    input.value = "";
    input.style.height = "auto";
    updateStatus("");
    await refreshConversation();
    input.focus();
  } catch (error) {
    updateStatus(error.message, "error");
  } finally {
    sending = false;
    sendButton.disabled = false;
  }
}
async function initialize() {
  loading.hidden = false;
  errorPanel.hidden = true;
  const query = new URLSearchParams(window.location.search);
  const inviteToken = String(query.get("invite") || "");
  try {
    if (inviteToken) {
      const result = await api("redeem", { inviteToken });
      sessionToken = String(result.sessionToken || "");
      if (!sessionToken) throw new Error("No pudimos activar este enlace.");
      sessionStorage.setItem(SESSION_KEY, sessionToken);
      conversation = result.conversation || null;
      window.history.replaceState({}, document.title, "/mensajes.html");
    } else {
      sessionToken = sessionStorage.getItem(SESSION_KEY) || "";
    }
    if (!sessionToken) {
      showFatal("No encontramos un enlace de acceso activo. Volvé al catálogo y elegí «Contactar JB Collections» para iniciar una conversación.");
      return;
    }
    appPanel.hidden = false;
    loading.hidden = true;
    await refreshConversation();
  } catch (error) {
    showFatal(error.message || "Este enlace ya venció o no es válido. Iniciá otra conversación desde el catálogo.");
  }
}

$("#private-chat-support-choice").addEventListener("click", () => void submitRoute("support"));
$("#private-chat-buy-choice").addEventListener("click", () => void submitRoute("buy"));
$("#private-chat-consent-yes").addEventListener("click", () => void submitConsent("yes"));
$("#private-chat-consent-no").addEventListener("click", () => void submitConsent("no"));
$("#private-chat-change-mind").addEventListener("click", () => void submitConsent("yes"));
composer.addEventListener("submit", event => void submitMessage(event));
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 112) + "px";
});
initializePrivateChatTheme();\nvoid initialize();
setInterval(() => { if (sessionToken && !expired) void refreshConversation(); }, 6500);
