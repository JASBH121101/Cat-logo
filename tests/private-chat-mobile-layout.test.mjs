import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import test, { after } from "node:test";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const adminSource = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
const workflowCss = readFileSync(new URL("../admin-workflow.css", import.meta.url), "utf8");

test("variant editor defines readable field and label colors for both themes", () => {
  assert.ok(workflowCss.includes('html[data-theme="dark"] body.admin-body form#product-form .variant-config-fields input'));
  assert.ok(workflowCss.includes('html[data-theme="dark"] body.admin-body form#product-form .variant-config-fields label'));
  assert.ok(workflowCss.includes('html[data-theme="light"] body.admin-body form#product-form .variant-config-fields input'));
  assert.match(workflowCss, /color:#b5c6e5!important/);
  assert.match(workflowCss, /color:#f3f6ff!important/);
});

function sourceBetween(startMarker, endMarker) {
  const start = adminSource.indexOf(startMarker);
  const end = adminSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "expected admin.js source region: " + startMarker);
  return adminSource.slice(start, end);
}

const selectedConversationSource = sourceBetween(
  "function privateChatSelectedConversation()",
  "function privateChatSetStatus(message"
);
const renderSelectedSource = sourceBetween(
  "function privateChatRenderSelected()",
  "async function loadPrivateChatMessages("
);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const server = createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  const filename = resolve(root, "." + pathname);
  if (!filename.startsWith(root + sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  readFile(filename, (error, bytes) => {
    if (error) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filename).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(bytes);
  });
});

await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(0, "127.0.0.1", resolveListen);
});
const address = server.address();
assert.ok(address && typeof address === "object");
const origin = "http://127.0.0.1:" + address.port;

after(async () => {
  await new Promise(resolveClose => server.close(resolveClose));
});

