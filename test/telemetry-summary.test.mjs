import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  summarizeTelemetryFiles,
  telemetryReportMarkdown,
} from "../scripts/summarize-telemetry.mjs";

const execFileAsync = promisify(execFile);

test("summary script deduplicates retries and selects the latest daily revision", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-summary-"));
  const summaryV1 = dailyEvent({ eventId: "daily-1", revision: 1, activeMinutes: 4 });
  const summaryV2 = dailyEvent({ eventId: "daily-2", revision: 2, activeMinutes: 9 });
  const installation = installationEvent("install-event", "install-1");
  const installationRetry = structuredClone(installation);
  installationRetry.received_at = "2026-07-12T08:10:01.000Z";
  await writeFile(path.join(root, "events.jsonl"), [
    JSON.stringify(installation),
    JSON.stringify(installationRetry),
    JSON.stringify(summaryV1),
    JSON.stringify(summaryV2),
    JSON.stringify(updateEvent()),
    "",
  ].join("\n"));

  const report = await summarizeTelemetryFiles({ root });

  assert.equal(report.installations.observed, 1);
  const day = report.activity.by_date["2026-07-12"];
  assert.equal(day.active_installations, 1);
  assert.equal(day.active_minutes, 9);
  assert.equal(day.launches, 2);
  assert.equal(day.weekly_active_installations.status, "unavailable_coverage");
  assert.equal(day.weekly_active_installations.value, null);
  assert.equal(day.weekly_active_installations.actual_start, "2026-07-12");
  assert.ok(day.weekly_active_installations.missing_dates.includes("2026-07-06"));
  assert.equal(day.monthly_active_installations.status, "partial");
  assert.equal(day.monthly_active_installations.value, 1);
  assert.equal(day.monthly_active_installations.actual_start, "2026-07-12");
  assert.deepEqual(report.features, [{
    feature_id: "navigation.file_search",
    dimensions: {},
    count: 3,
    active_installations: 1,
  }]);
  assert.deepEqual(report.updates.states, { completed: 1 });
  assert.equal(report.data_quality.duplicate_event_ids, 1);
  assert.equal(report.data_quality.conflicting_duplicate_event_ids, 0);
  assert.equal(report.data_quality.superseded_daily_summaries, 1);
});

