#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

// Metric meanings and logical consistency rules are defined by
// docs/app-usage-analytics-spec.md. Update the spec before changing this report contract.

const EVENT_NAMES = new Set([
  "git_leaf.installation.observed",
  "git_leaf.update.state_changed",
  "git_leaf.daily.summary",
]);
const ENTRY_KINDS = new Set(["manual", "deep_link", "update_restart", "windows_bootstrap", "unknown"]);
const UPDATE_STATES = new Set([
  "check_started", "current", "available", "downloaded", "skipped",
  "install_started", "completed", "failed",
]);
const UPDATE_TRIGGERS = new Set(["automatic", "manual", "windows_bootstrap"]);
const UPDATE_ERROR_CODES = new Set([
  "network", "manifest", "signature", "copy", "launch", "downgrade_blocked", "unknown",
]);
const UPDATE_FAILURE_STAGES = new Set(["check", "download", "prepare", "install", "launch", "unknown"]);
const RESULT_VALUES = new Set(["success", "cancel", "error"]);
const DEEP_LINK_FAILURE_REASONS = new Set([
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
]);
const FEATURE_DIMENSIONS = new Map([
  ["navigation.file_search", {}],
  ["navigation.document_search", {}],
  ["navigation.frontmatter_filter", {
    action: new Set(["apply", "clear"]),
    filter_count_bucket: new Set(["1", "2_3", "4_plus"]),
  }],
  ["navigation.worktree_switch", { result: RESULT_VALUES }],
  ["navigation.deep_link", {
    type: new Set(["repository", "exact_worktree"]),
    result: RESULT_VALUES,
    failure_reason: DEEP_LINK_FAILURE_REASONS,
  }],
  ["editing.activity", { mode: new Set(["source", "live"]) }],
  ["editing.slash_command", { command_category: new Set(["markdown", "mdx_component", "media"]) }],
  ["editing.frontmatter", {
    action: new Set(["add", "edit", "delete"]),
    result: RESULT_VALUES,
  }],
  ["editing.image_paste", { result: RESULT_VALUES }],
  ["editing.markdown_to_mdx", { result: RESULT_VALUES }],
  ["output.pdf_export", { result: RESULT_VALUES }],
  ["git.sync", {
    strategy: new Set(["guarded_live_v1"]),
    result: RESULT_VALUES,
    file_count_bucket: new Set(["1", "2_5", "6_20", "21_plus"]),
    drift_kind: new Set(["none", "content_changed", "head_changed", "post_commit_changed"]),
    retry_bucket: new Set(["0", "1", "2_plus"]),
    duration_bucket: new Set(["under_1s", "1_3s", "3_10s", "over_10s"]),
    error_code: new Set([
      "identity_missing", "origin_missing", "conflict", "nothing_selected",
      "commit_failed", "workspace_changed", "head_changed", "pull_failed",
      "push_failed", "unknown",
    ]),
  }],
  ["github.open", { result: RESULT_VALUES }],
  ["line_reference.copy", { line_count_bucket: new Set(["1", "2_5", "6_plus"]) }],
]);

