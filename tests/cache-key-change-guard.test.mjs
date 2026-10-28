import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const guard = fileURLToPath(new URL("./cache-key-change-guard.py", import.meta.url));

function command(binary, args, cwd) {
  const result = spawnSync(binary, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function git(args, cwd) {
  return command("git", args, cwd);
}

test("cache-key guard rejects changed CSS/JS with stale keys and accepts bumped keys", () => {
  const root = mkdtempSync(join(tmpdir(), "cache-key-guard-"));
  try {
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "index.html"), [
      '<link rel="stylesheet" href="assets/site.css?v=old1">',
      '<script src="assets/site.js?v=old1"></script>',
    ].join("\n"));
    writeFileSync(join(root, "assets/site.css"), "body { color: black; }\n");
    writeFileSync(join(root, "assets/site.js"), "globalThis.example = 1;\n");

    git(["init", "-b", "main"], root);
    git(["config", "user.name", "CI test"], root);
    git(["config", "user.email", "ci-test@example.invalid"], root);
    git(["add", "."], root);
    git(["commit", "-m", "base"], root);
    const base = git(["rev-parse", "HEAD"], root);

    writeFileSync(join(root, "assets/site.css"), "body { color: navy; }\n");
    writeFileSync(join(root, "assets/site.js"), "globalThis.example = 2;\n");
    git(["add", "."], root);
    git(["commit", "-m", "change assets without bumping cache"], root);
    const stale = git(["rev-parse", "HEAD"], root);

    const staleResult = spawnSync("python", [guard, base, stale], {
      cwd: root, encoding: "utf8"
    });
    assert.equal(staleResult.status, 1, staleResult.stdout + staleResult.stderr);
    assert.match(staleResult.stdout, /cache key stayed/);
    assert.match(staleResult.stdout, /site\.css/);
    assert.match(staleResult.stdout, /site\.js/);

    writeFileSync(join(root, "index.html"), [
      '<link rel="stylesheet" href="assets/site.css?v=new2">',
      '<script src="assets/site.js?v=new2"></script>',
    ].join("\n"));
    git(["add", "."], root);
    git(["commit", "-m", "bump browser asset cache keys"], root);
    const fixed = git(["rev-parse", "HEAD"], root);

    const fixedResult = spawnSync("python", [guard, base, fixed], {
      cwd: root, encoding: "utf8"
    });
    assert.equal(fixedResult.status, 0, fixedResult.stdout + fixedResult.stderr);
    assert.match(fixedResult.stdout, /Cache-key guard passed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