test("launch-based DAU counts every opened App and keeps deeper activity separate", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-launch-based-dau-"));
  const launchOnly = dailyEvent({
    eventId: "launch-based-open",
    installId: "launch-based-open",
    revision: 1,
    activeMinutes: 0,
    featureCounts: [],
  });
  const featureOnly = dailyEvent({
    eventId: "launch-based-feature",
    installId: "launch-based-feature",
    revision: 1,
    activeMinutes: 0,
    featureCounts: [{ feature_id: "navigation.file_search", count: 1 }],
  });
  featureOnly.properties.launch_count = 0;
  featureOnly.properties.launch_counts_by_entry_kind = {};
  await writeFile(path.join(root, "events.jsonl"), `${[
    launchOnly,
    featureOnly,
  ].map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({ root });
  const day = report.activity.by_date["2026-07-12"];

  assert.equal(report.activity.contract_version, "launch_based_v2");
  assert.equal(day.active_installations, 2);
  assert.equal(day.engaged_installations, 1);
  assert.equal(day.active_minutes, 0);
  assert.equal(day.launches, 2);
  assert.deepEqual(report.activity.active_versions, { "1.5.0": 2 });
  assert.deepEqual(report.activity.engaged_versions, { "1.5.0": 1 });
});

test("requested daily gaps are explicit and yesterday remains provisional for late arrivals", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-explicit-daily-gaps-"));
  const daily = dailyEvent({
    eventId: "explicit-gap-latest",
    installId: "explicit-gap-latest",
    summaryDate: "2026-07-21",
    revision: 1,
    activeMinutes: 0,
    featureCounts: [],
    occurredAt: "2026-07-21T08:00:00.000Z",
    envelopeDate: "2026-07-21",
  });
  await writeFile(path.join(root, "events.jsonl"), `${JSON.stringify(daily)}\n`);

  const report = await summarizeTelemetryFiles({
    root,
    from: "2026-07-19",
    to: "2026-07-21",
    now: () => new Date("2026-07-22T01:00:00.000Z"),
  });

  assert.deepEqual(Object.keys(report.activity.by_date), [
    "2026-07-19",
    "2026-07-20",
    "2026-07-21",
  ]);
  for (const date of ["2026-07-19", "2026-07-20"]) {
    assert.equal(report.activity.by_date[date].active_installations, null);
    assert.equal(report.activity.by_date[date].engaged_installations, null);
    assert.equal(report.activity.by_date[date].active_minutes, null);
    assert.equal(report.activity.by_date[date].launches, null);
    assert.equal(report.activity.by_date[date].status, "unavailable_coverage");
  }
  assert.equal(report.activity.by_date["2026-07-21"].active_installations, 1);
  assert.equal(
    report.activity.by_date["2026-07-21"].freshness_status,
    "provisional_late_arrivals",
  );
  assert.match(telemetryReportMarkdown(report), /深度活跃/);
  assert.match(telemetryReportMarkdown(report), /provisional_late_arrivals/);
});

test("summary validates records before deduplication and never normalizes invalid counters to zero", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-contract-summary-"));
  const downloadsRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-contract-downloads-"));
  const invalidDaily = dailyEvent({ eventId: "shared-daily", revision: 1, activeMinutes: -1 });
  const validDaily = dailyEvent({ eventId: "shared-daily", revision: 1, activeMinutes: 4 });
  await writeFile(path.join(root, "events.jsonl"), [
    JSON.stringify(invalidDaily),
    JSON.stringify(validDaily),
    "",
  ].join("\n"));
  await writeFile(path.join(downloadsRoot, "downloads.jsonl"), [
    JSON.stringify(downloadEvent("shared-download", "darwin-universal", "dmg", -1)),
    JSON.stringify(downloadEvent("shared-download", "darwin-universal", "dmg", 120)),
    "",
  ].join("\n"));

  const report = await summarizeTelemetryFiles({ root, downloadsRoot });

  assert.equal(report.data_quality.invalid_lines, 1);
  assert.deepEqual(report.data_quality.invalid_event_reasons, { invalid_daily_summary_properties: 1 });
  assert.equal(report.data_quality.duplicate_event_ids, 0);
  assert.equal(report.activity.by_date["2026-07-12"].active_minutes, 4);
  assert.equal(report.data_quality.invalid_download_lines, 1);
  assert.deepEqual(report.data_quality.invalid_download_reasons, { invalid_download_contract: 1 });
  assert.equal(report.data_quality.duplicate_download_ids, 0);
  assert.equal(report.downloads.requests, 1);
});

test("summary rejects Deep Link failure reasons on non-error results", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-deep-link-contract-"));
  const invalidDaily = dailyEvent({
    eventId: "invalid-deep-link-reason",
    featureCounts: [{
      feature_id: "navigation.deep_link",
      dimensions: {
        type: "repository",
        result: "success",
        failure_reason: "repository_not_known",
      },
      count: 1,
    }],
  });
  await writeFile(path.join(root, "events.jsonl"), `${JSON.stringify(invalidDaily)}\n`);

  const report = await summarizeTelemetryFiles({ root });

  assert.equal(report.data_quality.invalid_lines, 1);
  assert.deepEqual(report.data_quality.invalid_event_reasons, { invalid_daily_summary_properties: 1 });
  assert.deepEqual(report.features, []);
});

test("conflicting event and download ids quarantine every record for that id", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-conflicting-event-id-"));
  const downloadsRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-conflicting-download-id-"));
  const firstEvent = installationEvent("quarantined-event-id", "quarantined-install-a");
  const conflictingEvent = installationEvent("quarantined-event-id", "quarantined-install-b");
  const firstEventRetry = structuredClone(firstEvent);
  firstEventRetry.received_at = "2026-07-12T08:10:01.000Z";
  const firstDownload = downloadEvent("quarantined-download-id", "darwin-universal", "dmg", 100);
  const conflictingDownload = downloadEvent("quarantined-download-id", "darwin-universal", "dmg", 200);
  await writeFile(path.join(root, "events.jsonl"), `${[
    firstEvent,
    conflictingEvent,
    firstEventRetry,
  ].map(JSON.stringify).join("\n")}\n`);
  await writeFile(path.join(downloadsRoot, "downloads.jsonl"), `${[
    firstDownload,
    conflictingDownload,
    firstDownload,
  ].map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({ root, downloadsRoot });

  assert.equal(report.installations.observed, 0);
  assert.equal(report.downloads.requests, 0);
  assert.equal(report.data_quality.duplicate_event_ids, 2);
  assert.equal(report.data_quality.conflicting_duplicate_event_ids, 1);
  assert.equal(report.data_quality.duplicate_download_ids, 2);
  assert.equal(report.data_quality.conflicting_duplicate_download_ids, 1);
});

test("strict update records enforce the 1.10 capability contract while legacy stage gaps remain diagnosable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-strict-update-contract-"));
  const missingStage = updateEvent({
    eventId: "strict-shared-failure",
    installId: "strict-install",
    state: "failed",
    fromVersion: "1.10.0",
    toVersion: null,
    properties: { error_code: "network" },
  });
  missingStage.app.version = "1.10.0";
  const completeFailure = structuredClone(missingStage);
  completeFailure.properties.stage = "check";
  const impossibleCurrent = updateEvent({
    eventId: "strict-current-ahead",
    installId: "strict-current",
    state: "current",
    fromVersion: "1.10.0",
    toVersion: "1.11.0",
  });
  impossibleCurrent.app.version = "1.10.0";
  const legacyMissingStage = updateEvent({
    eventId: "legacy-stage-gap",
    installId: "legacy-stage-gap",
    state: "failed",
    fromVersion: "1.5.0",
    toVersion: null,
    properties: { error_code: "network" },
  });
  const legacyMissingDetails = updateEvent({
    eventId: "legacy-details-gap",
    installId: "legacy-details-gap",
    state: "failed",
    fromVersion: "1.5.0",
    toVersion: null,
  });
  const observedDowngrade = updateEvent({
    eventId: "strict-observed-downgrade",
    installId: "strict-observed-downgrade",
    state: "completed",
    fromVersion: "1.11.0",
    toVersion: "1.10.0",
  });
  observedDowngrade.app.version = "1.10.0";
  const legacyNonFailureWithError = updateEvent({
    eventId: "legacy-non-failure-error",
    installId: "legacy-non-failure-error",
    state: "available",
    fromVersion: "1.5.0",
    toVersion: "1.6.0",
    properties: { error_code: "network" },
  });
  await writeFile(path.join(root, "events.jsonl"), `${[
    missingStage,
    completeFailure,
    impossibleCurrent,
    legacyMissingStage,
    legacyMissingDetails,
    observedDowngrade,
    legacyNonFailureWithError,
  ].map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({ root });

  assert.equal(report.data_quality.invalid_lines, 3);
  assert.equal(report.data_quality.duplicate_event_ids, 0);
  assert.equal(report.updates.states.failed, 3);
  assert.equal(report.updates.states.completed, 1);
  assert.equal(report.updates.quality.failures_missing_stage.events, 2);
  assert.deepEqual(report.updates.quality.failures_missing_stage_app_versions, ["1.5.0"]);
  assert.equal(report.updates.quality.failures_missing_error_code.events, 1);
  assert.deepEqual(report.updates.legacy_unknown.failures_missing_error_code, { events: 1, installations: 1 });
});

test("record contracts reject invalid calendar timestamps and SemVer numeric prerelease zeros", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-time-version-contract-"));
  const invalidDate = installationEvent("invalid-calendar", "invalid-calendar");
  invalidDate.occurred_at = "2026-02-30T08:00:00.000Z";
  invalidDate.local_date = "2026-02-30";
  const invalidVersion = installationEvent("invalid-prerelease", "invalid-prerelease");
  invalidVersion.app.version = "1.10.0-01";
  const excessivePrecision = installationEvent("invalid-precision", "invalid-precision");
  excessivePrecision.occurred_at = "2026-07-12T08:00:00.1234567Z";
  const invalidSummaryDateHash = dailyEvent({
    eventId: "invalid-summary-date-hash",
    installId: "invalid-summary-date-hash",
    summaryDate: "2026-07-12",
    summaryId: "0".repeat(32),
    revision: 1,
    activeMinutes: 1,
  });
  const futureSummaryDate = dailyEvent({
    eventId: "invalid-future-summary-date",
    installId: "invalid-future-summary-date",
    summaryDate: "2026-07-13",
    revision: 1,
    activeMinutes: 1,
    occurredAt: "2026-07-12T08:00:00.000Z",
    envelopeDate: "2026-07-12",
  });
  const oldExplicitSummaryDate = dailyEvent({
    eventId: "valid-old-summary-date",
    installId: "valid-old-summary-date",
    summaryDate: "2024-07-12",
    revision: 1,
    activeMinutes: 1,
    occurredAt: "2026-07-12T08:00:00.000Z",
    envelopeDate: "2026-07-12",
  });
  await writeFile(path.join(root, "events.jsonl"), `${[
    invalidDate,
    invalidVersion,
    excessivePrecision,
    invalidSummaryDateHash,
    futureSummaryDate,
    oldExplicitSummaryDate,
  ].map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({ root });

  assert.equal(report.data_quality.invalid_lines, 5);
  assert.equal(report.data_sources.events.status, "present");
  assert.equal(report.data_sources.events.validation_status, "mixed");
  assert.equal(report.activity.by_date["2024-07-12"].active_minutes, 1);
});