export async function summarizeTelemetryFiles({
  root,
  downloadsRoot = "",
  from = "",
  to = "",
  platform = "",
  appVersion = "",
  artifactVersion = "",
  version,
  eventName = "",
  now = () => new Date(),
} = {}) {
  if (version !== undefined) {
    throw new Error("The ambiguous version filter was removed; use appVersion and artifactVersion independently.");
  }
  validateSummaryFilters({ from, to, platform, appVersion, artifactVersion, eventName });
  const eventFileSource = await telemetryFileSource(root);
  const downloadFileSource = await telemetryFileSource(downloadsRoot);
  const files = eventFileSource.files;
  const downloadFiles = downloadFileSource.files;
  const eventIds = new Map();
  const conflictingEventIds = new Set();
  let invalidLines = 0;
  const invalidEventReasons = {};
  let duplicateEventIds = 0;
  let conflictingDuplicateEventIds = 0;
  let invalidDownloadLines = 0;
  let duplicateDownloadIds = 0;
  let conflictingDuplicateDownloadIds = 0;
  const invalidDownloadReasons = {};
  const downloadIds = new Map();
  const conflictingDownloadIds = new Set();

  for (const file of files) {
    try {
      for await (const line of linesFromFile(file)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event;
        try {
          event = JSON.parse(trimmed);
        } catch {
          invalidLines += 1;
          increment(invalidEventReasons, "invalid_json");
          continue;
        }
        const validationError = telemetryEventValidationError(event);
        if (validationError) {
          invalidLines += 1;
          increment(invalidEventReasons, validationError);
          continue;
        }
        const fingerprint = eventRetryFingerprint(event);
        if (eventIds.has(event.event_id)) {
          duplicateEventIds += 1;
          if (eventIds.get(event.event_id).fingerprint !== fingerprint) conflictingEventIds.add(event.event_id);
          continue;
        }
        eventIds.set(event.event_id, { fingerprint, record: event });
      }
    } catch (error) {
      eventFileSource.error = error?.code || "read_failed";
      break;
    }
  }
  conflictingDuplicateEventIds = conflictingEventIds.size;
  const allEvents = eventFileSource.error ? [] : [...eventIds.entries()]
    .filter(([eventId]) => !conflictingEventIds.has(eventId))
    .map(([, value]) => value.record);

  const dailySummaryDateResolution = resolveDailySummaryDates(allEvents);
  const analyzableEvents = dailySummaryDateResolution.events;
  const dailySelection = selectLatestDailySummaries(analyzableEvents.filter((event) =>
    event.event_name === "git_leaf.daily.summary" && eventMatchesScope(event, { from, to, eventName })
  ));
  const scopedLatestDailyEvents = [...dailySelection.latest.values()].filter((event) =>
    eventMatchesScope(event, { platform, appVersion })
  );
  const events = [
    ...analyzableEvents.filter((event) =>
      event.event_name !== "git_leaf.daily.summary" &&
      eventMatchesScope(event, { from, to, platform, appVersion, eventName })
    ),
    ...scopedLatestDailyEvents,
  ];

  for (const file of downloadFiles) {
    try {
      for await (const line of linesFromFile(file)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let download;
        try {
          download = JSON.parse(trimmed);
        } catch {
          invalidDownloadLines += 1;
          increment(invalidDownloadReasons, "invalid_json");
          continue;
        }
        const validationError = downloadValidationError(download);
        if (validationError) {
          invalidDownloadLines += 1;
          increment(invalidDownloadReasons, validationError);
          continue;
        }
        const fingerprint = canonicalJson(download);
        if (downloadIds.has(download.download_id)) {
          duplicateDownloadIds += 1;
          if (downloadIds.get(download.download_id).fingerprint !== fingerprint) {
            conflictingDownloadIds.add(download.download_id);
          }
          continue;
        }
        downloadIds.set(download.download_id, { fingerprint, record: download });
      }
    } catch (error) {
      downloadFileSource.error = error?.code || "read_failed";
      break;
    }
  }
  conflictingDuplicateDownloadIds = conflictingDownloadIds.size;
  const allDownloads = downloadFileSource.error ? [] : [...downloadIds.entries()]
    .filter(([downloadId]) => !conflictingDownloadIds.has(downloadId))
    .map(([, value]) => value.record);
  const downloads = allDownloads.filter((download) => downloadMatchesScope(download, {
    from, to, platform, artifactVersion, eventName,
  }));

  const latestDailyEvents = scopedLatestDailyEvents;

  const installations = new Set();
  const firstObservedDates = {};
  const firstObservedPlatforms = new Map();
  const firstObservedVersions = new Map();
  const updateEvents = [];
  for (const event of events) {
    if (event.event_name === "git_leaf.update.state_changed") {
      updateEvents.push(event);
    }
  }
  const firstObservedByInstall = new Map();
  for (const event of allEvents) {
    if (event.event_name !== "git_leaf.installation.observed" || event.properties.reason !== "first_observed") continue;
    const current = firstObservedByInstall.get(event.install_id);
    if (!current || compareEventTime(event, current) < 0) firstObservedByInstall.set(event.install_id, event);
  }
  for (const event of firstObservedByInstall.values()) {
    if (!eventMatchesScope(event, { from, to, platform, appVersion, eventName })) continue;
    installations.add(event.install_id);
    const dateInstallations = firstObservedDates[event.local_date] ?? new Set();
    dateInstallations.add(event.install_id);
    firstObservedDates[event.local_date] = dateInstallations;
    addInstallationToGroup(firstObservedPlatforms, event.app.platform, event.install_id);
    addInstallationToGroup(firstObservedVersions, event.app.version, event.install_id);
  }
  const updateReport = summarizeUpdateEvents(updateEvents);
  const eventMetricsAvailable = telemetrySourceMetricsAvailable(eventFileSource);
  const downloadMetricsAvailable = telemetrySourceMetricsAvailable(downloadFileSource);
  const downloadReport = downloadMetricsAvailable
    ? { status: "available", ...summarizeDownloads(downloads, downloadFiles.length) }
    : unavailableDownloadReport(downloadFiles.length);

  const inconsistentDailyEvents = latestDailyEvents.filter((event) => !dailySummaryIsBalanced(event));
  const inconsistentDailyDates = new Set(inconsistentDailyEvents.map(eventMetricDate));
  const inconsistentDailyCountsByDate = new Map();
  for (const event of inconsistentDailyEvents) {
    const date = eventMetricDate(event);
    inconsistentDailyCountsByDate.set(date, (inconsistentDailyCountsByDate.get(date) ?? 0) + 1);
  }
  const conflictingDailyCountsByDate = new Map();
  for (const excludedGroup of dailySelection.excludedGroups) {
    const scopedDates = new Set(excludedGroup
      .filter((event) => eventMatchesScope(event, { platform, appVersion }))
      .map(eventMetricDate));
    for (const date of scopedDates) {
      conflictingDailyCountsByDate.set(date, (conflictingDailyCountsByDate.get(date) ?? 0) + 1);
    }
  }
  const conflictingDailyDates = new Set(conflictingDailyCountsByDate.keys());
  const eligibleDailyEvents = latestDailyEvents.filter(dailySummaryIsBalanced);
  const aggregateDailyStatus = inconsistentDailyEvents.length === 0 && conflictingDailyDates.size === 0
    ? "complete"
    : eligibleDailyEvents.length === 0 ? "unavailable_quality" : "partial_quality";
  const activityDates = new Map();
  const featureStats = new Map();
  const activeVersions = new Map();
  const engagedVersions = new Map();
  const repositoryCounts = {};
  const modeMinutes = { preview: 0, source: 0, live: 0 };
  const dailyCoverageDates = new Set(latestDailyEvents.map(eventMetricDate));
  let repositoryMetricsUnavailable = false;
  for (const event of eligibleDailyEvents) {
    const properties = event.properties ?? {};
    const date = eventMetricDate(event);
    const featureCounts = Array.isArray(properties.feature_counts) ? properties.feature_counts : [];
    const balance = dailySummaryBalance(event);
    const engaged = properties.active_minutes > 0 || featureCounts.some((counter) => counter.count > 0);
    const active = properties.launch_count > 0 || engaged;
    const day = activityDates.get(date) ?? {
      installations: new Set(),
      engagedInstallations: new Set(),
      activeMinutes: 0,
      launches: 0,
      activeUnavailable: false,
      launchesUnavailable: false,
      status: "complete",
      excludedInconsistentSummaries: 0,
      excludedConflictingSummaries: 0,
    };
    if (balance.activeMinutesMismatch) {
      day.activeUnavailable = true;
    } else {
      if (active) day.installations.add(event.install_id);
      if (engaged) day.engagedInstallations.add(event.install_id);
      day.activeMinutes += properties.active_minutes;
    }
    if (balance.launchCountMismatch) day.launchesUnavailable = true;
    else day.launches += properties.launch_count;
    activityDates.set(date, day);

    if (active && !balance.activeMinutesMismatch) {
      const version = String(event.app?.version ?? "unknown");
      const versionInstalls = activeVersions.get(version) ?? new Set();
      versionInstalls.add(event.install_id);
      activeVersions.set(version, versionInstalls);
    }
    if (engaged && !balance.activeMinutesMismatch) {
      const version = String(event.app?.version ?? "unknown");
      const versionInstalls = engagedVersions.get(version) ?? new Set();
      versionInstalls.add(event.install_id);
      engagedVersions.set(version, versionInstalls);
    }

    if (balance.repositoriesExceedOpens || balance.repositoriesExceedRolling) {
      repositoryMetricsUnavailable = true;
    } else {
      const repoCount = String(properties.distinct_repository_count);
      repositoryCounts[repoCount] = (repositoryCounts[repoCount] ?? 0) + 1;
    }
    if (!balance.activeMinutesMismatch) {
      for (const mode of Object.keys(modeMinutes)) modeMinutes[mode] += properties.mode_minutes[mode];
    }

    for (const counter of featureCounts) {
      const dimensions = reportedFeatureDimensions(counter.feature_id, counter.dimensions ?? {});
      const key = featureCounterKey(counter.feature_id, dimensions);
      const feature = featureStats.get(key) ?? {
        feature_id: counter.feature_id,
        dimensions,
        count: 0,
        installations: new Set(),
      };
      feature.count += counter.count;
      feature.installations.add(event.install_id);
      featureStats.set(key, feature);
    }
  }
  for (const date of inconsistentDailyDates) {
    const existing = activityDates.get(date);
    const day = existing ?? {
      installations: new Set(),
      engagedInstallations: new Set(),
      activeMinutes: 0,
      launches: 0,
      activeUnavailable: true,
      launchesUnavailable: true,
      status: "unavailable_quality",
      excludedInconsistentSummaries: 0,
      excludedConflictingSummaries: 0,
    };
    if (existing) day.status = "partial_quality";
    day.excludedInconsistentSummaries = inconsistentDailyCountsByDate.get(date);
    activityDates.set(date, day);
  }
  for (const date of conflictingDailyDates) {
    const existing = activityDates.get(date);
    const day = existing ?? {
      installations: new Set(),
      engagedInstallations: new Set(),
      activeMinutes: 0,
      launches: 0,
      activeUnavailable: true,
      launchesUnavailable: true,
      status: "unavailable_quality",
      excludedInconsistentSummaries: 0,
      excludedConflictingSummaries: 0,
    };
    if (existing) day.status = "partial_quality";
    day.excludedConflictingSummaries = conflictingDailyCountsByDate.get(date);
    activityDates.set(date, day);
  }

  const reportedModeMinutes = aggregateDailyStatus === "unavailable_quality"
    ? { preview: null, source: null, live: null }
    : modeMinutes;
  const generatedAt = now().toISOString();
  const coverage = telemetryCoverage(events, downloads, generatedAt);
  const eventSourceFreshness = telemetryFreshness(allEvents, generatedAt);
  const eventDataSource = dataSourceStatus({
    configured: eventFileSource.configured,
    missing: eventFileSource.missing,
    error: eventFileSource.error,
    files: files.length,
    validRecords: allEvents.length,
    selectedRecords: events.length,
    invalidRecords: invalidLines,
    duplicateRecords: duplicateEventIds,
    ...eventSourceFreshness,
  });
  const downloadDataSource = dataSourceStatus({
    configured: downloadFileSource.configured,
    missing: downloadFileSource.missing,
    error: downloadFileSource.error,
    files: downloadFiles.length,
    validRecords: allDownloads.length,
    selectedRecords: downloads.length,
    invalidRecords: invalidDownloadLines,
    duplicateRecords: duplicateDownloadIds,
  });
  const todayLocalDate = dateInTimeZone(generatedAt, "Asia/Shanghai");
  const yesterdayLocalDate = shiftDate(todayLocalDate, -1);
  const reportedActivityDates = new Set(activityDates.keys());
  if (from && to) {
    for (let date = from; date <= to; date = shiftDate(date, 1)) reportedActivityDates.add(date);
  }
  const activityByDate = Object.fromEntries([...reportedActivityDates]
    .sort((left, right) => left.localeCompare(right))
    .map((date) => {
      const value = activityDates.get(date);
      return [date, {
        active_installations: !value || value.activeUnavailable ? null : value.installations.size,
        engaged_installations: !value || value.activeUnavailable ? null : value.engagedInstallations.size,
        weekly_active_installations: rollingActiveMetric(activityDates, dailyCoverageDates, date, 7, {
          partialValueAllowed: false,
        }),
        monthly_active_installations: rollingActiveMetric(activityDates, dailyCoverageDates, date, 30, {
          partialValueAllowed: true,
        }),
        active_minutes: !value || value.activeUnavailable ? null : value.activeMinutes,
        launches: !value || value.launchesUnavailable ? null : value.launches,
        status: value?.status ?? "unavailable_coverage",
        freshness_status: dailyFreshnessStatus(date, { todayLocalDate, yesterdayLocalDate }),
        excluded_inconsistent_summaries: value?.excludedInconsistentSummaries ?? 0,
        excluded_conflicting_summaries: value?.excludedConflictingSummaries ?? 0,
      }];
    }));
  return {
    generated_at: generatedAt,
    range: {
      from: from || null,
      to: to || null,
      files: files.length,
      download_files: downloadFiles.length,
      platform: platform || null,
      app_version: appVersion || null,
      artifact_version: artifactVersion || null,
      event_name: eventName || null,
      event_date_semantics: "local_date; daily.summary uses summary_date",
      download_date_semantics: "occurred_at_utc_date",
    },
    reporting_window: {
      timezone: "Asia/Shanghai",
      recent_30_complete_days_from: shiftDate(yesterdayLocalDate, -29),
      recent_30_complete_days_to: yesterdayLocalDate,
      yesterday: yesterdayLocalDate,
      today_incomplete: todayLocalDate,
    },
    coverage,
    data_sources: {
      gateway_service: { status: "not_checked" },
      events: eventDataSource,
      downloads: downloadDataSource,
    },
    installations: eventMetricsAvailable ? {
      status: "available",
      observed: installations.size,
      first_observed_by_date: Object.fromEntries(Object.entries(firstObservedDates)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, values]) => [date, values.size])),
      first_observed_by_platform: installationGroups(firstObservedPlatforms),
      first_observed_by_version: installationGroups(firstObservedVersions),
    } : unavailableInstallationReport(),
    downloads: downloadReport,
    updates: eventMetricsAvailable ? { status: "available", ...updateReport } : unavailableUpdateReport(),
    activity: eventMetricsAvailable ? {
      status: "available",
      contract_version: "launch_based_v2",
      by_date: activityByDate,
      active_versions: aggregateDailyStatus === "unavailable_quality" ? null : Object.fromEntries([...activeVersions.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([version, installs]) => [version, installs.size])),
      active_versions_status: aggregateDailyStatus,
      engaged_versions: aggregateDailyStatus === "unavailable_quality" ? null : Object.fromEntries([...engagedVersions.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([version, installs]) => [version, installs.size])),
      engaged_versions_status: aggregateDailyStatus,
      mode_minutes: reportedModeMinutes,
      mode_minutes_status: aggregateDailyStatus,
    } : unavailableActivityReport(),
    repositories: eventMetricsAvailable ? {
      daily_distinct_count_distribution: aggregateDailyStatus === "unavailable_quality" || repositoryMetricsUnavailable
        ? null
        : sortedObject(repositoryCounts, { numeric: true }),
      status: repositoryMetricsUnavailable ? "unavailable_quality" : aggregateDailyStatus,
    } : { daily_distinct_count_distribution: null, status: "unavailable_source" },
    features: eventMetricsAvailable ? [...featureStats.values()]
      .sort((left, right) => featureCounterKey(left.feature_id, left.dimensions)
        .localeCompare(featureCounterKey(right.feature_id, right.dimensions)))
      .map((value) => ({
        feature_id: value.feature_id,
        dimensions: value.dimensions,
        count: value.count,
        active_installations: value.installations.size,
      })) : null,
    features_status: eventMetricsAvailable ? aggregateDailyStatus : "unavailable_source",
    data_quality: {
      invalid_lines: eventMetricsAvailable ? invalidLines : null,
      duplicate_event_ids: eventMetricsAvailable ? duplicateEventIds : null,
      conflicting_duplicate_event_ids: eventMetricsAvailable ? conflictingDuplicateEventIds : null,
      invalid_event_reasons: eventMetricsAvailable ? sortedObject(invalidEventReasons) : null,
      invalid_download_lines: downloadMetricsAvailable ? invalidDownloadLines : null,
      duplicate_download_ids: downloadMetricsAvailable ? duplicateDownloadIds : null,
      conflicting_duplicate_download_ids: downloadMetricsAvailable ? conflictingDuplicateDownloadIds : null,
      invalid_download_reasons: downloadMetricsAvailable ? sortedObject(invalidDownloadReasons) : null,
      superseded_daily_summaries: eventMetricsAvailable ? dailySelection.superseded : null,
      duplicate_daily_summary_revisions: eventMetricsAvailable ? dailySelection.duplicates : null,
      conflicting_daily_summary_revisions: eventMetricsAvailable ? dailySelection.conflicts : null,
      conflicting_daily_summary_identities: eventMetricsAvailable ? dailySelection.identityConflicts : null,
      excluded_conflicting_daily_summaries: eventMetricsAvailable ? dailySelection.excluded : null,
      daily_summary_inconsistencies: eventMetricsAvailable ? dailySummaryInconsistencies(latestDailyEvents) : null,
      daily_summary_inconsistent_dates: eventMetricsAvailable ? [...inconsistentDailyDates].sort() : null,
      daily_summary_conflicting_dates: eventMetricsAvailable ? [...conflictingDailyDates].sort() : null,
      excluded_inconsistent_daily_summaries: eventMetricsAvailable ? inconsistentDailyEvents.length : null,
      daily_summary_dates: eventMetricsAvailable ? dailySummaryDateResolution.quality : null,
      update_path_window_truncation_possible: eventMetricsAvailable
        ? Boolean(from && updateEvents.length > 0)
        : null,
    },
    comparison: {
      status: "unavailable",
      reason: "no_comparable_baseline",
    },
  };
}

