import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const auditScript = new URL("./dependency-audit.py", import.meta.url);

function makeFixture(withBrokenReference = false) {
  const root = mkdtempSync(join(tmpdir(), "dependency-audit-"));
  mkdirSync(join(root, "assets"), { recursive: true });
  mkdirSync(join(root, "api"), { recursive: true });
  mkdirSync(join(root, "functions", "api"), { recursive: true });
  writeFileSync(join(root, "index.html"), [
    "<!doctype html>",
    '<html><head><link rel="stylesheet" href="assets/site.css"></head>',
    '<body><script src="assets/main.js"></script><script type="module" src="assets/module.mjs"></script></body></html>'
  ].join("\n"));
  writeFileSync(join(root, "assets/site.css"), "body { color: black; }");
  writeFileSync(join(root, "assets/main.js"), [
    'import { helper } from "./helper.js";',
    "function neverCalledHere() { return 42; }",
    "function calledHere() { return helper(); }",
    "calledHere();",
    withBrokenReference ? 'import "./missing-module.js";' : ""
  ].join("\n"));
  writeFileSync(join(root, "assets/helper.js"), "export function helper() { return 1; }");
  writeFileSync(join(root, "assets/module.mjs"), [
    'const WORKER_URL = "../jb-manager-sw.js?v=1";',
    "const workerUrl = new URL(WORKER_URL, window.location.href);",
    "navigator.serviceWorker.register(workerUrl.href);"
  ].join("\n"));
  writeFileSync(join(root, "jb-manager-sw.js"), 'self.addEventListener("push", () => {});');
  writeFileSync(join(root, "api", "share.js"), "module.exports = async function handler(req, res) { return res.end('ok'); };");
  writeFileSync(join(root, "functions", "api", "share.js"), "export async function onRequest() { return new Response('ok'); }");
  writeFileSync(join(root, "assets/orphan.js"), "function orphanOnly() { return 0; }");
  return root;
}

function runAudit(root) {
  const result = spawnSync("python", [auditScript.pathname, "--root", root, "--json"], {
    encoding: "utf8"
  });
  assert.ok(!result.error, result.error?.message);
  return { status: result.status, data: JSON.parse(result.stdout), stderr: result.stderr };
}

test("dependency audit maps HTML/CSS/JS links and identifies unreachable files and dead-code candidates", () => {
  const root = makeFixture();
  try {
    const { status, data } = runAudit(root);
    assert.equal(status, 0, "valid dependency graph should pass");
    assert.ok(data.edges.some(edge => edge.source === "index.html" && edge.target === "assets/main.js"));
    assert.ok(data.edges.some(edge => edge.source === "index.html" && edge.target === "assets/site.css"));
    assert.ok(data.edges.some(edge => edge.source === "assets/main.js" && edge.target === "assets/helper.js"));
    assert.ok(data.edges.some(edge => edge.source === "index.html" && edge.target === "assets/module.mjs"));
    assert.ok(data.edges.some(edge => edge.source === "assets/module.mjs" && edge.target === "jb-manager-sw.js"));
    assert.ok(data.entry_points.includes("api/share.js"), "serverless api/ handlers must be treated as entry points");
    assert.ok(data.entry_points.includes("functions/api/share.js"), "Cloudflare Functions must be treated as entry points");
    assert.ok(!data.orphaned_js.includes("api/share.js"), "routed serverless handlers are not unreachable application files");
    assert.ok(!data.orphaned_js.includes("functions/api/share.js"), "routed Cloudflare handlers are not unreachable application files");
    assert.ok(!data.orphaned_js.includes("jb-manager-sw.js"), "registered service workers are reachable runtime dependencies");
    assert.ok(data.orphaned_js.includes("assets/orphan.js"));
    assert.ok(data.dead_symbols.some(item => item.name === "neverCalledHere"));
    assert.ok(!data.dead_symbols.some(item => item.name === "handler" && item.file === "api/share.js"));
    assert.ok(!data.dead_symbols.some(item => item.name === "onRequest" && item.file === "functions/api/share.js"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dependency audit fails on a broken explicit local JavaScript import", () => {
  const root = makeFixture(true);
  try {
    const { status, data } = runAudit(root);
    assert.equal(status, 1, "broken local import should fail the audit");
    assert.ok(data.issues.some(issue => issue.reference === "./missing-module.js"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