test("update check balance excludes unexplained current and legacy failures and exposes no default funnel", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-check-balance-"));
  const events = [];
  for (let index = 0; index < 4; index += 1) {
    events.push(updateEvent({ eventId: `check-started-${index}`, installId: `check-${index}`, state: "check_started", toVersion: undefined }));
  }
  events.push(
    updateEvent({ eventId: "current-exact", installId: "check-0", state: "current", toVersion: "1.4.0" }),
    updateEvent({ eventId: "current-behind", installId: "check-1", state: "current", toVersion: "1.3.0" }),
    updateEvent({ eventId: "available-check", installId: "check-2", state: "available", toVersion: "1.6.0" }),
    updateEvent({ eventId: "legacy-available-gap", installId: "legacy-available-gap", state: "available", toVersion: null }),
    updateEvent({
      eventId: "failed-check", installId: "check-3", state: "failed", toVersion: null,
      properties: { error_code: "network", stage: "check" },
    }),
    updateEvent({ eventId: "current-other", installId: "other-current", state: "current", toVersion: "1.6.0" }),
    updateEvent({
      eventId: "legacy-failure", installId: "legacy-failure", state: "failed", toVersion: null,
      properties: { error_code: "network" },
    }),
  );
  await writeFile(path.join(root, "events.jsonl"), `${events.map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({ root });

  assert.deepEqual(report.updates.quality.check_balance, {
    capability_scope: "app_version_gte_1.10.0",
    check_started: 0,
    current_exact: 0,
    feed_behind: 0,
    current_other: 0,
    available: 0,
    failed_check: 0,
    outcomes: 0,
    difference: 0,
  });
  assert.deepEqual(report.updates.legacy_unknown.missing_target, { events: 2, installations: 2 });
  assert.deepEqual(report.updates.legacy_unknown.failures_missing_stage, { events: 1, installations: 1 });
  assert.equal(Object.hasOwn(report.updates, "journeys"), false);
});

test("update checks compare valid semantic versions including prerelease precedence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-semver-summary-"));
  await writeFile(path.join(root, "events.jsonl"), `${[
    updateEvent({ eventId: "semver-check-1", installId: "semver-1", state: "check_started", toVersion: undefined }),
    updateEvent({ eventId: "semver-current-1", installId: "semver-1", state: "current", fromVersion: "1.10.1-rc.2", toVersion: "1.10.1-rc.2", appVersion: "1.10.1-rc.2" }),
    updateEvent({ eventId: "semver-check-2", installId: "semver-2", state: "check_started", toVersion: undefined }),
    updateEvent({ eventId: "semver-current-2", installId: "semver-2", state: "current", fromVersion: "1.10.1", toVersion: "1.10.1-rc.2", appVersion: "1.10.1" }),
    updateEvent({ eventId: "semver-check-3", installId: "semver-3", state: "check_started", toVersion: undefined }),
    updateEvent({ eventId: "semver-current-3", installId: "semver-3", state: "current", fromVersion: "1.10.1+build.1", toVersion: "1.10.1+build.2", appVersion: "1.10.1+build.1" }),
  ].map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({ root });

  assert.equal(report.updates.quality.check_balance.current_exact, 2);
  assert.equal(report.updates.quality.check_balance.feed_behind, 1);
  assert.equal(report.updates.quality.check_balance.current_other, 0);
});

test("strong update balance and lifecycle relations use only the App 1.10 strict capability", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-strict-update-scope-"));
  const strictCheck = updateEvent({
    eventId: "strict-scope-check", installId: "strict-scope-check", state: "check_started",
    fromVersion: "1.10.0", toVersion: undefined,
  });
  strictCheck.app.version = "1.10.0";
  delete strictCheck.properties.to_version;
  const strictCurrent = updateEvent({
    eventId: "strict-scope-current", installId: "strict-scope-check", state: "current",
    fromVersion: "1.10.0", toVersion: "1.10.0",
  });
  strictCurrent.app.version = "1.10.0";
  const strictAvailable = updateEvent({
    eventId: "strict-scope-available", installId: "strict-scope-path", state: "available",
    fromVersion: "1.10.0", toVersion: "1.11.0", occurredAt: "2026-07-12T08:01:00.000Z",
  });
  strictAvailable.app.version = "1.10.0";
  const strictDownloaded = updateEvent({
    eventId: "strict-scope-downloaded", installId: "strict-scope-path", state: "downloaded",
    fromVersion: "1.10.0", toVersion: "1.11.0", occurredAt: "2026-07-12T08:02:00.000Z",
  });
  strictDownloaded.app.version = "1.10.0";
  const strictCompleted = updateEvent({
    eventId: "strict-scope-completed", installId: "strict-scope-path", state: "completed",
    fromVersion: "1.10.0", toVersion: "1.11.0", occurredAt: "2026-07-12T08:03:00.000Z",
  });
  strictCompleted.app.version = "1.11.0";
  const legacyCheck = updateEvent({
    eventId: "legacy-scope-check", installId: "legacy-scope-check", state: "check_started",
    fromVersion: "1.5.0", toVersion: undefined,
  });
  delete legacyCheck.properties.to_version;
  const legacyUnknownTarget = updateEvent({
    eventId: "legacy-scope-target", installId: "legacy-scope-target", state: "available",
    fromVersion: "1.5.0", toVersion: null,
  });
  const legacyUnknownFailure = updateEvent({
    eventId: "legacy-scope-failure", installId: "legacy-scope-failure", state: "failed",
    fromVersion: "1.5.0", toVersion: null,
  });
  await writeFile(path.join(root, "events.jsonl"), `${[
    strictCheck,
    strictCurrent,
    strictAvailable,
    strictDownloaded,
    strictCompleted,
    legacyCheck,
    legacyUnknownTarget,
    legacyUnknownFailure,
  ].map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({ root });

  assert.equal(report.updates.capability_scope, "app_version_gte_1.10.0");
  assert.deepEqual(report.updates.quality.check_balance, {
    capability_scope: "app_version_gte_1.10.0",
    check_started: 1,
    current_exact: 1,
    feed_behind: 0,
    current_other: 0,
    available: 1,
    failed_check: 0,
    outcomes: 2,
    difference: -1,
  });
  assert.deepEqual(report.updates.legacy_unknown.missing_target, { events: 2, installations: 2 });
  assert.deepEqual(report.updates.legacy_unknown.failures_missing_stage, { events: 1, installations: 1 });
  assert.equal(report.updates.relations.available_paths, 1);
  assert.equal(report.updates.relations.downloaded_with_prior_available, 1);
  assert.equal(report.updates.relations.completed_with_prior_lifecycle, 1);
  assert.match(telemetryReportMarkdown(report), /App >= 1\.10\.0 strict capability/);
});

test("update relations use one earliest state per install and target version with strict ordering", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-update-relations-"));
  const events = [
    updateEvent({ eventId: "available-first", state: "available", toVersion: "1.6.0", occurredAt: "2026-07-12T08:00:00.000Z" }),
    updateEvent({ eventId: "available-repeat", state: "available", toVersion: "1.6.0", occurredAt: "2026-07-12T08:01:00.000Z" }),
    updateEvent({ eventId: "downloaded-equal", state: "downloaded", toVersion: "1.6.0", occurredAt: "2026-07-12T08:00:00.000Z" }),
    updateEvent({ eventId: "downloaded-repeat", state: "downloaded", toVersion: "1.6.0", occurredAt: "2026-07-12T08:02:00.000Z" }),
    updateEvent({ eventId: "started-first", state: "install_started", toVersion: "1.6.0", occurredAt: "2026-07-12T08:02:00.000Z" }),
    updateEvent({ eventId: "started-repeat", state: "install_started", toVersion: "1.6.0", occurredAt: "2026-07-12T08:03:00.000Z" }),
    updateEvent({ eventId: "completed-equal", state: "completed", toVersion: "1.6.0", occurredAt: "2026-07-12T08:00:00.000Z" }),
    updateEvent({ eventId: "completed-repeat", state: "completed", toVersion: "1.6.0", occurredAt: "2026-07-12T08:04:00.000Z" }),
  ];
  for (const event of events) {
    event.properties.from_version = "1.10.0";
    event.properties.to_version = "1.11.0";
    event.app.version = event.properties.state === "completed" ? "1.11.0" : "1.10.0";
  }
  await writeFile(path.join(root, "events.jsonl"), `${events.map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({ root });

  assert.deepEqual(report.updates.relations, {
    available_paths: 1,
    downloaded_with_prior_available: 0,
    downloaded_without_prior_available: 1,
    install_started_with_prior_downloaded: 1,
    install_started_without_prior_downloaded: 0,
    completed_with_prior_lifecycle: 0,
    completed_without_prior_lifecycle: 1,
  });
});

test("first observed installations are globally deduplicated to their earliest valid event", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-first-observed-"));
  const later = baseEvent("first-later", "same-install", "git_leaf.installation.observed", {
    reason: "first_observed",
  }, { occurredAt: "2026-07-13T08:00:00.000Z" });
  later.local_date = "2026-07-13";
  later.app.version = "1.6.0";
  const earlier = baseEvent("first-earlier", "same-install", "git_leaf.installation.observed", {
    reason: "first_observed",
  }, { occurredAt: "2026-07-12T08:00:00.000Z" });
  await writeFile(path.join(root, "events.jsonl"), `${[later, earlier].map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({ root });

  assert.deepEqual(report.installations.first_observed_by_date, { "2026-07-12": 1 });
  assert.deepEqual(report.installations.first_observed_by_version, { "1.5.0": 1 });
});

test("observed installation slices use first-observed metadata and ignore later device-name changes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-first-observed-slices-"));
  const first = installationEvent("slice-first-observed", "slice-install");
  const renamed = baseEvent("slice-device-renamed", "slice-install", "git_leaf.installation.observed", {
    reason: "device_name_changed",
    device_name: "Renamed PC",
  }, { platform: "win32", occurredAt: "2026-07-13T08:00:00.000Z" });
  renamed.local_date = "2026-07-13";
  renamed.app.version = "1.6.0";
  renamed.app.arch = "x64";
  renamed.received_at = "2026-07-13T08:00:01.000Z";
  const orphanRename = baseEvent("slice-orphan-renamed", "slice-orphan", "git_leaf.installation.observed", {
    reason: "device_name_changed",
  });
  await writeFile(path.join(root, "events.jsonl"), `${[
    first,
    renamed,
    orphanRename,
  ].map(JSON.stringify).join("\n")}\n`);

  const unfiltered = await summarizeTelemetryFiles({ root });
  const newVersion = await summarizeTelemetryFiles({ root, appVersion: "1.6.0" });
  const windows = await summarizeTelemetryFiles({ root, platform: "win32" });

  assert.equal(unfiltered.installations.observed, 1);
  assert.equal(newVersion.installations.observed, 0);
  assert.equal(windows.installations.observed, 0);
  assert.deepEqual(newVersion.installations.first_observed_by_version, {});
});

test("feature usage aggregates by feature id and the complete dimension combination", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-feature-dimensions-"));
  await writeFile(path.join(root, "events.jsonl"), `${JSON.stringify(dailyEvent({
    eventId: "dimensioned-features",
    revision: 1,
    activeMinutes: 4,
    featureCounts: [
      {
        feature_id: "git.sync",
        dimensions: {
          strategy: "guarded_live_v1",
          result: "success",
          drift_kind: "content_changed",
          retry_bucket: "1",
          duration_bucket: "1_3s",
        },
        count: 3,
      },
      { feature_id: "git.sync", dimensions: { result: "error", error_code: "push_failed" }, count: 2 },
      {
        feature_id: "navigation.deep_link",
        dimensions: {
          type: "repository",
          result: "error",
          failure_reason: "repository_not_known",
        },
        count: 4,
      },
      {
        feature_id: "navigation.deep_link",
        dimensions: { type: "repository", result: "error" },
        count: 2,
      },
    ],
  }))}\n`);

  const report = await summarizeTelemetryFiles({ root });

  assert.deepEqual(report.features, [
    {
      feature_id: "git.sync",
      dimensions: {
        drift_kind: "content_changed",
        duration_bucket: "1_3s",
        result: "success",
        retry_bucket: "1",
        strategy: "guarded_live_v1",
      },
      count: 3,
      active_installations: 1,
    },
    {
      feature_id: "git.sync",
      dimensions: { error_code: "push_failed", result: "error" },
      count: 2,
      active_installations: 1,
    },
    {
      feature_id: "navigation.deep_link",
      dimensions: {
        failure_reason: "legacy_unknown",
        result: "error",
        type: "repository",
      },
      count: 2,
      active_installations: 1,
    },
    {
      feature_id: "navigation.deep_link",
      dimensions: {
        failure_reason: "repository_not_known",
        result: "error",
        type: "repository",
      },
      count: 4,
      active_installations: 1,
    },
  ]);
  const markdown = telemetryReportMarkdown(report);
  assert.match(markdown, /failure_reason=legacy_unknown/);
  assert.match(markdown, /failure_reason=repository_not_known/);
});

test("conflicting daily summaries with the same revision are excluded instead of selected arbitrarily", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-summary-conflict-"));
  await writeFile(path.join(root, "events.jsonl"), `${[
    dailyEvent({ eventId: "conflict-daily-a", revision: 3, activeMinutes: 4 }),
    dailyEvent({ eventId: "conflict-daily-b", revision: 3, activeMinutes: 9 }),
  ].map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({ root });

  const day = report.activity.by_date["2026-07-12"];
  assert.equal(day.active_installations, null);
  assert.equal(day.active_minutes, null);
  assert.equal(day.status, "unavailable_quality");
  assert.equal(day.excluded_conflicting_summaries, 1);
  assert.equal(day.weekly_active_installations.status, "unavailable_quality");
  assert.equal(report.activity.mode_minutes_status, "unavailable_quality");
  assert.equal(report.features_status, "unavailable_quality");
  assert.equal(report.repositories.status, "unavailable_quality");
  assert.equal(report.data_quality.conflicting_daily_summary_revisions, 1);
  assert.equal(report.data_quality.excluded_conflicting_daily_summaries, 1);
  assert.deepEqual(report.data_quality.daily_summary_conflicting_dates, ["2026-07-12"]);
  assert.equal(report.data_quality.superseded_daily_summaries, 0);
});

test("legacy daily summaries recover their business date before filtering and revision selection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-legacy-summary-date-"));
  const lateSingle = dailyEvent({
    eventId: "late-single-summary",
    installId: "late-single-install",
    summaryDate: "2026-07-10",
    includeSummaryDate: false,
    revision: 1,
    activeMinutes: 4,
    occurredAt: "2026-07-12T08:00:00.000Z",
    envelopeDate: "2026-07-12",
  });
  const earlierRevision = dailyEvent({
    eventId: "late-multi-summary-1",
    installId: "late-multi-install",
    summaryDate: "2026-07-09",
    includeSummaryDate: false,
    revision: 1,
    activeMinutes: 3,
    occurredAt: "2026-07-10T08:00:00.000Z",
    envelopeDate: "2026-07-10",
  });
  const latestRevision = dailyEvent({
    eventId: "late-multi-summary-2",
    installId: "late-multi-install",
    summaryDate: "2026-07-09",
    includeSummaryDate: false,
    revision: 2,
    activeMinutes: 9,
    occurredAt: "2026-07-14T08:00:00.000Z",
    envelopeDate: "2026-07-14",
  });
  const unresolved = dailyEvent({
    eventId: "unresolved-summary-date",
    installId: "unresolved-summary-date",
    summaryDate: "2026-07-08",
    summaryId: "0".repeat(32),
    includeSummaryDate: false,
    revision: 1,
    activeMinutes: 7,
    occurredAt: "2026-07-12T08:00:00.000Z",
    envelopeDate: "2026-07-12",
  });
  await writeFile(path.join(root, "events.jsonl"), `${[
    lateSingle,
    earlierRevision,
    latestRevision,
    unresolved,
  ].map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({ root });
  const filtered = await summarizeTelemetryFiles({ root, from: "2026-07-09", to: "2026-07-09" });

  assert.equal(report.activity.by_date["2026-07-10"].active_minutes, 4);
  assert.equal(report.activity.by_date["2026-07-09"].active_minutes, 9);
  assert.equal(report.activity.by_date["2026-07-12"], undefined);
  assert.equal(report.data_quality.superseded_daily_summaries, 1);
  assert.equal(report.data_quality.conflicting_daily_summary_identities, 0);
  assert.deepEqual(report.data_quality.daily_summary_dates, {
    legacy_missing_explicit_date: 4,
    recovered: 3,
    unresolved: 1,
    envelope_date_shifted: 3,
  });
  assert.deepEqual(Object.keys(filtered.activity.by_date), ["2026-07-09"]);
  assert.equal(filtered.activity.by_date["2026-07-09"].active_minutes, 9);
});

test("legacy summary date recovery never goes after the envelope and uses a 12 calendar month boundary", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-legacy-calendar-boundary-"));
  const future = dailyEvent({
    eventId: "legacy-future-date",
    installId: "legacy-future-date",
    summaryDate: "2026-07-13",
    includeSummaryDate: false,
    revision: 1,
    activeMinutes: 2,
    envelopeDate: "2026-07-12",
  });
  const boundary = dailyEvent({
    eventId: "legacy-calendar-boundary",
    installId: "legacy-calendar-boundary",
    summaryDate: "2025-07-12",
    includeSummaryDate: false,
    revision: 1,
    activeMinutes: 3,
    envelopeDate: "2026-07-12",
  });
  const tooOld = dailyEvent({
    eventId: "legacy-before-calendar-boundary",
    installId: "legacy-before-calendar-boundary",
    summaryDate: "2025-07-11",
    includeSummaryDate: false,
    revision: 1,
    activeMinutes: 4,
    envelopeDate: "2026-07-12",
  });
  await writeFile(path.join(root, "events.jsonl"), `${[
    future,
    boundary,
    tooOld,
  ].map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({ root });

  assert.deepEqual(Object.keys(report.activity.by_date), ["2025-07-12"]);
  assert.equal(report.activity.by_date["2025-07-12"].active_minutes, 3);
  assert.deepEqual(report.data_quality.daily_summary_dates, {
    legacy_missing_explicit_date: 3,
    recovered: 1,
    unresolved: 2,
    envelope_date_shifted: 1,
  });
});

test("logically inconsistent daily summaries are excluded from every daily-derived metric", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-daily-quality-"));
  const inconsistent = dailyEvent({ eventId: "inconsistent-daily", revision: 1, activeMinutes: 4 });
  inconsistent.properties.launch_count = 3;
  inconsistent.properties.mode_minutes.preview = 2;
  await writeFile(path.join(root, "events.jsonl"), `${JSON.stringify(inconsistent)}\n`);

  const report = await summarizeTelemetryFiles({ root });
  const day = report.activity.by_date["2026-07-12"];

  assert.equal(day.active_installations, null);
  assert.equal(day.active_minutes, null);
  assert.equal(day.launches, null);
  assert.equal(day.weekly_active_installations.status, "unavailable_quality");
  assert.deepEqual(report.activity.mode_minutes, { preview: null, source: null, live: null });
  assert.equal(report.activity.mode_minutes_status, "unavailable_quality");
  assert.deepEqual(report.features, []);
  assert.equal(report.features_status, "unavailable_quality");
  assert.deepEqual(report.data_quality.daily_summary_inconsistencies, {
    launch_count_mismatch: 1,
    active_minutes_mismatch: 1,
    distinct_repositories_exceed_opens: 0,
    daily_repositories_exceed_rolling_30d: 0,
  });
  assert.deepEqual(report.data_quality.daily_summary_inconsistent_dates, ["2026-07-12"]);
});

test("launch-count imbalance cannot create launch-based DAU", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-launch-dau-quality-"));
  const inconsistent = dailyEvent({
    eventId: "launch-dau-inconsistent",
    revision: 1,
    activeMinutes: 0,
    featureCounts: [],
  });
  inconsistent.properties.launch_count = 3;
  await writeFile(path.join(root, "events.jsonl"), `${JSON.stringify(inconsistent)}\n`);

  const report = await summarizeTelemetryFiles({ root });
  const day = report.activity.by_date["2026-07-12"];

  assert.equal(day.active_installations, null);
  assert.equal(day.engaged_installations, null);
  assert.equal(day.launches, null);
  assert.equal(day.status, "unavailable_quality");
  assert.deepEqual(report.activity.active_versions, null);
  assert.equal(report.activity.active_versions_status, "unavailable_quality");
  assert.equal(report.data_quality.daily_summary_inconsistencies.launch_count_mismatch, 1);
});

