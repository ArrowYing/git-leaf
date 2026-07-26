import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("usage analytics spec is the sole metric, privacy, and storage contract", async () => {
  const [spec, agents, architecture, release, summary] = await Promise.all([
    readFile("docs/app-usage-analytics-spec.md", "utf8"),
    readFile("AGENTS.md", "utf8"),
    readFile("docs/architecture.md", "utf8"),
    readFile("docs/release.md", "utf8"),
    readFile("scripts/summarize-telemetry.mjs", "utf8"),
  ]);

  assert.match(spec, /status: normative/);
  assert.match(spec, /This contract does not define a user behavior funnel/);
  assert.match(spec, /## Event catalog/);
  assert.match(spec, /## Relationships and consistency/);
  assert.match(spec, /## Metric dictionary/);
  assert.match(spec, /## Standard daily report/);
  assert.match(spec, /## Prohibited inferences/);
  assert.match(spec, /## Collection, privacy, and storage/);
  assert.match(spec, /JSONL\/JSONL\.GZ[\s\S]*is the only source of truth/);
  assert.match(spec, /without a user setting or device-name setting/);
  assert.match(spec, /Raw JSONL\/JSONL\.GZ is retained for 12 months/);
  assert.match(spec, /repo_local_key = HMAC-SHA256/);
  assert.match(spec, /These completeness rules apply from App `1\.10\.0`/);
  assert.match(spec, /`summary_id` equals[\s\S]*SHA256\(install_id \+ ":" \+ summary_date\)/);
  assert.match(spec, /Explicit `summary_date` cannot be later than envelope `local_date`/);
  assert.match(spec, /`daily_summary_explicit_date` is a schema-v1 capability/);
  assert.match(spec, /Query changes from empty to nonempty/);
  assert.match(spec, /at most once per five minutes per renderer session/);
  assert.match(spec, /check_started[\s\S]*current_exact[\s\S]*feed_behind[\s\S]*failed_check/);
  assert.match(spec, /Do not put legacy data, `current_other`, or failures at[\s\S]*into the denominator/);
  assert.match(spec, /launch_count = sum\(launch_counts_by_entry_kind\)/);
  assert.match(spec, /active_minutes = preview_minutes \+ source_minutes \+ live_minutes/);
  assert.match(spec, /Other valid summaries[\s\S]*produce a `partial_quality` result/);
  assert.match(spec, /completed_without_prior_lifecycle/);
  assert.match(spec, /All seven use deduplicated state groups/);
  assert.match(spec, /`not_configured`[\s\S]*`missing`[\s\S]*`empty`[\s\S]*`present`/);
  assert.match(spec, /Download request → successful install[\s\S]*Not computable/);
  assert.match(
    agents,
    /sole source of truth[\s\S]*`docs\/app-usage-analytics-spec\.md`/,
  );
  assert.match(architecture, /Usage analytics[\s\S]*app-usage-analytics-spec/);
  assert.match(
    release,
    /privacy requirements, storage, and retention rules are defined only by `docs\/app-usage-analytics-spec\.md`/,
  );
  assert.match(summary, /docs\/app-usage-analytics-spec\.md/);
});

test("Deep Link failure reasons stay aligned across the normative telemetry contract", async () => {
  const sources = await Promise.all([
    readFile("docs/app-usage-analytics-spec.md", "utf8"),
    readFile("public/telemetry.js", "utf8"),
    readFile("scripts/gitleaf-update-server.py", "utf8"),
    readFile("scripts/summarize-telemetry.mjs", "utf8"),
  ]);
  const reasons = [
    "repository_not_known",
    "worktree_not_found",
    "repository_selection_invalid",
    "repository_identity_mismatch",
    "repository_open_failed",
    "main_worktree_check_failed",
    "main_worktree_unavailable",
    "primary_not_main",
    "fetch_failed",
    "revision_missing",
    "main_ahead",
    "main_diverged",
    "sync_failed",
    "safe_update_failed",
    "document_open_failed",
    "unknown",
  ];

  for (const source of sources) {
    for (const reason of reasons) assert.match(source, new RegExp(`\\b${reason}\\b`));
  }
  assert.match(sources[0], /`success` or `cancel` carrying the dimension is an[\s\S]*invalid contract/);
  assert.match(sources[3], /failure_reason: "legacy_unknown"/);
});
