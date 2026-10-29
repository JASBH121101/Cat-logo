import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const test = (file, moduleMode = false) => ({
  file,
  args: [...(moduleMode ? ["--experimental-default-type=module"] : []), "--test", file],
});

export const regressionGroups = [
  { name: "core-and-design", tests: [
    test("tests/cache-key-change-guard.test.mjs"), test("tests/dependency-audit.test.mjs"),
    test("tests/migration-history-hygiene.test.mjs"), test("tests/ai-assistant-layout.test.mjs"),
    test("tests/catalog-specifications-format.test.mjs"), test("tests/public-commercial-readiness.test.mjs"),
    test("tests/conversion-trust.test.mjs"), test("tests/design-authenticity-audit.test.mjs"),
    test("tests/design-quality-audit.test.mjs"), test("tests/limited-edition-sections.test.mjs"),
    test("tests/product-tag-formatting.test.mjs"), test("tests/asset-cache-contract.test.mjs"),
  ]},
  { name: "admin-and-catalog", tests: [
    test("tests/admin-notifications.test.mjs"), test("tests/admin-panel-quality-audit.test.mjs"),
    test("tests/admin-save-regression.test.mjs"), test("tests/admin-product-form-workflow.test.mjs"),
    test("tests/admin-color-assistant.test.mjs"), test("tests/admin-mobile-menu-stability.test.mjs"),
    test("tests/admin-provider-price-sync.test.mjs"), test("tests/provider-review-variants.test.mjs"),
    test("tests/perfume-card-layout.test.mjs"), test("tests/commercial-description-layout.test.mjs"),
    test("tests/technology-subcategory-filter.test.mjs"),
  ]},
  { name: "private-chat-and-contact", tests: [
    test("tests/private-chat-mobile-layout.test.mjs"), test("tests/private-chat-state-behavior.test.mjs"),
    test("tests/catalog-contact-channels.test.mjs"), test("tests/private-chat-workflow.test.mjs"),
    test("tests/private-chat-resume.test.mjs"),
  ]},
  { name: "cross-page-visual-audit", tests: [
    test("tests/visual-audit-policy.test.mjs"), test("tests/visual-design-quality-policy.test.mjs"),
    test("tests/visual-state-quality-policy.test.mjs"), test("tests/visual-audit.test.mjs"),
  ] },
  { name: "cloudflare-and-browser", tests: [
    test("tests/cloudflare-share.test.mjs", true), test("tests/cloudflare-download.test.mjs", true),
    test("tests/cloudflare-private-chat-push.test.mjs", true), test("tests/web-push.test.mjs", true),
    test("tests/cloudflare-assistant.test.mjs", true), test("tests/cloudflare-color-assistant.test.mjs", true),
    test("tests/technology-gallery-layout.test.mjs", true),
  ]},
];

const concurrency = Math.min(regressionGroups.length, Math.max(2,
  Number.parseInt(process.env.TEST_GROUP_CONCURRENCY || "4", 10) || 4));
const results = [];
let nextGroup = 0;

function runTest(groupName, item) {
  const started = performance.now();
  return new Promise(resolve => {
    const child = spawn(process.execPath, item.args, {
      cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    const limit = 2_000_000;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { if (stdout.length < limit) stdout += chunk; });
    child.stderr.on("data", chunk => { if (stderr.length < limit) stderr += chunk; });
    child.on("error", error => resolve({
      group: groupName, file: item.file, ok: false,
      ms: Math.round(performance.now() - started), output: `Unable to start test process: ${error.message}`,
    }));
    child.on("close", (code, signal) => resolve({
      group: groupName, file: item.file, ok: code === 0,
      ms: Math.round(performance.now() - started), code, signal,
      output: [stdout.trim(), stderr.trim()].filter(Boolean).join("\n"),
    }));
  });
}

async function runGroup(group) {
  console.log(`\n[GROUP START] ${group.name} — ${group.tests.length} files`);
  for (const item of group.tests) {
    const result = await runTest(group.name, item);
    results.push(result);
    console.log(`[${result.ok ? "PASS" : "FAIL"}] ${result.file} (${(result.ms / 1000).toFixed(2)}s)`);
    if (!result.ok) console.error(result.output || `Exit code: ${result.code ?? "unknown"}; signal: ${result.signal ?? "none"}`);
    else if (result.file === "tests/visual-audit.test.mjs" && result.output) {
      const diagnostics = result.output.split(/\r?\n/).filter(line =>
        /VISUAL AUDIT:|JOURNEY (?:PASS|FAIL)|\[(?:CRITICAL|HIGH)\]/.test(line)
      );
      if (diagnostics.length) console.log(diagnostics.join("\n"));
    } else if (process.env.VERBOSE_TESTS === "1" && result.output) console.log(result.output);
  }
  console.log(`[GROUP END] ${group.name}`);
}

const startedAt = performance.now();
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (nextGroup < regressionGroups.length) {
    const group = regressionGroups[nextGroup++];
    await runGroup(group);
  }
}));

const failures = results.filter(result => !result.ok);
console.log("\n=== REGRESSION AUDIT SUMMARY ===");
console.log(`Files: ${results.length}; passed: ${results.length - failures.length}; failed: ${failures.length}; worker groups: ${concurrency}; wall time: ${((performance.now() - startedAt) / 1000).toFixed(2)}s`);
for (const result of results) console.log(`- ${result.ok ? "PASS" : "FAIL"} | ${result.group} | ${result.file} | ${(result.ms / 1000).toFixed(2)}s`);
if (failures.length) {
  console.error("\nFailing test files:");
  for (const failure of failures) console.error(`- ${failure.file}`);
  process.exitCode = 1;
} else console.log("All regression groups passed. No tests were skipped.");