test("one inconsistent summary does not erase valid daily aggregates from the same window", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-partial-daily-quality-"));
  const valid = dailyEvent({
    eventId: "valid-daily-subset",
    installId: "valid-daily-subset",
    revision: 1,
    activeMinutes: 4,
  });
  const invalid = dailyEvent({
    eventId: "invalid-daily-subset",
    installId: "invalid-daily-subset",
    revision: 1,
    activeMinutes: 5,
  });
  invalid.properties.mode_minutes.preview = 2;
  await writeFile(path.join(root, "events.jsonl"), `${[valid, invalid].map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({ root });
  const day = report.activity.by_date["2026-07-12"];

  assert.equal(day.active_installations, 1);
  assert.equal(day.active_minutes, 4);
  assert.equal(day.launches, 2);
  assert.equal(day.status, "partial_quality");
  assert.equal(day.excluded_inconsistent_summaries, 1);
  assert.deepEqual(report.activity.mode_minutes, { preview: 4, source: 0, live: 0 });
  assert.equal(report.activity.mode_minutes_status, "partial_quality");
  assert.deepEqual(report.activity.active_versions, { "1.5.0": 1 });
  assert.equal(report.repositories.status, "partial_quality");
  assert.equal(report.features[0].count, 3);
  assert.equal(report.features_status, "partial_quality");
});

test("App versions and download artifact versions use independent filters", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-version-filters-"));
  const downloadsRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-artifact-filters-"));
  const app15 = installationEvent("app-version-15", "install-version-15");
  const app16 = installationEvent("app-version-16", "install-version-16");
  app16.app.version = "1.6.0";
  await writeFile(path.join(root, "events.jsonl"), `${[app15, app16].map(JSON.stringify).join("\n")}\n`);
  await writeFile(path.join(downloadsRoot, "downloads.jsonl"), `${[
    downloadEvent("artifact-15", "darwin-universal", "dmg", 100, "1.5.0"),
    downloadEvent("artifact-17", "darwin-universal", "dmg", 100, "1.7.0"),
  ].map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({
    root,
    downloadsRoot,
    appVersion: "1.6.0",
    artifactVersion: "1.7.0",
  });

  assert.equal(report.installations.observed, 1);
  assert.deepEqual(report.installations.first_observed_by_version, { "1.6.0": 1 });
  assert.deepEqual(report.downloads.by_version, { "1.7.0": { bytes: 100, requests: 1 } });
  await assert.rejects(
    summarizeTelemetryFiles({ root, version: "1.6.0" }),
    /ambiguous.*appVersion.*artifactVersion/i,
  );
});

test("daily revisions are selected before App version and platform slices", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-daily-slice-order-"));
  const oldSnapshot = dailyEvent({
    eventId: "daily-slice-old",
    installId: "daily-slice-install",
    revision: 1,
    activeMinutes: 4,
  });
  const latestSnapshot = dailyEvent({
    eventId: "daily-slice-latest",
    installId: "daily-slice-install",
    revision: 2,
    activeMinutes: 9,
  });
  latestSnapshot.app.version = "1.6.0";
  latestSnapshot.app.platform = "win32";
  latestSnapshot.app.arch = "x64";
  await writeFile(path.join(root, "events.jsonl"), `${[
    oldSnapshot,
    latestSnapshot,
  ].map(JSON.stringify).join("\n")}\n`);

  const oldVersion = await summarizeTelemetryFiles({ root, appVersion: "1.5.0" });
  const oldPlatform = await summarizeTelemetryFiles({ root, platform: "darwin" });
  const latest = await summarizeTelemetryFiles({ root, appVersion: "1.6.0", platform: "win32" });

  assert.deepEqual(oldVersion.activity.by_date, {});
  assert.deepEqual(oldPlatform.activity.by_date, {});
  assert.equal(latest.activity.by_date["2026-07-12"].active_minutes, 9);
  assert.equal(latest.data_quality.superseded_daily_summaries, 1);
});

