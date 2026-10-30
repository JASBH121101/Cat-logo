import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const productionAudit = readFileSync(new URL("./production-readonly-visual-audit.mjs", import.meta.url), "utf8");
const aiReview = readFileSync(new URL("./ai-visual-review.mjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/catalog-static-checks.yml", import.meta.url), "utf8");

test("production audit blocks all non-read HTTP methods before sending requests", () => {
  assert.match(productionAudit, /\["GET", "HEAD", "OPTIONS"\]\.includes\(request\.method\(\)\.toUpperCase\(\)\)/);
  assert.match(productionAudit, /blockedWrites\.push\(entry\)/);
  assert.match(productionAudit, /await route\.abort\("blockedbyclient"\)/);
  assert.match(productionAudit, /Non-GET\/HEAD\/OPTIONS requests are blocked to prevent analytics or controls from writing while the audit runs/);
});

test("production browser audit only targets public pages and has no authenticated admin actions", () => {
  assert.match(productionAudit, /https:\/\/jb-collections\.pages\.dev/);
  assert.match(productionAudit, /path: "\/tecnologia\/"/);
  assert.match(productionAudit, /path: "\/perfumeria\/"/);
  assert.doesNotMatch(productionAudit, /supabase\.from\(|createClient\(|signInWithPassword|\.insert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(productionAudit, /whatsapp\.click|private-chat-send|admin-login/);
});

test("live audit is opt-in and optional model credentials are not embedded in source", () => {
  assert.match(workflow, /audit_production:[\s\S]*?default: false/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.audit_production/);
  assert.match(workflow, /AI_REVIEW_ENABLED: \$\{\{ vars\.ENABLE_AI_VISUAL_REVIEW == 'true' && \(\(secrets\.CLOUDFLARE_API_TOKEN != '' && vars\.CLOUDFLARE_ACCOUNT_ID != ''\) \|\| secrets\.GEMINI_API_KEY != ''\) \}\}/);
  assert.match(workflow, /GEMINI_API_KEY: \$\{\{ secrets\.GEMINI_API_KEY \}\}/);
  assert.match(aiReview, /process\.env\.GEMINI_API_KEY/);
  assert.doesNotMatch(workflow, /OPENAI_API_KEY|OPENAI_VISION_MODEL/);
  assert.doesNotMatch(aiReview, /api\.openai\.com|process\.env\.OPENAI_API_KEY/);
  assert.match(aiReview, /process\.env\.CLOUDFLARE_API_TOKEN/);
  assert.match(aiReview, /process\.env\.CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(aiReview, /sk-[A-Za-z0-9]{20,}/);
});

test("model scores are advisory and never drive automatic production edits or visual CI failures", () => {
  assert.match(aiReview, /advisory multimodal visual critique/);
  assert.match(aiReview, /never auto-edit code/);
  assert.doesNotMatch(aiReview, /process\.exitCode\s*=\s*1/);
  assert.doesNotMatch(aiReview, /mcp__Supabase|supabase\.from\(|\.insert\(|\.update\(|\.delete\(/);
});
