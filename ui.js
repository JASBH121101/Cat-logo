(() => {
  "use strict";

  const THEME_KEY = "ct-catalog-theme";
  const DARK = "dark";
  const LIGHT = "light";

  const SECTION_HASHES = new Set([
    "#catalogo",
    "#entregas",
    "#contacto"
  ]);

  const MOBILE_QUERY = window.matchMedia("(max-width: 760px)");

  function readSavedTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return saved === LIGHT || saved === DARK ? saved : DARK;
    } catch {
      return DARK;
    }
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // El tema sigue funcionando aunque no se pueda guardar.
    }
  }

  function applyTheme(theme) {
    const normalized = theme === LIGHT ? LIGHT : DARK;

    document.documentElement.dataset.theme = normalized;

    const button = document.querySelector("[data-theme-toggle]");
    if (!button) return;

    const icon = button.querySelector(".theme-toggle-icon");
    const label = button.querySelector(".theme-toggle-label");

    if (normalized === DARK) {
      if (icon) icon.textContent = "☀";
      if (label) label.textContent = "Claro";

      button.setAttribute("aria-label", "Cambiar al tema claro");
      button.setAttribute("title", "Cambiar al tema claro");
      button.setAttribute("aria-pressed", "true");
    } else {
      if (icon) icon.textContent = "☾";
      if (label) label.textContent = "Oscuro";

      button.setAttribute("aria-label", "Cambiar al tema oscuro");
      button.setAttribute("title", "Cambiar al tema oscuro");
      button.setAttribute("aria-pressed", "false");
    }
  }

  /*
   * Elimina solamente los fragmentos de navegación interna.
   * No modifica los enlaces de producto #producto=...
   */
  function cleanSectionHash() {
    if (!SECTION_HASHES.has(window.location.hash)) return;

    try {
      window.history.replaceState(
        window.history.state,
        document.title,
        window.location.pathname + window.location.search
      );
    } catch (error) {
      console.warn("No se pudo limpiar el fragmento de navegación.", error);
    }
  }

  function createThemeButton() {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "theme-toggle";
    button.setAttribute("data-theme-toggle", "");

    button.innerHTML = `
      <span class="theme-toggle-icon" aria-hidden="true">☀</span>
      <span class="theme-toggle-label">Claro</span>
    `;

    button.addEventListener("click", () => {
      const current = document.documentElement.dataset.theme || DARK;
      const next = current === DARK ? LIGHT : DARK;

      applyTheme(next);
      saveTheme(next);
    });

    return button;
  }

  function createBackToTopButton() {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "back-to-top";
    button.setAttribute("data-back-to-top", "");
    button.setAttribute("aria-label", "Volver arriba");
    button.setAttribute("title", "Volver arriba");
    button.textContent = "↑";

    button.addEventListener("click", () => {
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;

      window.scrollTo({
        top: 0,
        behavior: reduceMotion ? "auto" : "smooth"
      });
    });

    document.body.appendChild(button);

    function updateVisibility() {
      button.classList.toggle(
        "is-visible",
        window.scrollY > 350
      );
    }

    window.addEventListener(
      "scroll",
      updateVisibility,
      { passive: true }
    );

    updateVisibility();
  }

  /*
   * Menú desplegable móvil.
   *
   * En móvil los botones de categoría se mueven al menú.
   * En escritorio vuelven a su posición original.
   * Los botones conservan su atributo data-category y
   * siguen siendo compatibles con el listener de app.js.
   */
  function initializeMobileCategories() {
    document.querySelectorAll("#category-filters, #audience-filters").forEach(filterRow => {
      const buttons = Array.from(filterRow.querySelectorAll(".filter-chip[data-category], .filter-chip[data-audience]"));
      if (!buttons.length) return;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "mobile-category-toggle";
      toggle.setAttribute("aria-expanded", "false");
      const label = document.createElement("span");
      label.className = "category-toggle-label";
      const arrow = document.createElement("span");
      arrow.className = "category-toggle-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "⌄";
      toggle.append(label, arrow);
      const menu = document.createElement("div");
      menu.className = "mobile-category-menu";
      menu.id = "mobile-" + (filterRow.id || "filter") + "-menu";
      toggle.setAttribute("aria-controls", menu.id);
      filterRow.append(toggle, menu);
      const groupTitle = filterRow.dataset.mobileFilterLabel || "Categorías";
      function updateLabel() {
        const active = buttons.filter(button => button.classList.contains("active"));
        const all = active.find(button => button.dataset.category === "all" || button.dataset.audience === "all");
        const names = all ? [all.textContent.trim()] : active.map(button => button.textContent.trim());
        label.textContent = "☰ " + groupTitle + ": " + (names.length ? names.join(" + ") : "Todos");
      }
      function closeMenu() {
        menu.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      }
      function syncLayout() {
        if (MOBILE_QUERY.matches) {
          buttons.forEach(button => menu.appendChild(button));
        } else {
          buttons.forEach(button => filterRow.insertBefore(button, toggle));
          closeMenu();
        }
        updateLabel();
      }
      toggle.addEventListener("click", () => {
        if (menu.classList.contains("is-open")) closeMenu();
        else {
          menu.classList.add("is-open");
          toggle.setAttribute("aria-expanded", "true");
        }
      });
      menu.addEventListener("click", event => {
        if (event.target.closest(".filter-chip[data-category], .filter-chip[data-audience]")) {
          // Close after every choice. Shoppers can reopen the menu to add more filters.
          closeMenu();
          window.setTimeout(updateLabel, 0);
        }
      });
      document.addEventListener("click", event => {
        if (!filterRow.contains(event.target)) closeMenu();
      });
      document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeMenu();
      });
      if (typeof MOBILE_QUERY.addEventListener === "function") MOBILE_QUERY.addEventListener("change", syncLayout);
      else MOBILE_QUERY.addListener(syncLayout);
      syncLayout();
    });
  }

  /*
   * Evita añadir #catalogo, #entregas o #contacto al pulsar
   * enlaces internos, manteniendo el desplazamiento a la sección.
   */
  function handleSectionNavigation(event) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const origin = event.target;

    if (!(origin instanceof Element)) return;

    const link = origin.closest('a[href^="#"]');
    if (!link) return;

    const rawHash = link.getAttribute("href");

    if (!rawHash || rawHash === "#") return;

    let targetId;

    try {
      targetId = decodeURIComponent(rawHash.slice(1));
    } catch {
      targetId = rawHash.slice(1);
    }

    const target = document.getElementById(targetId);
    if (!target) return;

    event.preventDefault();

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    target.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start"
    });

    cleanSectionHash();
  }

  function initializeUI() {
    // Limpia un fragmento de sección si la página se abrió con uno.
    cleanSectionHash();

    // Aplica el tema recordado.
    const initialTheme = readSavedTheme();
    applyTheme(initialTheme);

    // Añade el control de tema al encabezado existente.
    const header = document.querySelector(".site-header");

    if (
      header &&
      !header.querySelector("[data-theme-toggle]")
    ) {
      const themeButton = createThemeButton();
      const nav = header.querySelector(".header-nav");
      const backLink = header.querySelector(".back-link");

      /* Mantener el selector como hijo directo del encabezado en móvil. */
      if (nav) {
        header.insertBefore(themeButton, nav);
      } else if (backLink) {
        header.insertBefore(themeButton, backLink);
      } else {
        header.appendChild(themeButton);
      }
    }

    // Sincroniza icono y texto del control.
    applyTheme(initialTheme);

    // El panel de administración no necesita el botón flotante "Volver arriba".
    // Se conserva en los catálogos públicos y demás páginas del sitio.
    if (!document.body.classList.contains("admin-body") &&
        !document.querySelector("[data-back-to-top]")) {
      createBackToTopButton();
    } else if (document.body.classList.contains("admin-body")) {
      document.querySelectorAll("[data-back-to-top]").forEach(button => button.remove());
    }

    // Prepara los filtros adaptables.
    initializeMobileCategories();

    // Controla los enlaces internos sin mostrar el fragmento en la URL.
    document.addEventListener(
      "click",
      handleSectionNavigation
    );

    // Sincroniza el tema si se cambia desde otra pestaña del sitio.
    window.addEventListener("storage", event => {
      if (event.key !== THEME_KEY) return;

      const next = event.newValue === LIGHT ? LIGHT : DARK;
      applyTheme(next);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initializeUI,
      { once: true }
    );
  } else {
    initializeUI();
  }
})();