test("WAU and MAU coverage is proven only by selected daily summary business dates", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-daily-coverage-proof-"));
  const lifecycleOnly = [];
  for (let day = 6; day <= 11; day += 1) {
    const date = `2026-07-${String(day).padStart(2, "0")}`;
    const event = installationEvent(`coverage-lifecycle-${day}`, `coverage-install-${day}`);
    event.occurred_at = `${date}T08:00:00.000Z`;
    event.local_date = date;
    event.received_at = `${date}T08:00:01.000Z`;
    lifecycleOnly.push(event);
  }
  const daily = dailyEvent({
    eventId: "coverage-daily-only",
    installId: "coverage-daily-only",
    summaryDate: "2026-07-12",
    revision: 1,
    activeMinutes: 4,
  });
  await writeFile(path.join(root, "events.jsonl"), `${[
    ...lifecycleOnly,
    daily,
  ].map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({ root });
  const day = report.activity.by_date["2026-07-12"];

  assert.equal(day.weekly_active_installations.status, "unavailable_coverage");
  assert.equal(day.weekly_active_installations.covered_days, 1);
  assert.deepEqual(day.weekly_active_installations.missing_dates, [
    "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11",
  ]);
  assert.equal(day.monthly_active_installations.status, "partial");
  assert.equal(day.monthly_active_installations.covered_days, 1);
});

test("rolling active metrics propagate daily conflict dates as partial quality", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-rolling-conflict-quality-"));
  const events = [];
  for (let day = 6; day <= 12; day += 1) {
    const date = `2026-07-${String(day).padStart(2, "0")}`;
    events.push(dailyEvent({
      eventId: `rolling-valid-${day}`,
      installId: `rolling-valid-${day}`,
      summaryDate: date,
      revision: 1,
      activeMinutes: 1,
      occurredAt: `${date}T08:00:00.000Z`,
      envelopeDate: date,
    }));
  }
  events.push(
    dailyEvent({
      eventId: "rolling-conflict-a",
      installId: "rolling-conflict-install",
      summaryDate: "2026-07-10",
      revision: 1,
      activeMinutes: 2,
      occurredAt: "2026-07-10T08:00:00.000Z",
      envelopeDate: "2026-07-10",
    }),
    dailyEvent({
      eventId: "rolling-conflict-b",
      installId: "rolling-conflict-install",
      summaryDate: "2026-07-10",
      revision: 1,
      activeMinutes: 3,
      occurredAt: "2026-07-10T08:01:00.000Z",
      envelopeDate: "2026-07-10",
    }),
  );
  await writeFile(path.join(root, "events.jsonl"), `${events.map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({ root });
  const wau = report.activity.by_date["2026-07-12"].weekly_active_installations;

  assert.equal(report.activity.by_date["2026-07-10"].status, "partial_quality");
  assert.equal(wau.status, "partial_quality");
  assert.equal(wau.value, 7);
  assert.deepEqual(wau.quality_affected_dates, ["2026-07-10"]);
  assert.equal(wau.excluded_conflicting_summaries, 1);
});

test("report distinguishes unconfigured, unformed, and out-of-scope data sources", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-source-status-"));
  const emptyDownloadsRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-empty-downloads-"));
  const populatedDownloadsRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-populated-downloads-"));
  await writeFile(path.join(root, "events.jsonl"), `${JSON.stringify(installationEvent("source-event", "source-install"))}\n`);
  await writeFile(path.join(populatedDownloadsRoot, "downloads.jsonl"), `${JSON.stringify(
    downloadEvent("source-download", "darwin-universal", "dmg", 100),
  )}\n`);

  const unconfigured = await summarizeTelemetryFiles({ root });
  const unformed = await summarizeTelemetryFiles({ root, downloadsRoot: emptyDownloadsRoot });
  const outside = await summarizeTelemetryFiles({
    root,
    downloadsRoot: populatedDownloadsRoot,
    from: "2026-07-13",
  });
  const notConfigured = await summarizeTelemetryFiles();
  const missing = await summarizeTelemetryFiles({ root: path.join(root, "missing") });

  assert.equal(unconfigured.data_sources.events.status, "present");
  assert.equal(unconfigured.data_sources.downloads.status, "not_configured");
  assert.equal(unformed.data_sources.downloads.status, "empty");
  assert.equal(outside.data_sources.events.status, "present");
  assert.equal(outside.data_sources.events.scope_status, "no_records_in_scope");
  assert.equal(outside.data_sources.downloads.status, "present");
  assert.equal(outside.data_sources.downloads.scope_status, "no_records_in_scope");
  assert.equal(outside.data_sources.gateway_service.status, "not_checked");
  assert.equal(notConfigured.data_sources.events.status, "not_configured");
  assert.equal(missing.data_sources.events.status, "missing");
});