function telemetryCoverage(events, downloads, generatedAt) {
  const eventDates = events.map(eventMetricDate).filter(Boolean).sort();
  const downloadDates = downloads
    .map((download) => download.occurred_at?.slice(0, 10))
    .filter(Boolean)
    .sort();
  const receivedAt = events
    .map((event) => event.received_at)
    .filter((value) => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort();
  const latestReceivedAt = receivedAt.at(-1) ?? null;
  return {
    event_local_date_from: eventDates[0] ?? null,
    event_local_date_to: eventDates.at(-1) ?? null,
    download_utc_date_from: downloadDates[0] ?? null,
    download_utc_date_to: downloadDates.at(-1) ?? null,
    latest_received_at: latestReceivedAt,
    latest_received_delay_seconds: latestReceivedAt
      ? Math.max(0, Math.round((Date.parse(generatedAt) - Date.parse(latestReceivedAt)) / 1000))
      : null,
  };
}

function dataSourceStatus({
  configured, missing, error, files, validRecords, selectedRecords, invalidRecords, duplicateRecords,
  latestReceivedAt = null, receiveLagSeconds = null,
}) {
  let status;
  if (!configured) status = "not_configured";
  else if (missing) status = "missing";
  else if (error) status = "read_error";
  else if (files === 0) status = "empty";
  else status = "present";
  const scopeStatus = status !== "present"
    ? "unavailable"
    : validRecords === 0 ? "no_valid_records" : selectedRecords === 0 ? "no_records_in_scope" : "selected_records";
  const validationStatus = status !== "present"
    ? "unavailable"
    : invalidRecords > 0 && validRecords === 0 ? "invalid_only" : invalidRecords > 0 ? "mixed" : "valid";
  return {
    status,
    scope_status: scopeStatus,
    validation_status: validationStatus,
    files,
    valid_deduplicated_records: status === "present" ? validRecords : null,
    selected_records: status === "present" ? selectedRecords : null,
    invalid_records: status === "present" ? invalidRecords : null,
    duplicate_records: status === "present" ? duplicateRecords : null,
    latest_received_at: status === "present" ? latestReceivedAt : null,
    receive_lag_seconds: status === "present" ? receiveLagSeconds : null,
    ...(error ? { error } : {}),
  };
}

function telemetrySourceMetricsAvailable(source) {
  return source.configured && !source.missing && !source.error && source.files.length > 0;
}

function unavailableInstallationReport() {
  return {
    status: "unavailable_source",
    observed: null,
    first_observed_by_date: null,
    first_observed_by_platform: null,
    first_observed_by_version: null,
  };
}

function unavailableDownloadReport(logFiles) {
  return {
    status: "unavailable_source",
    log_files: logFiles,
    requests: null,
    bytes: null,
    by_date: null,
    by_platform: null,
    by_version: null,
  };
}

function unavailableUpdateReport() {
  return {
    status: "unavailable_source",
    capability_scope: "app_version_gte_1.10.0",
    states: null,
    installations_by_state: null,
    strict_states: null,
    legacy_states: null,
    legacy_unknown: null,
    paths_by_state: null,
    by_date: null,
    by_platform: null,
    by_trigger: null,
    by_transition: null,
    failures: null,
    relations: null,
    quality: null,
  };
}

function unavailableActivityReport() {
  return {
    status: "unavailable_source",
    contract_version: "launch_based_v2",
    by_date: null,
    active_versions: null,
    active_versions_status: "unavailable_source",
    engaged_versions: null,
    engaged_versions_status: "unavailable_source",
    mode_minutes: null,
    mode_minutes_status: "unavailable_source",
  };
}

function telemetryFreshness(events, generatedAt) {
  const latestReceivedAt = events
    .map((event) => event.received_at)
    .sort()
    .at(-1) ?? null;
  return {
    latestReceivedAt,
    receiveLagSeconds: latestReceivedAt
      ? Math.max(0, Math.round((Date.parse(generatedAt) - Date.parse(latestReceivedAt)) / 1000))
      : null,
  };
}

function dateInTimeZone(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dailyFreshnessStatus(date, { todayLocalDate, yesterdayLocalDate }) {
  if (date === todayLocalDate) return "incomplete_today";
  if (date === yesterdayLocalDate) return "provisional_late_arrivals";
  return "historical";
}

function resolveDailySummaryDates(events) {
  const quality = {
    legacy_missing_explicit_date: 0,
    recovered: 0,
    unresolved: 0,
    envelope_date_shifted: 0,
  };
  const resolvedEvents = [];
  for (const event of events) {
    if (event.event_name !== "git_leaf.daily.summary") {
      resolvedEvents.push(event);
      continue;
    }
    let summaryDate = event.properties.summary_date;
    if (!summaryDate) {
      quality.legacy_missing_explicit_date += 1;
      summaryDate = recoverLegacySummaryDate(event);
      if (!summaryDate) {
        quality.unresolved += 1;
        continue;
      }
      quality.recovered += 1;
    }
    if (summaryDate !== event.local_date) quality.envelope_date_shifted += 1;
    resolvedEvents.push({ ...event, _effective_local_date: summaryDate });
  }
  return { events: resolvedEvents, quality };
}

function recoverLegacySummaryDate(event) {
  const candidates = [];
  const earliestCandidate = shiftCalendarMonths(event.local_date, -12);
  for (let candidate = event.local_date; candidate >= earliestCandidate; candidate = shiftDate(candidate, -1)) {
    if (dailySummaryId(event.install_id, candidate, event.properties.summary_id.length) === event.properties.summary_id) {
      candidates.push(candidate);
    }
  }
  return candidates.length === 1 ? candidates[0] : "";
}

function eventMetricDate(event) {
  return event._effective_local_date ?? event.local_date;
}

function eventMatchesScope(event, { from = "", to = "", platform = "", appVersion = "", eventName = "" } = {}) {
  const metricDate = eventMetricDate(event);
  return (!from || metricDate >= from) &&
    (!to || metricDate <= to) &&
    (!platform || eventPlatformMatches(event.app, platform)) &&
    (!appVersion || event.app.version === appVersion) &&
    (!eventName || event.event_name === eventName);
}

function validateSummaryFilters({ from, to, platform, appVersion, artifactVersion, eventName }) {
  if (from && !validCalendarDate(from)) throw new Error("from must be a valid YYYY-MM-DD date.");
  if (to && !validCalendarDate(to)) throw new Error("to must be a valid YYYY-MM-DD date.");
  if (from && to && from > to) throw new Error("from must not be after to.");
  if (platform && !["darwin", "darwin-universal", "darwin-arm64", "win32", "win32-x64"].includes(platform)) {
    throw new Error("platform must identify a supported App or artifact platform.");
  }
  if (appVersion && !validSemanticVersion(appVersion)) throw new Error("appVersion must be a semantic version.");
  if (artifactVersion && !validSemanticVersion(artifactVersion)) {
    throw new Error("artifactVersion must be a semantic version.");
  }
  if (eventName && !EVENT_NAMES.has(eventName) && eventName !== "git_leaf.distribution.downloaded") {
    throw new Error("eventName is not part of the telemetry contract.");
  }
}

function eventPlatformMatches(app, platform) {
  if (platform === "darwin") return app.platform === "darwin";
  if (platform === "darwin-universal") return app.platform === "darwin";
  if (platform === "darwin-arm64") return app.platform === "darwin" && app.arch === "arm64";
  if (platform === "win32") return app.platform === "win32";
  if (platform === "win32-x64") return app.platform === "win32" && app.arch === "x64";
  return false;
}

function downloadMatchesScope(download, {
  from = "", to = "", platform = "", artifactVersion = "", eventName = "",
} = {}) {
  const date = download.occurred_at.slice(0, 10);
  return (!from || date >= from) && (!to || date <= to) &&
    (!platform || downloadPlatformMatches(download.platform, platform)) &&
    (!artifactVersion || download.version === artifactVersion) &&
    (!eventName || eventName === download.event_name);
}

function compareEventTime(left, right) {
  const timeDifference = Date.parse(left.occurred_at) - Date.parse(right.occurred_at);
  return timeDifference || left.event_id.localeCompare(right.event_id);
}

function selectLatestDailySummaries(events) {
  const groups = new Map();
  for (const event of events) {
    if (event.event_name !== "git_leaf.daily.summary") continue;
    const summaryId = event.properties.summary_id;
    const revisions = groups.get(summaryId) ?? new Map();
    const revisionEvents = revisions.get(event.properties.revision) ?? [];
    revisionEvents.push(event);
    revisions.set(event.properties.revision, revisionEvents);
    groups.set(summaryId, revisions);
  }
  const latest = new Map();
  let superseded = 0;
  let duplicates = 0;
  let conflicts = 0;
  let identityConflicts = 0;
  let excluded = 0;
  const excludedGroups = [];
  for (const [summaryId, revisions] of groups) {
    const all = [...revisions.values()].flat();
    const identities = new Set(all.map((event) => `${event.install_id}|${eventMetricDate(event)}`));
    const identityConflict = identities.size > 1;
    if (identityConflict) identityConflicts += 1;
    const highestRevision = Math.max(...revisions.keys());
    for (const [revision, revisionEvents] of revisions) {
      if (revision < highestRevision) superseded += revisionEvents.length;
      const fingerprints = new Set(revisionEvents.map(dailySummaryFingerprint));
      if (fingerprints.size > 1) conflicts += 1;
      else if (revisionEvents.length > 1) duplicates += revisionEvents.length - 1;
    }
    const candidates = revisions.get(highestRevision);
    const latestConflict = new Set(candidates.map(dailySummaryFingerprint)).size > 1;
    if (identityConflict || latestConflict) {
      excluded += 1;
      excludedGroups.push(all);
      continue;
    }
    latest.set(summaryId, candidates[0]);
  }
  return { latest, superseded, duplicates, conflicts, identityConflicts, excluded, excludedGroups };
}

function dailySummaryFingerprint(event) {
  const { summary_date: _summaryDate, ...properties } = event.properties;
  return canonicalJson({
    install_id: event.install_id,
    summary_date: eventMetricDate(event),
    app: event.app,
    properties,
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function eventRetryFingerprint(event) {
  const { received_at: _receivedAt, ...clientEvent } = event;
  return canonicalJson(clientEvent);
}

function dailySummaryInconsistencies(events) {
  const result = {
    launch_count_mismatch: 0,
    active_minutes_mismatch: 0,
    distinct_repositories_exceed_opens: 0,
    daily_repositories_exceed_rolling_30d: 0,
  };
  for (const event of events) {
    const balance = dailySummaryBalance(event);
    if (balance.launchCountMismatch) result.launch_count_mismatch += 1;
    if (balance.activeMinutesMismatch) result.active_minutes_mismatch += 1;
    if (balance.repositoriesExceedOpens) result.distinct_repositories_exceed_opens += 1;
    if (balance.repositoriesExceedRolling) result.daily_repositories_exceed_rolling_30d += 1;
  }
  return result;
}

function dailySummaryBalance(event) {
  const properties = event.properties;
  const launchKinds = Object.values(properties.launch_counts_by_entry_kind)
    .reduce((sum, value) => sum + value, 0);
  const modeMinutes = Object.values(properties.mode_minutes)
    .reduce((sum, value) => sum + value, 0);
  return {
    launchCountMismatch: launchKinds !== properties.launch_count,
    activeMinutesMismatch: modeMinutes !== properties.active_minutes,
    repositoriesExceedOpens: properties.distinct_repository_count > properties.repository_open_count,
    repositoriesExceedRolling:
      properties.distinct_repository_count > properties.rolling_30d_distinct_repository_count,
  };
}

function dailySummaryIsBalanced(event) {
  return Object.values(dailySummaryBalance(event)).every((value) => value === false);
}

function addInstallationToGroup(groups, key, installId) {
  const installations = groups.get(key) ?? new Set();
  installations.add(installId);
  groups.set(key, installations);
}

function installationGroups(groups) {
  return Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, installations]) => [key, installations.size]));
}

function summarizeDownloads(downloads, logFiles) {
  const byDate = new Map();
  const byPlatform = new Map();
  const byVersion = new Map();
  let bytes = 0;
  for (const download of downloads) {
    const date = download.occurred_at.slice(0, 10);
    incrementDownloadGroup(byDate, date, download.bytes);
    incrementDownloadGroup(byPlatform, download.platform, download.bytes);
    incrementDownloadGroup(byVersion, download.version, download.bytes);
    bytes += download.bytes;
  }
  return {
    log_files: logFiles,
    requests: downloads.length,
    bytes,
    by_date: downloadGroups(byDate),
    by_platform: downloadGroups(byPlatform),
    by_version: downloadGroups(byVersion),
  };
}

function incrementDownloadGroup(groups, key, bytes) {
  const value = groups.get(key) ?? { requests: 0, bytes: 0 };
  value.requests += 1;
  value.bytes += bytes;
  groups.set(key, value);
}

function downloadGroups(groups) {
  return Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, { bytes: value.bytes, requests: value.requests }]));
}

