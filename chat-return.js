(() => {
  "use strict";

  const SESSION_KEY = "jb-private-chat-session-token-v1";
  const config = window.CATALOG_CONFIG || {};
  const baseUrl = String(config.publicCatalogUrl || window.location.origin).replace(/\/+$/, "");
  const API_URL = baseUrl + "/api/private-chat";
  const CHAT_URL = baseUrl + "/mensajes.html";

  function readSavedToken() {
    try {
      const token = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || "";
      if (token) {
        // Keep both stores aligned so older same-tab navigation still works.
        try { sessionStorage.setItem(SESSION_KEY, token); } catch {}
      }
      return token;
    } catch {
      try { return sessionStorage.getItem(SESSION_KEY) || ""; } catch { return ""; }
    }
  }

  function clearSavedToken() {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  }

  async function tokenStillActive(token) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "omit",
        body: JSON.stringify({ action: "status", sessionToken: token })
      });
      let data = {};
      try { data = await response.json(); } catch {}
      const code = String(data.error || "");
      if (response.status === 410 || code === "session_expired" ||
          ["closed", "deleted", "expired"].includes(String(data.conversation?.status || ""))) {
        clearSavedToken();
        return false;
      }
      // A temporary network/server error should not remove an otherwise usable access token.
      return true;
    } catch {
      return true;
    }
  }

  function renderResumePanel() {
    if (document.getElementById("jb-chat-resume-panel")) return;
    const panel = document.createElement("aside");
    panel.id = "jb-chat-resume-panel";
    panel.setAttribute("aria-label", "Retomar conversación privada");
    panel.innerHTML =
      '<p><strong>¿Querés retomar tu chat?</strong>' +
      '<span class="jb-chat-resume-copy">Hay una conversación guardada temporalmente en este dispositivo.</span></p>' +
      '<a class="jb-chat-resume-link" href="' + CHAT_URL + '">Retomar chat</a>' +
      '<button class="jb-chat-resume-forget" type="button">Olvidar este dispositivo</button>';

    panel.querySelector(".jb-chat-resume-forget").addEventListener("click", () => {
      const confirmed = window.confirm(
        "Esto solo borra el acceso guardado en este dispositivo. No elimina la conversación del sistema y quizá no podás volver a abrirla desde aquí. ¿Querés continuar?"
      );
      if (!confirmed) return;
      clearSavedToken();
      panel.remove();
    });
    document.body.appendChild(panel);
  }

  async function initialize() {
    const token = readSavedToken();
    if (!token) return;
    if (await tokenStillActive(token)) renderResumePanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { void initialize(); }, { once: true });
  } else {
    void initialize();
  }
})();