test("unavailable and unreadable sources expose N/A metrics instead of confirmed zeroes", async () => {
  const emptyRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-empty-events-"));
  const corruptEventsRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-corrupt-events-"));
  const corruptDownloadsRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-corrupt-downloads-"));
  const nonDirectory = path.join(emptyRoot, "not-a-directory");
  await writeFile(nonDirectory, "plain file");
  await writeFile(path.join(corruptEventsRoot, "events.jsonl.gz"), "not gzip data");
  await writeFile(path.join(corruptDownloadsRoot, "downloads.jsonl.gz"), "not gzip data");

  const unconfigured = await summarizeTelemetryFiles();
  const empty = await summarizeTelemetryFiles({ root: emptyRoot, downloadsRoot: emptyRoot });
  const missing = await summarizeTelemetryFiles({ root: path.join(emptyRoot, "missing") });
  const statFailure = await summarizeTelemetryFiles({ root: path.join(nonDirectory, "child") });
  const corrupt = await summarizeTelemetryFiles({
    root: corruptEventsRoot,
    downloadsRoot: corruptDownloadsRoot,
  });

  for (const report of [unconfigured, empty, missing, statFailure, corrupt]) {
    assert.equal(report.installations.observed, null);
    assert.equal(report.updates.states, null);
    assert.equal(report.activity.by_date, null);
    assert.equal(report.features, null);
    assert.equal(report.data_quality.invalid_lines, null);
  }
  assert.equal(unconfigured.data_sources.events.status, "not_configured");
  assert.equal(empty.data_sources.events.status, "empty");
  assert.equal(missing.data_sources.events.status, "missing");
  assert.equal(statFailure.data_sources.events.status, "read_error");
  assert.equal(corrupt.data_sources.events.status, "read_error");
  assert.equal(corrupt.data_sources.downloads.status, "read_error");
  assert.equal(corrupt.downloads.requests, null);
  for (const report of [missing, corrupt]) {
    const markdown = telemetryReportMarkdown(report);
    assert.match(markdown, /查询窗口截断可能性：N\/A/);
    assert.doesNotMatch(markdown, /查询窗口截断可能性：未由起始日期筛选触发/);
  }
  const corruptMarkdown = telemetryReportMarkdown(corrupt);
  assert.match(corruptMarkdown, /读取失败/);
  assert.match(corruptMarkdown, /已观察安装实例：N\/A/);
  assert.doesNotMatch(corruptMarkdown, /已观察安装实例：0/);
});