function telemetryEventValidationError(value) {
  if (!isPlainObject(value) || !exactKeys(value, [
    "schema_version", "event_id", "install_id", "event_name", "occurred_at",
    "local_date", "timezone_offset_minutes", "app", "properties", "received_at",
  ])) return "invalid_envelope";
  if (value.schema_version !== 1 ||
      !shortIdentifier(value.event_id, 16, 80) ||
      !shortIdentifier(value.install_id, 16, 80) ||
      !EVENT_NAMES.has(value.event_name) ||
      !validIsoTimestamp(value.occurred_at) ||
      !validCalendarDate(value.local_date) ||
      !boundedInteger(value.timezone_offset_minutes, -840, 840) ||
      !validIsoTimestamp(value.received_at)) {
    return "invalid_envelope";
  }
  const derivedLocalDate = new Date(
    Date.parse(value.occurred_at) + value.timezone_offset_minutes * 60_000,
  ).toISOString().slice(0, 10);
  if (derivedLocalDate !== value.local_date) return "invalid_local_date";
  if (!validTelemetryApp(value.app)) return "invalid_app";
  if (value.event_name === "git_leaf.installation.observed") {
    return validInstallationProperties(value.properties) ? "" : "invalid_installation_properties";
  }
  if (value.event_name === "git_leaf.update.state_changed") {
    return validUpdateProperties(value.properties, value.app.version) ? "" : "invalid_update_properties";
  }
  return validDailySummaryProperties(value.properties, value.install_id, value.local_date)
    ? ""
    : "invalid_daily_summary_properties";
}

function validTelemetryApp(app) {
  return isPlainObject(app) && exactKeys(app, [
    "version", "build_id", "channel", "platform", "arch", "os_version_major",
  ]) && validSemanticVersion(app.version) && boundedText(app.build_id, 1, 120) &&
    app.channel === "stable" && ["darwin", "win32"].includes(app.platform) &&
    ["arm64", "x64"].includes(app.arch) && boundedText(app.os_version_major, 0, 12);
}

function validInstallationProperties(properties) {
  if (!isPlainObject(properties) || !onlyKeys(properties, ["reason", "device_name"]) ||
      !["first_observed", "device_name_changed"].includes(properties.reason)) return false;
  return properties.device_name === undefined || boundedText(properties.device_name, 1, 120);
}

function validUpdateProperties(properties, appVersion) {
  if (!isPlainObject(properties) || !onlyKeys(properties, [
    "state", "trigger", "from_version", "to_version", "error_code", "stage",
  ]) || !UPDATE_STATES.has(properties.state) || !UPDATE_TRIGGERS.has(properties.trigger) ||
      !validSemanticVersion(properties.from_version)) return false;
  if (properties.to_version !== undefined && properties.to_version !== null &&
      !validSemanticVersion(properties.to_version)) return false;
  const strictContract = compareSemanticVersions(appVersion, "1.10.0") >= 0;
  if (!strictContract) {
    if (properties.state !== "failed" &&
        (properties.error_code !== undefined || properties.stage !== undefined)) return false;
    return (properties.error_code === undefined || UPDATE_ERROR_CODES.has(properties.error_code)) &&
      (properties.stage === undefined || UPDATE_FAILURE_STAGES.has(properties.stage));
  }
  if (properties.state === "failed") {
    if (properties.error_code !== undefined && !UPDATE_ERROR_CODES.has(properties.error_code)) return false;
    if (properties.stage !== undefined && !UPDATE_FAILURE_STAGES.has(properties.stage)) return false;
  } else if (properties.error_code !== undefined || properties.stage !== undefined) {
    return false;
  }
  const targetRequired = new Set(["current", "available", "downloaded", "skipped", "install_started", "completed"]);
  if (targetRequired.has(properties.state) && !validSemanticVersion(properties.to_version)) return false;
  if (properties.state === "completed") {
    return compareSemanticVersions(properties.to_version, appVersion) === 0 &&
      compareSemanticVersions(properties.to_version, properties.from_version) !== 0;
  }
  if (compareSemanticVersions(properties.from_version, appVersion) !== 0) return false;
  if (properties.state === "check_started") {
    return properties.to_version === undefined;
  }
  if (properties.state === "current") {
    return compareSemanticVersions(properties.to_version, properties.from_version) <= 0;
  }
  if (["available", "downloaded", "skipped", "install_started"].includes(properties.state)) {
    return compareSemanticVersions(properties.to_version, properties.from_version) > 0;
  }
  if (properties.state === "failed") {
    if (!UPDATE_ERROR_CODES.has(properties.error_code) || !UPDATE_FAILURE_STAGES.has(properties.stage)) return false;
    return properties.stage === "check" || validSemanticVersion(properties.to_version);
  }
  return false;
}

