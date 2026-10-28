import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import test, { after } from "node:test";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
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
      if (dashboard) dashboard.hidden = false;

      document.querySelectorAll("[data-admin-panel]").forEach(panel => panel.classList.add("hidden"));
      const section = document.getElementById("admin-section-messages");
      section?.classList.remove("hidden");
      if (section) section.hidden = false;
    });

    const emptyThread = await page.locator("#private-chat-admin-thread").evaluate(element => ({
      hidden: element.hidden,
      display: getComputedStyle(element).display,
      height: element.getBoundingClientRect().height
    }));
    assert.equal(emptyThread.hidden, true);
    assert.equal(emptyThread.display, "none");
    assert.equal(emptyThread.height, 0, "unselected thread must not reserve blank vertical space");

    await page.evaluate(() => {
      const layout = document.querySelector(".private-chat-admin-layout");
      const thread = document.getElementById("private-chat-admin-thread");
      const selected = document.getElementById("private-chat-admin-selected");
      const messages = document.getElementById("private-chat-admin-messages");

      layout.classList.add("has-selection");
      thread.hidden = false;
      selected.hidden = false;
      selected.style.display = "";
      messages.innerHTML = Array.from({ length: 45 }, (_, index) =>
        '<article class="private-chat-admin-message is-customer"><p>Mensaje de prueba ' +
        (index + 1) + ': historial largo para comprobar desplazamiento interno.</p></article>'
      ).join("");
    });

    for (const theme of ["dark", "light"]) {
      await page.evaluate(value => {
        document.documentElement.setAttribute("data-theme", value);
        const messages = document.getElementById("private-chat-admin-messages");
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
        theme + ": message list should actually scroll independently");
    }
  } finally {
    await browser.close();
  }
});