test("source freshness uses all valid events even when the metric window ends earlier", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-source-freshness-"));
  const older = installationEvent("freshness-older", "freshness-older");
  const newer = installationEvent("freshness-newer", "freshness-newer");
  newer.occurred_at = "2026-07-13T08:00:00.000Z";
  newer.local_date = "2026-07-13";
  newer.received_at = "2026-07-13T08:00:01.000Z";
  await writeFile(path.join(root, "events.jsonl"), `${[older, newer].map(JSON.stringify).join("\n")}\n`);

  const report = await summarizeTelemetryFiles({ root, to: "2026-07-12" });

  assert.equal(report.coverage.latest_received_at, "2026-07-12T08:00:01.000Z");
  assert.equal(report.data_sources.events.latest_received_at, "2026-07-13T08:00:01.000Z");
  assert.ok(report.data_sources.events.receive_lag_seconds < report.coverage.latest_received_delay_seconds);
});

test("CLI defaults to the latest 30 complete Asia Shanghai days", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-cli-default-window-"));
  const script = fileURLToPath(new URL("../scripts/summarize-telemetry.mjs", import.meta.url));
  const { stdout } = await execFileAsync(process.execPath, [script, root]);
  const report = JSON.parse(stdout);
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const yesterday = new Date(`${today}T12:00:00.000Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const from = new Date(yesterday);
  from.setUTCDate(from.getUTCDate() - 29);

  assert.equal(report.range.to, yesterday.toISOString().slice(0, 10));
  assert.equal(report.range.from, from.toISOString().slice(0, 10));
});

test("summary script reports downloads, first observations, and update state relations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-update-summary-"));
  const downloadsRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-download-summary-"));
  await writeFile(path.join(root, "events.jsonl"), [
    JSON.stringify(installationEvent("install-mac", "mac-1")),
    JSON.stringify(baseEvent("install-win", "win-1", "git_leaf.installation.observed", {
      reason: "first_observed",
    }, { platform: "win32" })),
    JSON.stringify(updateEvent({ eventId: "available-mac", state: "available", fromVersion: "1.10.0", toVersion: "1.11.0", appVersion: "1.10.0", occurredAt: "2026-07-12T08:01:00.000Z" })),
    JSON.stringify(updateEvent({ eventId: "downloaded-mac", state: "downloaded", fromVersion: "1.10.0", toVersion: "1.11.0", appVersion: "1.10.0", occurredAt: "2026-07-12T08:02:00.000Z" })),
    JSON.stringify(updateEvent({ eventId: "started-mac", state: "install_started", fromVersion: "1.10.0", toVersion: "1.11.0", appVersion: "1.10.0", occurredAt: "2026-07-12T08:03:00.000Z" })),
    JSON.stringify(updateEvent({ eventId: "completed-mac", state: "completed", fromVersion: "1.10.0", toVersion: "1.11.0", appVersion: "1.11.0", occurredAt: "2026-07-12T08:04:00.000Z" })),
    JSON.stringify(updateEvent({
      eventId: "failed-mac",
      state: "failed",
      fromVersion: "1.10.0",
      toVersion: null,
      appVersion: "1.10.0",
      occurredAt: "2026-07-12T08:05:00.000Z",
      properties: { error_code: "network", stage: "check" },
    })),
    JSON.stringify(updateEvent({
      eventId: "available-win",
      installId: "win-1",
      state: "available",
      fromVersion: "1.10.0",
      toVersion: "1.11.0",
      appVersion: "1.10.0",
      occurredAt: "2026-07-12T08:06:00.000Z",
      platform: "win32",
    })),
    "",
  ].join("\n"));
  await writeFile(path.join(downloadsRoot, "downloads.jsonl"), [
    JSON.stringify(downloadEvent("download-1", "darwin-universal", "dmg", 120)),
    JSON.stringify(downloadEvent("download-2", "win32-x64", "zip", 80)),
    "",
  ].join("\n"));

  const report = await summarizeTelemetryFiles({ root, downloadsRoot });

  assert.equal(report.downloads.requests, 2);
  assert.equal(report.downloads.log_files, 1);
  assert.equal(report.downloads.bytes, 200);
  assert.deepEqual(report.downloads.by_platform, {
    "darwin-universal": { bytes: 120, requests: 1 },
    "win32-x64": { bytes: 80, requests: 1 },
  });
  assert.equal(report.installations.observed, 2);
  assert.deepEqual(report.installations.first_observed_by_date, { "2026-07-12": 2 });
  assert.deepEqual(report.installations.first_observed_by_platform, { darwin: 1, win32: 1 });
  assert.deepEqual(report.updates.installations_by_state, {
    available: 2,
    completed: 1,
    downloaded: 1,
    failed: 1,
    install_started: 1,
  });
  assert.deepEqual(report.updates.failures, {
    by_error_code: { network: { events: 1, installations: 1 } },
    by_stage: { check: { events: 1, installations: 1 } },
    by_app_version: { "1.10.0": { events: 1, installations: 1 } },
    by_platform: { darwin: { events: 1, installations: 1 } },
  });
  assert.deepEqual(report.updates.paths_by_state, {
    available: 2,
    completed: 1,
    downloaded: 1,
    install_started: 1,
  });
  assert.deepEqual(report.updates.relations, {
    available_paths: 2,
    downloaded_with_prior_available: 1,
    downloaded_without_prior_available: 0,
    install_started_with_prior_downloaded: 1,
    install_started_without_prior_downloaded: 0,
    completed_with_prior_lifecycle: 1,
    completed_without_prior_lifecycle: 0,
  });
  assert.match(telemetryReportMarkdown(report), /下载页安装包请求：2/);
  assert.match(telemetryReportMarkdown(report), /更新状态关系/);
  assert.match(telemetryReportMarkdown(report), /不是用户行为漏斗或自动更新成功率/);
  const markdown = telemetryReportMarkdown(report);
  assert.match(markdown, /## 数据源健康/);
  assert.match(markdown, /事件日志文件.*1/);
  assert.match(markdown, /下载日志文件.*1/);
  assert.match(markdown, /事件按本地日期筛选/);
  assert.match(markdown, /下载按 UTC 日期筛选/);
  assert.match(markdown, /### 下载页请求（UTC 日期）/);
  assert.match(markdown, /制品文件大小合计：200 字节（非实际传输流量）/);
  assert.doesNotMatch(markdown, /制品声明大小/);
  assert.match(markdown, /### 首次观察安装实例（本地日期）/);
  assert.doesNotMatch(markdown, /\| 日期 \| 下载请求 \| 首次观察安装实例 \|/);
  assert.doesNotMatch(markdown, /首次安装/);
  assert.match(markdown, /## 更新检查/);
  assert.match(markdown, /failed_check/);
  assert.match(markdown, /按错误码/);
  assert.match(markdown, /按 App 版本/);
  assert.match(markdown, /按平台/);
  assert.match(markdown, /## 活跃与功能/);
  assert.match(markdown, /模式分钟/);
  assert.match(markdown, /与上一份报告的绝对增量：不可计算/);
  assert.doesNotMatch(markdown, /\[object Object\]/);
});

function baseEvent(eventId, installId, eventName, properties, { platform = "darwin", occurredAt = "2026-07-12T08:00:00.000Z" } = {}) {
  return {
    schema_version: 1,
    event_id: identifier(eventId),
    install_id: identifier(installId),
    event_name: eventName,
    occurred_at: occurredAt,
    local_date: "2026-07-12",
    timezone_offset_minutes: 480,
    app: {
      version: "1.5.0",
      build_id: "release-1.5.0",
      channel: "stable",
      platform,
      arch: "arm64",
      os_version_major: "15",
    },
    properties,
    received_at: "2026-07-12T08:00:01.000Z",
  };
}

function installationEvent(eventId, installId) {
  return baseEvent(eventId, installId, "git_leaf.installation.observed", {
    reason: "first_observed",
    device_name: "Mac",
  });
}

function dailyEvent({
  eventId,
  installId = "install-1",
  summaryDate = "2026-07-12",
  includeSummaryDate = true,
  summaryId = summaryIdFor(identifier(installId), summaryDate),
  revision,
  activeMinutes,
  featureCounts = [{ feature_id: "navigation.file_search", count: 3 }],
  occurredAt = "2026-07-12T08:00:00.000Z",
  envelopeDate = occurredAt.slice(0, 10),
}) {
  const event = baseEvent(eventId, installId, "git_leaf.daily.summary", {
    summary_id: summaryId,
    ...(includeSummaryDate ? { summary_date: summaryDate } : {}),
    revision,
    launch_count: 2,
    launch_counts_by_entry_kind: { manual: 2 },
    active_minutes: activeMinutes,
    repository_open_count: 1,
    repository_switch_count: 0,
    distinct_repository_count: 1,
    rolling_30d_distinct_repository_count: 1,
    worktree_switch_count: 0,
    mode_minutes: { preview: activeMinutes, source: 0, live: 0 },
    feature_counts: featureCounts,
  }, { occurredAt });
  event.local_date = envelopeDate;
  return event;
}

function summaryIdFor(installId, summaryDate, length = 32) {
  return createHash("sha256").update(`${installId}:${summaryDate}`).digest("hex").slice(0, length);
}

function identifier(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, "-").padEnd(16, "0");
}

function updateEvent({
  eventId = "update-1",
  installId = "install-1",
  state = "completed",
  fromVersion = "1.4.0",
  toVersion = "1.5.0",
  occurredAt = "2026-07-12T08:00:00.000Z",
  platform = "darwin",
  appVersion = "1.5.0",
  properties = {},
} = {}) {
  const event = baseEvent(eventId, installId, "git_leaf.update.state_changed", {
    state,
    trigger: "automatic",
    from_version: fromVersion,
    to_version: toVersion,
    ...properties,
  }, { occurredAt, platform });
  event.app.version = appVersion;
  return event;
}

function downloadEvent(downloadId, platform, artifact, bytes, version = "1.5.0") {
  return {
    schema_version: 1,
    download_id: downloadId,
    event_name: "git_leaf.distribution.downloaded",
    occurred_at: "2026-07-12T08:00:00.000Z",
    channel: "stable",
    platform,
    version,
    artifact,
    source: "download_page",
    bytes,
  };
}