function validDailySummaryProperties(properties, installId, envelopeDate) {
  const requiredKeys = [
    "summary_id", "revision", "launch_count", "launch_counts_by_entry_kind",
    "active_minutes", "repository_open_count", "repository_switch_count",
    "distinct_repository_count", "rolling_30d_distinct_repository_count",
    "worktree_switch_count", "mode_minutes", "feature_counts",
  ];
  if (!isPlainObject(properties) || !onlyKeys(properties, [...requiredKeys, "summary_date"]) ||
      requiredKeys.some((key) => !Object.hasOwn(properties, key)) ||
      typeof properties.summary_id !== "string" || !/^[a-f0-9]{32,64}$/.test(properties.summary_id) ||
      !boundedInteger(properties.revision, 1, 100_000)) return false;
  if (properties.summary_date !== undefined &&
      (!validCalendarDate(properties.summary_date) ||
       properties.summary_date > envelopeDate ||
       dailySummaryId(installId, properties.summary_date, properties.summary_id.length) !== properties.summary_id)) {
    return false;
  }
  for (const key of [
    "launch_count", "active_minutes", "repository_open_count", "repository_switch_count",
    "distinct_repository_count", "rolling_30d_distinct_repository_count", "worktree_switch_count",
  ]) {
    if (!boundedInteger(properties[key], 0, 1_000_000)) return false;
  }
  if (!isPlainObject(properties.launch_counts_by_entry_kind) ||
      Object.keys(properties.launch_counts_by_entry_kind).some((key) => !ENTRY_KINDS.has(key)) ||
      Object.values(properties.launch_counts_by_entry_kind)
        .some((count) => !boundedInteger(count, 0, 1_000_000))) return false;
  if (!isPlainObject(properties.mode_minutes) || !exactKeys(properties.mode_minutes, ["preview", "source", "live"]) ||
      Object.values(properties.mode_minutes).some((count) => !boundedInteger(count, 0, 1_000_000))) return false;
  if (!Array.isArray(properties.feature_counts) || properties.feature_counts.length > 100) return false;
  const featureKeys = new Set();
  for (const counter of properties.feature_counts) {
    if (!validFeatureCounter(counter)) return false;
    const key = featureCounterKey(counter.feature_id, counter.dimensions ?? {});
    if (featureKeys.has(key)) return false;
    featureKeys.add(key);
  }
  return true;
}

function dailySummaryId(installId, summaryDate, length = 32) {
  return createHash("sha256").update(`${installId}:${summaryDate}`).digest("hex").slice(0, length);
}

function validFeatureCounter(counter) {
  if (!isPlainObject(counter) || !onlyKeys(counter, ["feature_id", "dimensions", "count"]) ||
      ![2, 3].includes(Object.keys(counter).length) || counter.feature_id === undefined || counter.count === undefined ||
      !boundedInteger(counter.count, 1, 1_000_000)) return false;
  const allowedDimensions = FEATURE_DIMENSIONS.get(counter.feature_id);
  if (!allowedDimensions) return false;
  const dimensions = counter.dimensions ?? {};
  if (!isPlainObject(dimensions) || Object.keys(dimensions).some((key) => !Object.hasOwn(allowedDimensions, key))) {
    return false;
  }
  if (!Object.entries(dimensions).every(([key, value]) => allowedDimensions[key].has(value))) return false;
  if (counter.feature_id === "navigation.deep_link" &&
      Object.hasOwn(dimensions, "failure_reason") && dimensions.result !== "error") {
    return false;
  }
  return true;
}

function reportedFeatureDimensions(featureId, dimensions = {}) {
  if (featureId === "navigation.deep_link" &&
      dimensions.result === "error" && !Object.hasOwn(dimensions, "failure_reason")) {
    return sortedObject({ ...dimensions, failure_reason: "legacy_unknown" });
  }
  return sortedObject(dimensions);
}

function featureCounterKey(featureId, dimensions = {}) {
  return `${featureId}:${JSON.stringify(sortedObject(dimensions))}`;
}

function downloadValidationError(value) {
  if (!isPlainObject(value) || !exactKeys(value, [
    "schema_version", "download_id", "event_name", "occurred_at", "channel",
    "platform", "version", "artifact", "source", "bytes",
  ])) return "invalid_download_envelope";
  if (value.schema_version !== 1 || !shortIdentifier(value.download_id, 8, 80) ||
      value.event_name !== "git_leaf.distribution.downloaded" ||
      !validUtcTimestamp(value.occurred_at) || value.channel !== "stable" ||
      !["darwin-universal", "darwin-arm64", "win32-x64"].includes(value.platform) ||
      !validSemanticVersion(value.version) || value.source !== "download_page" ||
      !boundedInteger(value.bytes, 0, Number.MAX_SAFE_INTEGER)) {
    return "invalid_download_contract";
  }
  if ((value.platform.startsWith("darwin-") && value.artifact !== "dmg") ||
      (value.platform === "win32-x64" && value.artifact !== "zip")) {
    return "invalid_download_artifact";
  }
  return "";
}

function increment(value, key) {
  value[key] = (value[key] ?? 0) + 1;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isPlainObject(value) && Object.keys(value).length === keys.length && onlyKeys(value, keys);
}

function onlyKeys(value, keys) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedText(value, minimum, maximum) {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum && !/[\u0000-\u001F\u007F]/.test(value);
}

function boundedInteger(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function shortIdentifier(value, minimum, maximum) {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum && /^[A-Za-z0-9_-]+$/.test(value);
}

function validCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validIsoTimestamp(value) {
  if (typeof value !== "string" || value.length > 40) return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !validCalendarDate(match[1])) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);
  return hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 23 && offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value));
}

function validUtcTimestamp(value) {
  return validIsoTimestamp(value) && (value.endsWith("Z") || value.endsWith("+00:00"));
}

function validSemanticVersion(value) {
  if (typeof value !== "string" || value.length > 40 ||
      !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value)) {
    return false;
  }
  const prerelease = parseSemanticVersion(value).prerelease;
  return prerelease.every((identifier) => !/^\d+$/.test(identifier) || identifier === "0" || !identifier.startsWith("0"));
}

function compareSemanticVersions(left, right) {
  const leftVersion = parseSemanticVersion(left);
  const rightVersion = parseSemanticVersion(right);
  for (const key of ["major", "minor", "patch"]) {
    if (leftVersion[key] > rightVersion[key]) return 1;
    if (leftVersion[key] < rightVersion[key]) return -1;
  }
  const leftPrerelease = leftVersion.prerelease;
  const rightPrerelease = rightVersion.prerelease;
  if (leftPrerelease.length === 0 && rightPrerelease.length === 0) return 0;
  if (leftPrerelease.length === 0) return 1;
  if (rightPrerelease.length === 0) return -1;
  const length = Math.max(leftPrerelease.length, rightPrerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftPrerelease[index];
    const rightIdentifier = rightPrerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) return BigInt(leftIdentifier) > BigInt(rightIdentifier) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier > rightIdentifier ? 1 : -1;
  }
  return 0;
}

function parseSemanticVersion(value) {
  const withoutBuild = value.split("+", 1)[0];
  const separator = withoutBuild.indexOf("-");
  const core = separator === -1 ? withoutBuild : withoutBuild.slice(0, separator);
  const prerelease = separator === -1 ? "" : withoutBuild.slice(separator + 1);
  const [major, minor, patch] = core.split(".");
  return {
    major: BigInt(major),
    minor: BigInt(minor),
    patch: BigInt(patch),
    prerelease: prerelease ? prerelease.split(".") : [],
  };
}

function downloadPlatformMatches(downloadPlatform, platform) {
  return platform === "darwin"
    ? downloadPlatform.startsWith("darwin-")
    : platform === "win32"
      ? downloadPlatform === "win32-x64"
      : downloadPlatform === platform;
}

function summarizeUpdateEvents(events) {
  const strictEvents = events.filter(isStrictUpdateEvent);
  const legacyEvents = events.filter((event) => !isStrictUpdateEvent(event));
  const all = updateStateStats(events);
  const byPlatform = groupedUpdateStats(events, (event) => event.app?.platform || "unknown");
  const byTrigger = groupedUpdateStats(events, (event) => event.properties?.trigger || "unknown");
  const byTransition = groupedUpdateStats(strictEvents, (event) => [
    event.app?.platform || "unknown",
    event.properties?.from_version || "?",
    event.properties?.to_version || "?",
  ].join(" | "));
  const failed = strictEvents.filter((event) => event.properties?.state === "failed");
  const legacyUnknown = legacyUpdateUnknownStats(legacyEvents);
  return {
    capability_scope: "app_version_gte_1.10.0",
    states: all.states,
    installations_by_state: all.installations_by_state,
    strict_states: updateStateStats(strictEvents),
    legacy_states: updateStateStats(legacyEvents),
    legacy_unknown: legacyUnknown,
    paths_by_state: updatePathStats(strictEvents),
    by_date: groupedUpdateStats(events, (event) => event.local_date || "unknown"),
    by_platform: byPlatform,
    by_trigger: byTrigger,
    by_transition: byTransition,
    failures: {
      by_error_code: groupedFailureStats(failed, (event) => event.properties?.error_code || "legacy_unknown"),
      by_stage: groupedFailureStats(failed, (event) => event.properties?.stage || "legacy_unknown"),
      by_app_version: groupedFailureStats(failed, (event) => event.app?.version || "unknown"),
      by_platform: groupedFailureStats(failed, (event) => event.app?.platform || "unknown"),
    },
    relations: updateRelationStats(strictEvents),
    quality: updateQualityStats(strictEvents, legacyEvents),
  };
}

function isStrictUpdateEvent(event) {
  return compareSemanticVersions(event.app.version, "1.10.0") >= 0;
}

function legacyUpdateUnknownStats(events) {
  const targetNormallyRequired = new Set([
    "current", "available", "downloaded", "skipped", "install_started", "completed",
  ]);
  const missingTarget = events.filter((event) =>
    (!event.properties.to_version && targetNormallyRequired.has(event.properties.state)) ||
    (!event.properties.to_version && event.properties.state === "failed" && event.properties.stage !== "check")
  );
  const failures = events.filter((event) => event.properties.state === "failed");
  const failuresMissingStage = failures.filter((event) => !event.properties.stage);
  const failuresMissingErrorCode = failures.filter((event) => !event.properties.error_code);
  return {
    records: eventAndInstallationCount(events),
    missing_target: eventAndInstallationCount(missingTarget),
    failures_missing_stage: eventAndInstallationCount(failuresMissingStage),
    failures_missing_error_code: eventAndInstallationCount(failuresMissingErrorCode),
  };
}