test("mobile admin inbox hides the empty thread and keeps long history internally scrollable in both themes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 740 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true
    });

    // The test exercises real CSS/DOM geometry, not Supabase authentication.
    // Block scripts so the test data is deterministic and no network secrets are needed.
    await page.route("**/*", route => {
      if (route.request().resourceType() === "script") return route.abort();
      return route.continue();
    });
    await page.goto(origin + "/admin.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() =>
      [...document.styleSheets].some(sheet =>
        sheet.href?.includes("admin-private-chat.css") && sheet.cssRules?.length > 0
      )
    );

    await page.evaluate(() => {
      document.body.classList.add("admin-dashboard-active");
      document.querySelector(".login-panel")?.remove();
      const dashboard = document.getElementById("dashboard");
      dashboard?.classList.remove("hidden");
      if (dashboard) {
        dashboard.hidden = false;
        dashboard.classList.add("admin-section-focused");
      }

      document.querySelectorAll("[data-admin-panel]").forEach(panel => panel.classList.add("hidden"));
      const section = document.getElementById("admin-section-messages");
      section?.classList.remove("hidden");
      if (section) section.hidden = false;
    });

    const compactHeader = await page.evaluate(() => {
      const dashboard = document.getElementById("dashboard");
      const top = dashboard?.querySelector(".dashboard-top");
      const greeting = top?.querySelector(":scope > div:first-child");
      const context = top?.querySelector(".admin-catalog-context");
      const sectionHeading = document.querySelector(".private-chat-admin-heading");
      const description = sectionHeading?.querySelector(":scope > div > p:not(.eyebrow)");
      const inbox = document.querySelector(".private-chat-admin-inbox");
      const status = document.getElementById("admin-status");
      return {
        greetingDisplay: greeting ? getComputedStyle(greeting).display : "missing",
        contextHeight: context?.getBoundingClientRect().height ?? -1,
        dashboardTopHeight: top?.getBoundingClientRect().height ?? -1,
        descriptionDisplay: description ? getComputedStyle(description).display : "missing",
        adminStatusDisplay: status ? getComputedStyle(status).display : "missing",
        gapAfterHeading: inbox && sectionHeading
          ? inbox.getBoundingClientRect().top - sectionHeading.getBoundingClientRect().bottom
          : -1
      };
    });
    assert.equal(compactHeader.greetingDisplay, "none",
      "non-dashboard admin sections should not keep the large welcome block");
    assert.ok(compactHeader.contextHeight > 0 && compactHeader.contextHeight < 90,
      "catalog selector should collapse to a compact context bar: " + JSON.stringify(compactHeader));
    assert.ok(compactHeader.dashboardTopHeight < 100,
      "compact context row should not reserve the old dashboard header height");
    assert.equal(compactHeader.descriptionDisplay, "none",
      "long messaging intro should be hidden on mobile to keep the inbox above the fold");
    assert.equal(compactHeader.adminStatusDisplay, "none",
      "stale global success messages should not consume space on a focused panel");
    assert.ok(compactHeader.gapAfterHeading >= 0 && compactHeader.gapAfterHeading < 80,
      "inbox should follow the compact header without a large blank spacer: " + JSON.stringify(compactHeader));

    await page.evaluate(() => {
      const form = document.getElementById("product-form");
      if (!form) return;
      const fixture = document.createElement("details");
      fixture.id = "dark-theme-color-fixture";
      fixture.className = "variant-admin-row inline-color-card inline-color-card-collapse";
      fixture.innerHTML = `
        <summary class="inline-color-card-summary">
          <span class="inline-color-card-summary-copy"><strong>Grafito</strong><small>Estado: Disponible</small></span>
          <span class="inline-color-card-chevron" aria-hidden="true">⌄</span>
        </summary>
        <div class="inline-color-card-body">
          <details class="inline-color-details" open>
            <summary>Disponibilidad y fotografías</summary>
            <div class="variant-color-fields">
              <label>Disponibilidad
                <select><option>Disponible</option></select>
              </label>
            </div>
            <div class="variant-color-library-tools">
              <label>Buscar color <input type="search" value="Grafito"></label>
            </div>
          </details>
        </div>`;
      form.append(fixture);
    });
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    const darkColorSurfaces = await page.evaluate(() => {
      const card = document.querySelector("#dark-theme-color-fixture");
      const inner = card?.querySelector(".inline-color-details");
      const fields = card?.querySelector(".variant-color-fields select");
      const library = card?.querySelector(".variant-color-library-tools");
      const label = card?.querySelector(".variant-color-fields label");
      return {
        cardBackground: card ? getComputedStyle(card).backgroundColor : "missing",
        innerBackground: inner ? getComputedStyle(inner).backgroundColor : "missing",
        selectBackground: fields ? getComputedStyle(fields).backgroundColor : "missing",
        selectColor: fields ? getComputedStyle(fields).color : "missing",
        libraryBackground: library ? getComputedStyle(library).backgroundColor : "missing",
        labelColor: label ? getComputedStyle(label).color : "missing"
      };
    });
    assert.notEqual(darkColorSurfaces.cardBackground, "rgb(255, 255, 255)",
      "compact color card must not remain white in dark mode");
    assert.notEqual(darkColorSurfaces.innerBackground, "rgb(255, 255, 255)",
      "nested availability/photo panel must honor dark mode");
    assert.notEqual(darkColorSurfaces.selectBackground, "rgb(255, 255, 255)",
      "availability controls must honor dark mode");
    assert.notEqual(darkColorSurfaces.libraryBackground, "rgb(255, 255, 255)",
      "color library panel must honor dark mode");
    assert.notEqual(darkColorSurfaces.selectColor, "rgb(0, 0, 0)",
      "dark mode control text must remain legible");
    assert.notEqual(darkColorSurfaces.labelColor, "rgb(0, 0, 0)",
      "dark mode labels must remain legible");

    // Run the actual selection renderer from admin.js with deterministic DOM
    // state and mocked network helpers; this verifies the JavaScript/CSS contract.
    await page.evaluate(() => {
      window.privateChatConversations = [];
      window.privateChatSelectedId = "";
      window.currentUser = { id: "test-admin" };
      window.privateChatSelectedPanel = document.getElementById("private-chat-admin-selected");
      window.privateChatEmptyPanel = null;
      window.privateChatThreadEl = document.getElementById("private-chat-admin-thread");
      window.privateChatLayoutEl = document.querySelector(".private-chat-admin-layout");
      window.privateChatReplyForm = document.getElementById("private-chat-admin-reply-form");
      window.privateChatRenderMessages = () => {};
      window.privateChatSetStatus = () => {};
      window.privateChatStatusLabel = status => status;
      window.privateChatRouteLabel = route => route || "Sin elegir";
      window.privateChatTopicLabel = topic => topic || "Consulta";
      window.privateChatDate = () => "12:00";
    });
    await page.addScriptTag({ content: selectedConversationSource + "\n" + renderSelectedSource });
    await page.evaluate(() => window.privateChatRenderSelected());

    const emptyThread = await page.locator("#private-chat-admin-thread").evaluate(element => ({
      hidden: element.hidden,
      display: getComputedStyle(element).display,
      height: element.getBoundingClientRect().height
    }));
    assert.equal(emptyThread.hidden, true);
    assert.equal(emptyThread.display, "none");
    assert.equal(emptyThread.height, 0, "unselected thread must not reserve blank vertical space");

    await page.evaluate(() => {
      window.privateChatConversations = [{
        id: "test-conversation",
        status: "advisor_active",
        claimed_by: "test-admin",
        contact_route: "support",
        consent_choice: "yes",
        catalog_type: "technology",
        payment_topic: "product",
        created_at: "2026-10-28T12:00:00Z",
        product_name: "Producto de prueba",
        product_url: "https://jb-collections.pages.dev/",
        product_id: null,
        purchase_confirmed_at: null
      }];
      window.privateChatSelectedId = "test-conversation";
      window.privateChatRenderSelected();

      const messages = document.getElementById("private-chat-admin-messages");
      messages.innerHTML = Array.from({ length: 45 }, (_, index) =>
        '<article class="private-chat-admin-message is-customer"><p>Mensaje de prueba ' +
        (index + 1) + ': historial largo para comprobar desplazamiento interno.</p></article>'
      ).join("");
    });

    for (const theme of ["dark", "light"]) {
      await page.evaluate(value => {
        document.documentElement.setAttribute("data-theme", value);
        const messages = document.getElementById("private-chat-admin-messages");
        // The production stylesheet enables smooth scrolling; disable animation in
        // this geometry assertion so scrollTop is measurable synchronously.
        messages.style.scrollBehavior = "auto";
        messages.scrollTop = messages.scrollHeight;
      }, theme);

      const layout = await page.evaluate(() => {
        const thread = document.getElementById("private-chat-admin-thread");
        const messages = document.getElementById("private-chat-admin-messages");
        const rect = thread.getBoundingClientRect();
        return {
          viewportHeight: window.innerHeight,
          threadHeight: rect.height,
          threadWidth: rect.width,
          viewportWidth: window.innerWidth,
          messagesClientHeight: messages.clientHeight,
          messagesScrollHeight: messages.scrollHeight,
          messagesScrollTop: messages.scrollTop,
          overflowY: getComputedStyle(messages).overflowY,
          display: getComputedStyle(thread).display
        };
      });

      assert.equal(layout.display, "flex", theme + ": selected conversation should be visible");
      assert.ok(layout.threadHeight > 0, theme + ": thread should have a measurable height");
      assert.ok(layout.threadHeight < layout.viewportHeight,
        theme + ": conversation panel should not grow taller than the mobile viewport");
      assert.ok(layout.threadWidth <= layout.viewportWidth,
        theme + ": conversation panel should fit the viewport width");
      assert.ok(["auto", "scroll"].includes(layout.overflowY),
        theme + ": message history must use internal vertical scrolling");
      assert.ok(layout.messagesClientHeight > 0);
      assert.ok(layout.messagesScrollHeight > layout.messagesClientHeight,
        theme + ": long history must overflow inside its message list");
      assert.ok(layout.messagesScrollTop > 0,
        theme + ": message list should actually scroll independently: " + JSON.stringify(layout));
    }
  } finally {
    await browser.close();
  }
});
