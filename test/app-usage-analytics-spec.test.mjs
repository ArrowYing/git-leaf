import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("usage analytics spec is the sole metric, privacy, and storage contract", async () => {
  const [spec, agents, architecture, release, summary] = await Promise.all([
    readFile("docs/app-usage-analytics-spec.md", "utf8"),
    readFile("AGENTS.md", "utf8"),
    readFile("architecture.md", "utf8"),
    readFile("release.md", "utf8"),
    readFile("scripts/summarize-telemetry.mjs", "utf8"),
  ]);

  assert.match(spec, /status: normative/);
  assert.match(spec, /本文不建设用户行为漏斗/);
  assert.match(spec, /## 事件目录/);
  assert.match(spec, /## 事件关系与逻辑一致性/);
  assert.match(spec, /## 指标字典/);
  assert.match(spec, /## 标准日报格式/);
  assert.match(spec, /## 禁止推断/);
  assert.match(spec, /## 采集、隐私与存储边界/);
  assert.match(spec, /JSONL／JSONL\.GZ 是唯一事实源/);
  assert.match(spec, /不增加用户开关或设备名称配置/);
  assert.match(spec, /原始 JSONL／JSONL\.GZ 保留 12 个月/);
  assert.match(spec, /repo_local_key = HMAC-SHA256/);
  assert.match(spec, /从 App `1\.10\.0` 起执行上述完整性约束/);
  assert.match(spec, /`summary_id` 必须等于[\s\S]*SHA256\(install_id \+ ":" \+ summary_date\)/);
  assert.match(spec, /显式 `summary_date` 不得晚于顶层 `local_date`/);
  assert.match(spec, /`daily_summary_explicit_date` 是 schema v1 的兼容能力/);
  assert.match(spec, /文件筛选从空查询进入非空查询/);
  assert.match(spec, /同一 Renderer 会话最多每 5 分钟一次/);
  assert.match(spec, /check_started[\s\S]*current_exact[\s\S]*feed_behind[\s\S]*failed_check/);
  assert.match(spec, /不得把它、`current_other` 或其他阶段失败放进检查结果分母/);
  assert.match(spec, /launch_count = sum\(launch_counts_by_entry_kind\)/);
  assert.match(spec, /active_minutes = preview_minutes \+ source_minutes \+ live_minutes/);
  assert.match(spec, /通过检查的其他汇总仍按有效子集计算，并标记 `partial_quality`/);
  assert.match(spec, /completed_without_prior_lifecycle/);
  assert.match(spec, /所有七项关系都按去重状态组计数/);
  assert.match(spec, /`not_configured`[\s\S]*`missing`[\s\S]*`empty`[\s\S]*`present`/);
  assert.match(spec, /下载页请求 → 安装成功[\s\S]*不可计算/);
  assert.match(agents, /`docs\/app-usage-analytics-spec\.md` 为唯一口径/);
  assert.match(architecture, /完整事件口径、逻辑关系、隐私、传输、存储和保留边界见[\s\S]*app-usage-analytics-spec/);
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
  assert.match(sources[0], /`success`／`cancel` 携带该维度属于无效契约/);
  assert.match(sources[3], /failure_reason: "legacy_unknown"/);
});