function updateStateStats(events) {
  const states = {};
  const installations = new Map();
  for (const event of events) {
    const state = event.properties?.state;
    if (!state) continue;
    states[state] = (states[state] ?? 0) + 1;
    const values = installations.get(state) ?? new Set();
    values.add(event.install_id);
    installations.set(state, values);
  }
  return {
    states: sortedObject(states),
    installations_by_state: Object.fromEntries([...installations.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([state, values]) => [state, values.size])),
  };
}

function groupedUpdateStats(events, keyFor) {
  const groups = new Map();
  for (const event of events) {
    const key = keyFor(event);
    const values = groups.get(key) ?? [];
    values.push(event);
    groups.set(key, values);
  }
  return Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, values]) => [key, updateStateStats(values)]));
}

function groupedFailureStats(events, keyFor) {
  const groups = new Map();
  for (const event of events) {
    const key = keyFor(event);
    const value = groups.get(key) ?? { events: 0, installations: new Set() };
    value.events += 1;
    value.installations.add(event.install_id);
    groups.set(key, value);
  }
  return Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, { events: value.events, installations: value.installations.size }]));
}

function updatePathStats(events) {
  const paths = new Map();
  for (const event of events) {
    const state = event.properties?.state;
    const targetVersion = event.properties?.to_version;
    if (!state || !targetVersion) continue;
    const values = paths.get(state) ?? new Set();
    values.add(`${event.install_id}|${targetVersion}`);
    paths.set(state, values);
  }
  return Object.fromEntries([...paths.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([state, values]) => [state, values.size]));
}

function updateRelationStats(events) {
  const groups = updateStateGroups(events);
  const result = {
    available_paths: 0,
    downloaded_with_prior_available: 0,
    downloaded_without_prior_available: 0,
    install_started_with_prior_downloaded: 0,
    install_started_without_prior_downloaded: 0,
    completed_with_prior_lifecycle: 0,
    completed_without_prior_lifecycle: 0,
  };
  for (const group of groups.values()) {
    if (Number.isFinite(group.available)) result.available_paths += 1;
    if (Number.isFinite(group.downloaded)) {
      if (group.available < group.downloaded) result.downloaded_with_prior_available += 1;
      else result.downloaded_without_prior_available += 1;
    }
    if (Number.isFinite(group.install_started)) {
      if (group.downloaded < group.install_started) result.install_started_with_prior_downloaded += 1;
      else result.install_started_without_prior_downloaded += 1;
    }
    if (Number.isFinite(group.completed)) {
      const hasPriorLifecycle = [group.available, group.downloaded, group.install_started]
        .some((timestamp) => Number.isFinite(timestamp) && timestamp < group.completed);
      if (hasPriorLifecycle) result.completed_with_prior_lifecycle += 1;
      else result.completed_without_prior_lifecycle += 1;
    }
  }
  return result;
}

function updateStateGroups(events) {
  const groups = new Map();
  for (const event of events) {
    const targetVersion = event.properties?.to_version;
    const timestamp = Date.parse(event.occurred_at);
    if (!targetVersion || !Number.isFinite(timestamp)) continue;
    const key = `${event.install_id}|${targetVersion}`;
    const group = groups.get(key) ?? {};
    const state = event.properties?.state;
    group[state] = Math.min(group[state] ?? Number.POSITIVE_INFINITY, timestamp);
    groups.set(key, group);
  }
  return groups;
}

function updateQualityStats(events, legacyEvents = []) {
  const checkStarted = events.filter((event) => event.properties?.state === "check_started").length;
  const current = events.filter((event) => event.properties?.state === "current");
  const currentExact = current.filter((event) =>
    event.properties?.to_version && compareSemanticVersions(event.properties.to_version, event.properties.from_version) === 0
  );
  const feedBehind = current.filter((event) =>
    event.properties?.to_version && compareSemanticVersions(event.properties.to_version, event.properties.from_version) < 0
  );
  const currentOther = current.length - currentExact.length - feedBehind.length;
  const availableEvents = events.filter((event) => event.properties?.state === "available");
  const available = availableEvents.filter((event) => event.properties?.to_version &&
    compareSemanticVersions(event.properties.to_version, event.properties.from_version) > 0).length;
  const failed = events.filter((event) => event.properties?.state === "failed");
  const failedCheck = failed.filter((event) => event.properties?.stage === "check").length;
  const legacyFailed = legacyEvents.filter((event) => event.properties?.state === "failed");
  const failuresMissingStage = legacyFailed.filter((event) => !event.properties?.stage);
  const failuresMissingErrorCode = legacyFailed.filter((event) => !event.properties?.error_code);
  const outcomes = currentExact.length + feedBehind.length + available + failedCheck;
  return {
    check_balance: {
      capability_scope: "app_version_gte_1.10.0",
      check_started: checkStarted,
      current_exact: currentExact.length,
      feed_behind: feedBehind.length,
      current_other: currentOther,
      available,
      failed_check: failedCheck,
      outcomes,
      difference: checkStarted - outcomes,
    },
    failures_missing_stage: eventAndInstallationCount(failuresMissingStage),
    failures_missing_stage_app_versions: [...new Set(failuresMissingStage
      .map((event) => event.app?.version || "unknown"))].sort(),
    failures_missing_error_code: eventAndInstallationCount(failuresMissingErrorCode),
    failures_missing_error_code_app_versions: [...new Set(failuresMissingErrorCode
      .map((event) => event.app?.version || "unknown"))].sort(),
    current_with_older_target: eventAndInstallationCount(feedBehind),
  };
}

function eventAndInstallationCount(events) {
  return {
    events: events.length,
    installations: new Set(events.map((event) => event.install_id)).size,
  };
}

function rollingActiveMetric(activityDates, coverageDates, endDate, windowDays, { partialValueAllowed }) {
  const startDate = shiftDate(endDate, -(windowDays - 1));
  const installations = new Set();
  const coveredDates = [];
  const missingDates = [];
  let unavailableQuality = false;
  let excludedInconsistentSummaries = 0;
  let excludedConflictingSummaries = 0;
  const qualityAffectedDates = [];
  for (let date = startDate; date <= endDate; date = shiftDate(date, 1)) {
    if (coverageDates.has(date)) coveredDates.push(date);
    else missingDates.push(date);
    if (activityDates.get(date)?.activeUnavailable) unavailableQuality = true;
    const excluded = activityDates.get(date)?.excludedInconsistentSummaries ?? 0;
    const conflicting = activityDates.get(date)?.excludedConflictingSummaries ?? 0;
    if (excluded > 0 || conflicting > 0) {
      excludedInconsistentSummaries += excluded;
      excludedConflictingSummaries += conflicting;
      qualityAffectedDates.push(date);
    }
  }
  for (const [date, values] of activityDates) {
    if (date < startDate || date > endDate) continue;
    for (const installId of values.installations) installations.add(installId);
  }
  if (unavailableQuality) {
    return {
      status: "unavailable_quality",
      value: null,
      observed_installations: null,
      covered_days: coveredDates.length,
      required_days: windowDays,
      required_start: startDate,
      actual_start: coveredDates[0] ?? null,
      missing_dates: missingDates,
      quality_status: "unavailable_quality",
      excluded_inconsistent_summaries: excludedInconsistentSummaries,
      excluded_conflicting_summaries: excludedConflictingSummaries,
      quality_affected_dates: qualityAffectedDates,
      window_from: startDate,
      window_to: endDate,
    };
  }
  const complete = missingDates.length === 0;
  const partialQuality = excludedInconsistentSummaries > 0 || excludedConflictingSummaries > 0;
  return {
    status: complete
      ? partialQuality ? "partial_quality" : "complete"
      : partialValueAllowed ? "partial" : "unavailable_coverage",
    value: complete || partialValueAllowed ? installations.size : null,
    observed_installations: installations.size,
    covered_days: coveredDates.length,
    required_days: windowDays,
    required_start: startDate,
    actual_start: coveredDates[0] ?? null,
    missing_dates: missingDates,
    quality_status: partialQuality ? "partial_quality" : "complete",
    excluded_inconsistent_summaries: excludedInconsistentSummaries,
    excluded_conflicting_summaries: excludedConflictingSummaries,
    quality_affected_dates: qualityAffectedDates,
    window_from: startDate,
    window_to: endDate,
  };
}

function shiftDate(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftCalendarMonths(value, months) {
  const [year, month, day] = value.split("-").map(Number);
  const targetMonthIndex = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export function telemetryReportMarkdown(report) {
  const eventSource = report.data_sources.events;
  const downloadSource = report.data_sources.downloads;
  const window = report.reporting_window;
  const updateQuality = report.updates.quality ?? {};
  const checkBalance = updateQuality.check_balance ?? {};
  const relations = report.updates.relations ?? {};
  const legacyUnknown = report.updates.legacy_unknown ?? {};
  const dailyQuality = report.data_quality.daily_summary_inconsistencies ?? {};
  const lines = [
    "# Git Leaf 使用统计",
    "",
    "## 数据源健康",
    "",
    `- 接收服务：${report.data_sources.gateway_service.status}（本地汇总器不执行在线探测）`,
    `- 事件日志文件：${eventSource.files}；status=${eventSource.status}（${sourceStatusText(eventSource)}）；scope_status=${eventSource.scope_status}；有效去重记录=${formatSourceMetric(eventSource.valid_deduplicated_records)}；口径内记录=${formatSourceMetric(eventSource.selected_records)}`,
    `- 下载日志文件：${downloadSource.files}；status=${downloadSource.status}（${sourceStatusText(downloadSource)}）；scope_status=${downloadSource.scope_status}；有效去重记录=${formatSourceMetric(downloadSource.valid_deduplicated_records)}；口径内记录=${formatSourceMetric(downloadSource.selected_records)}`,
    `- 全源最新事件接收：${eventSource.latest_received_at ?? "无"}`,
    `- 全源接收延迟：${formatDuration(eventSource.receive_lag_seconds)}`,
    "",
    "## 数据窗口",
    "",
    `- 生成时间：${report.generated_at}`,
    `- 事件按本地日期筛选（daily.summary 使用业务日 summary_date）：${dateCoverage(report.range.from, report.range.to)}；实际覆盖 ${dateCoverage(report.coverage.event_local_date_from, report.coverage.event_local_date_to)}`,
    `- 下载按 UTC 日期筛选：${dateCoverage(report.range.from, report.range.to)}；实际覆盖 ${dateCoverage(report.coverage.download_utc_date_from, report.coverage.download_utc_date_to)}`,
    `- 最近 30 个完整自然日：${window.recent_30_complete_days_from} 至 ${window.recent_30_complete_days_to}（${window.timezone}）`,
    `- 昨天：${window.yesterday}`,
    `- 今天未完成数据：${window.today_incomplete}，不得与完整日基线直接比较`,
    `- App 版本筛选：${report.range.app_version ?? "不限"}`,
    `- 下载制品版本筛选：${report.range.artifact_version ?? "不限"}`,
    `- 口径内最新事件接收：${report.coverage.latest_received_at ?? "无"}；延迟 ${formatDuration(report.coverage.latest_received_delay_seconds)}`,
    "",
    "## 安装与分发",
    "",
    `- 已观察安装实例：${formatSourceMetric(report.installations.observed)}`,
    `- 下载页安装包请求：${downloadRequestSummary(report)}`,
    `- 制品文件大小合计：${formatSourceMetric(report.downloads.bytes)} 字节（非实际传输流量）`,
    "",
    "### 下载页请求（UTC 日期）",
    "",
    "| UTC 日期 | 请求数 | 制品文件大小（字节） |",
    "| --- | ---: | ---: |",
  ];
  appendCountRows(lines, report.downloads.by_date, (date, value) => `| ${date} | ${value.requests} | ${value.bytes} |`, 3);
  lines.push(
    "",
    "### 首次观察安装实例（本地日期）",
    "",
    "| 本地日期 | 首次观察安装实例 |",
    "| --- | ---: |",
  );
  appendCountRows(lines, report.installations.first_observed_by_date,
    (date, value) => `| ${date}${date === window.today_incomplete ? "（当日未完成）" : ""} | ${value} |`, 2);
  lines.push(
    "",
    "> 下载请求与首次观察安装实例没有共同主键，两者不可相除。首次观察只表示该安装实例第一次进入遥测系统，不等于当天新安装。",
    "",
    "## 更新检查",
    "",
    "> 平衡公式、去重状态组和前序关系仅使用 App >= 1.10.0 strict capability；旧版仅保留 state 绝对事实并将缺失字段归入 legacy_unknown。",
    "",
    "| 检查账项 | 事件数 | 是否进入平衡公式 |",
    "| --- | ---: | --- |",
    `| check_started | ${formatSourceMetric(checkBalance.check_started)} | 起点 |`,
    `| current_exact | ${formatSourceMetric(checkBalance.current_exact)} | 是 |`,
    `| feed_behind | ${formatSourceMetric(checkBalance.feed_behind)} | 是 |`,
    `| available | ${formatSourceMetric(checkBalance.available)} | 是 |`,
    `| failed_check | ${formatSourceMetric(checkBalance.failed_check)} | 是 |`,
    `| current_other | ${formatSourceMetric(checkBalance.current_other)} | 否，单列异常 |`,
    `| outcomes | ${formatSourceMetric(checkBalance.outcomes)} | 四类结果合计 |`,
    `| difference | ${formatSourceMetric(checkBalance.difference)} | check_started - outcomes |`,
    "",
    `- legacy update 记录：${formatSourceMetric(legacyUnknown.records?.events)}；缺目标版本 ${formatSourceMetric(legacyUnknown.missing_target?.events)}；失败缺阶段 ${formatSourceMetric(legacyUnknown.failures_missing_stage?.events)}；失败缺错误码 ${formatSourceMetric(legacyUnknown.failures_missing_error_code?.events)}`,
    "",
    "## 更新状态",
    "",
    "| 状态 | 事件数（全部合法记录） | 安装实例（全部合法记录） | 去重状态组（strict capability） |",
    "| --- | ---: | ---: | ---: |",
  );
  for (const [state, count] of Object.entries(report.updates.states ?? {})) {
    lines.push(`| ${state} | ${count} | ${report.updates.installations_by_state[state] ?? 0} | ${report.updates.paths_by_state[state] ?? 0} |`);
  }
  if (report.updates.states === null) lines.push("| N/A | N/A | N/A | N/A |");
  lines.push(
    "",
    "## 更新状态关系",
    "",
    "> 以下是状态之间能否找到逻辑前序的绝对数量，不是用户行为漏斗或自动更新成功率。",
    "",
    "| 逻辑关系 | 数量 |",
    "| --- | ---: |",
    `| 发现目标版本的去重状态组 | ${formatSourceMetric(relations.available_paths)} |`,
    `| 下载状态有更早 available | ${formatSourceMetric(relations.downloaded_with_prior_available)} |`,
    `| 下载状态没有更早 available | ${formatSourceMetric(relations.downloaded_without_prior_available)} |`,
    `| 安装入口有更早 downloaded | ${formatSourceMetric(relations.install_started_with_prior_downloaded)} |`,
    `| 安装入口没有更早 downloaded | ${formatSourceMetric(relations.install_started_without_prior_downloaded)} |`,
    `| 版本变化有可观察前序 | ${formatSourceMetric(relations.completed_with_prior_lifecycle)} |`,
    `| 版本变化没有可观察前序 | ${formatSourceMetric(relations.completed_without_prior_lifecycle)} |`,
    "",
    `> 查询窗口截断可能性：${formatTruncationPossibility(report.data_quality.update_path_window_truncation_possible)}。没有前序不能直接解释为流程失败。`,
  );
  lines.push("", "## 更新失败");
  appendFailureTable(lines, "按阶段", report.updates.failures?.by_stage ?? null);
  appendFailureTable(lines, "按错误码", report.updates.failures?.by_error_code ?? null);
  appendFailureTable(lines, "按 App 版本", report.updates.failures?.by_app_version ?? null);
  appendFailureTable(lines, "按平台", report.updates.failures?.by_platform ?? null);
  lines.push(
    "",
    "## 活跃与功能",
    "",
    `> 活跃口径：${report.activity.contract_version ?? "launch_based_v2"}。DAU 表示当天打开过正式 App 的安装实例；深度活跃保留时长／功能动作口径。`,
    "",
    "| 日期 | DAU（打开） | 深度活跃 | WAU | MAU | 活跃分钟 | 启动次数 | 数据新鲜度 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  );
  for (const [date, values] of Object.entries(report.activity.by_date ?? {})) {
    const label = `${date}${date === window.today_incomplete ? "（当日未完成）" : ""}`;
    lines.push(`| ${label} | ${formatNullable(values.active_installations)} | ${formatNullable(values.engaged_installations)} | ${formatRollingActive(values.weekly_active_installations, "WAU")} | ${formatRollingActive(values.monthly_active_installations, "MAU")} | ${formatNullable(values.active_minutes)} | ${formatNullable(values.launches)} | ${values.freshness_status ?? "historical"} |`);
  }
  if (report.activity.by_date === null) lines.push("| N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |");
  else if (Object.keys(report.activity.by_date).length === 0) lines.push("| 无口径内每日汇总 | — | — | — | — | — | — | — |");
  lines.push(
    "",
    `- 活跃版本分布（status=${report.activity.active_versions_status}）：${formatObjectCounts(report.activity.active_versions)}`,
    `- 深度活跃版本分布（status=${report.activity.engaged_versions_status}）：${formatObjectCounts(report.activity.engaged_versions)}`,
    `- 模式分钟（status=${report.activity.mode_minutes_status}）：${report.activity.mode_minutes === null ? "N/A" : `preview=${formatNullable(report.activity.mode_minutes.preview)}，source=${formatNullable(report.activity.mode_minutes.source)}，live=${formatNullable(report.activity.mode_minutes.live)}`}`,
    `- 每日不同仓库分布（status=${report.repositories.status}）：${formatObjectCounts(report.repositories.daily_distinct_count_distribution)}`,
    "",
    `### 功能使用（status=${report.features_status}）`,
    "",
    "| 功能 | 维度 | 使用次数 | 使用安装实例 |",
    "| --- | --- | ---: | ---: |",
  );
  for (const feature of report.features ?? []) {
    lines.push(`| ${feature.feature_id} | ${formatDimensions(feature.dimensions)} | ${feature.count} | ${feature.active_installations} |`);
  }
  if (report.features === null) lines.push("| N/A | N/A | N/A | N/A |");
  else if (report.features.length === 0) lines.push("| 无 | — | 0 | 0 |");
  lines.push(
    "",
    "## 数据质量与解释边界",
    "",
    `- 无效事件行：${formatSourceMetric(report.data_quality.invalid_lines)}；原因 ${formatObjectCounts(report.data_quality.invalid_event_reasons)}`,
    `- 无效下载行：${formatSourceMetric(report.data_quality.invalid_download_lines)}；原因 ${formatObjectCounts(report.data_quality.invalid_download_reasons)}`,
    `- 重复 event_id：${formatSourceMetric(report.data_quality.duplicate_event_ids)}；内容冲突 ${formatSourceMetric(report.data_quality.conflicting_duplicate_event_ids)}`,
    `- 重复 download_id：${formatSourceMetric(report.data_quality.duplicate_download_ids)}；内容冲突 ${formatSourceMetric(report.data_quality.conflicting_duplicate_download_ids)}`,
    `- 被更高 revision 覆盖的日汇总：${formatSourceMetric(report.data_quality.superseded_daily_summaries)}`,
    `- 日汇总业务日期：legacy 缺显式日期 ${formatSourceMetric(report.data_quality.daily_summary_dates?.legacy_missing_explicit_date)}；恢复 ${formatSourceMetric(report.data_quality.daily_summary_dates?.recovered)}；无法恢复 ${formatSourceMetric(report.data_quality.daily_summary_dates?.unresolved)}；与入队日期不同 ${formatSourceMetric(report.data_quality.daily_summary_dates?.envelope_date_shifted)}`,
    `- 同 revision 重复／冲突：${formatSourceMetric(report.data_quality.duplicate_daily_summary_revisions)}／${formatSourceMetric(report.data_quality.conflicting_daily_summary_revisions)}`,
    `- summary_id 身份冲突／被排除汇总：${formatSourceMetric(report.data_quality.conflicting_daily_summary_identities)}／${formatSourceMetric(report.data_quality.excluded_conflicting_daily_summaries)}`,
    `- 日汇总不一致日期：${report.data_quality.daily_summary_inconsistent_dates?.join("、") || (report.data_quality.daily_summary_inconsistent_dates === null ? "N/A" : "无")}`,
    `- 日汇总冲突日期：${report.data_quality.daily_summary_conflicting_dates?.join("、") || (report.data_quality.daily_summary_conflicting_dates === null ? "N/A" : "无")}`,
    `- 因内部不一致排除的日汇总：${formatSourceMetric(report.data_quality.excluded_inconsistent_daily_summaries)}`,
    `- 启动次数不平衡：${formatSourceMetric(dailyQuality.launch_count_mismatch)}`,
    `- 活跃分钟不平衡：${formatSourceMetric(dailyQuality.active_minutes_mismatch)}`,
    `- 每日仓库数大于打开次数：${formatSourceMetric(dailyQuality.distinct_repositories_exceed_opens)}`,
    `- 每日仓库数大于 30 日仓库数：${formatSourceMetric(dailyQuality.daily_repositories_exceed_rolling_30d)}`,
    `- 更新检查平衡差（strict capability）：${formatSourceMetric(checkBalance.difference)}`,
    `- current 目标版本较旧：${formatSourceMetric(updateQuality.current_with_older_target?.events)} 个事件／${formatSourceMetric(updateQuality.current_with_older_target?.installations)} 个安装实例`,
    `- legacy 失败阶段缺失：${formatSourceMetric(updateQuality.failures_missing_stage?.events)} 个事件／${formatSourceMetric(updateQuality.failures_missing_stage?.installations)} 个安装实例；App 版本 ${updateQuality.failures_missing_stage_app_versions?.join("、") || (report.updates.quality === null ? "N/A" : "无")}`,
    `- legacy 失败错误码缺失：${formatSourceMetric(updateQuality.failures_missing_error_code?.events)} 个事件／${formatSourceMetric(updateQuality.failures_missing_error_code?.installations)} 个安装实例；App 版本 ${updateQuality.failures_missing_error_code_app_versions?.join("、") || (report.updates.quality === null ? "N/A" : "无")}`,
    `- 没有可观察前序的版本变化状态组（strict capability）：${formatSourceMetric(relations.completed_without_prior_lifecycle)}`,
    "- 禁止推断：下载请求不是安装实例；首次观察不是当天新安装；completed 不能证明由 App 内自动更新完成。",
    "",
    "## 与上一份报告相比",
    "",
    "- 与上一份报告的绝对增量：不可计算（无可比基线）",
  );
  return `${lines.join("\n")}\n`;
}

function appendCountRows(lines, value, rowFor, columns) {
  if (value === null) {
    lines.push(`| N/A | ${Array.from({ length: columns - 1 }, () => "N/A").join(" | ")} |`);
    return;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    lines.push(`| 无 | ${Array.from({ length: columns - 1 }, () => "0").join(" | ")} |`);
    return;
  }
  for (const [key, count] of entries) lines.push(rowFor(key, count));
}

function appendFailureTable(lines, title, groups) {
  lines.push("", `### ${title}`, "", "| 值 | 事件数 | 安装实例 |", "| --- | ---: | ---: |");
  if (groups === null) {
    lines.push("| N/A | N/A | N/A |");
    return;
  }
  const entries = Object.entries(groups);
  if (entries.length === 0) lines.push("| 无 | 0 | 0 |");
  else for (const [key, value] of entries) lines.push(`| ${key} | ${value.events} | ${value.installations} |`);
}

function downloadRequestSummary(report) {
  const source = report.data_sources.downloads;
  if (source.status === "not_configured") return "下载数据源未配置";
  if (source.status === "missing") return "下载日志路径缺失";
  if (source.status === "empty") return "尚未形成下载日志文件";
  if (source.status === "read_error") return "N/A（下载日志读取失败）";
  return String(report.downloads.requests);
}

function sourceStatusText(source) {
  if (source.status === "not_configured") return "N/A，未配置";
  if (source.status === "missing") return "N/A，路径不存在";
  if (source.status === "empty") return "尚未形成日志文件";
  if (source.status === "read_error") return `N/A，读取失败${source.error ? `：${source.error}` : ""}`;
  return "可读取";
}

function formatSourceMetric(value) {
  return value === null || value === undefined ? "N/A" : String(value);
}

function formatTruncationPossibility(value) {
  if (value === null || value === undefined) return "N/A";
  return value ? "是" : "未由起始日期筛选触发";
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "不可计算";
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  const hours = Math.floor(seconds / 3600);
  return `${hours} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
}

function formatNullable(value) {
  return value === null || value === undefined ? "不可计算" : String(value);
}

function formatRollingActive(metric, label) {
  if (metric.status === "complete") return String(metric.value);
  if (metric.status === "partial_quality") {
    return `${metric.value}（有效子集；排除不一致 ${metric.excluded_inconsistent_summaries} 条、冲突组 ${metric.excluded_conflicting_summaries} 个）`;
  }
  if (metric.status === "partial") {
    const quality = metric.quality_status === "partial_quality"
      ? `；排除不一致 ${metric.excluded_inconsistent_summaries} 条、冲突组 ${metric.excluded_conflicting_summaries} 个`
      : "";
    return `${metric.value}（部分；实际起始 ${metric.actual_start ?? "无"}；覆盖 ${metric.covered_days}/${metric.required_days} 日${quality}）`;
  }
  if (metric.status === "unavailable_quality") return `不可计算（${label} 日汇总质量异常）`;
  const quality = metric.quality_status === "partial_quality"
    ? `；另排除不一致 ${metric.excluded_inconsistent_summaries} 条、冲突组 ${metric.excluded_conflicting_summaries} 个`
    : "";
  return `不可计算（覆盖 ${metric.covered_days}/${metric.required_days} 日；缺 ${metric.missing_dates.length} 日${quality}）`;
}

function formatObjectCounts(value) {
  if (value === null) return "N/A";
  const entries = Object.entries(value);
  return entries.length === 0 ? "无" : entries.map(([key, count]) => `${key}=${count}`).join("，");
}

function formatDimensions(dimensions) {
  return Object.keys(dimensions).length === 0
    ? "—"
    : Object.entries(dimensions).map(([key, value]) => `${key}=${value}`).join("，");
}

function dateCoverage(from, to) {
  if (!from && !to) return "无";
  return from === to ? from : `${from ?? "?"} 至 ${to ?? "?"}`;
}

async function telemetryFileSource(root) {
  if (!root) return { configured: false, missing: false, error: "", files: [] };
  try {
    const rootStat = await stat(root);
    if (rootStat.isFile()) return { configured: true, missing: false, error: "", files: [root] };
    const files = [];
    await collectFiles(root, files);
    return { configured: true, missing: false, error: "", files: files.sort() };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      const blockedByFile = await pathHasNonDirectoryAncestor(root);
      if (!blockedByFile) return { configured: true, missing: true, error: "", files: [] };
      return { configured: true, missing: false, error: "ENOTDIR", files: [] };
    }
    return {
      configured: true,
      missing: false,
      error: error?.code || "read_failed",
      files: [],
    };
  }
}

async function pathHasNonDirectoryAncestor(root) {
  let candidate = path.resolve(root);
  while (true) {
    try {
      return !(await stat(candidate)).isDirectory();
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) return false;
    candidate = parent;
  }
}

async function collectFiles(directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(target, files);
    else if (entry.isFile() && (/\.jsonl$/.test(entry.name) || /\.jsonl\.gz$/.test(entry.name))) files.push(target);
  }
}

async function* linesFromFile(file) {
  const input = file.endsWith(".gz")
    ? createReadStream(file).pipe(createGunzip())
    : createReadStream(file);
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader) yield line;
}

function sortedObject(value, { numeric = false } = {}) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
    numeric ? Number(left) - Number(right) : left.localeCompare(right)
  ));
}

function parseArguments(argv) {
  const options = {
    root: "",
    downloadsRoot: "",
    from: "",
    to: "",
    platform: "",
    appVersion: "",
    artifactVersion: "",
    eventName: "",
    format: "json",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--from") options.from = argv[++index] ?? "";
    else if (argument === "--downloads-root") options.downloadsRoot = argv[++index] ?? "";
    else if (argument === "--to") options.to = argv[++index] ?? "";
    else if (argument === "--platform") options.platform = argv[++index] ?? "";
    else if (argument === "--app-version") options.appVersion = argv[++index] ?? "";
    else if (argument === "--artifact-version") options.artifactVersion = argv[++index] ?? "";
    else if (argument === "--version") {
      throw new Error("--version is ambiguous; use --app-version and/or --artifact-version.");
    }
    else if (argument === "--event") options.eventName = argv[++index] ?? "";
    else if (argument === "--format") options.format = argv[++index] ?? "json";
    else if (!options.root) options.root = argument;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.root) throw new Error("Usage: node scripts/summarize-telemetry.mjs <log-root> [--downloads-root PATH] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--platform darwin|win32] [--app-version VERSION] [--artifact-version VERSION] [--event EVENT_NAME] [--format json|markdown]");
  if (!["json", "markdown"].includes(options.format)) throw new Error("--format must be json or markdown");
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.from && !options.to) {
    const today = dateInTimeZone(new Date().toISOString(), "Asia/Shanghai");
    options.to = shiftDate(today, -1);
    options.from = shiftDate(options.to, -29);
  }
  const report = await summarizeTelemetryFiles(options);
  process.stdout.write(options.format === "markdown"
    ? telemetryReportMarkdown(report)
    : `${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
