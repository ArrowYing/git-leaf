import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rename as renameFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createTelemetryClient as createTelemetryClientForPlatform,
  isTelemetryEnabled as isTelemetryEnabledForPlatform,
  normalizeTelemetryAction,
} from "../src/desktop/telemetry.mjs";

function createTelemetryClient(options = {}) {
  return createTelemetryClientForPlatform({
    platform: "darwin",
    arch: "arm64",
    ...options,
  });
}

function isTelemetryEnabled(options = {}) {
  return isTelemetryEnabledForPlatform({
    platform: "darwin",
    arch: "arm64",
    ...options,
  });
}

test("telemetry is enabled only for packaged formal stable non-development builds", () => {
  const releaseBuild = {
    version: "1.10.0",
    dev: false,
    buildId: "release.1",
    distribution: "official",
  };
  const enabled = { usageAnalyticsEnabled: true };
  assert.equal(isTelemetryEnabled({ isPackaged: true, buildInfo: releaseBuild, releaseTier: "stable", environment: {}, ...enabled }), true);
  assert.equal(isTelemetryEnabled({ isPackaged: false, buildInfo: releaseBuild, releaseTier: "stable", environment: {}, ...enabled }), false);
  assert.equal(isTelemetryEnabled({ isPackaged: true, buildInfo: { ...releaseBuild, dev: true }, releaseTier: "stable", environment: {}, ...enabled }), false);
  assert.equal(isTelemetryEnabled({ isPackaged: true, buildInfo: releaseBuild, releaseTier: "beta", environment: {}, ...enabled }), false);
  assert.equal(isTelemetryEnabled({ isPackaged: true, buildInfo: releaseBuild, releaseTier: "stable", environment: {} }), false);
  assert.equal(isTelemetryEnabled({
    isPackaged: true,
    buildInfo: { ...releaseBuild, releaseTrack: "internal" },
    releaseTier: "stable",
    environment: {},
    ...enabled,
  }), true);
  assert.equal(isTelemetryEnabled({
    isPackaged: true,
    buildInfo: { ...releaseBuild, distribution: "source" },
    releaseTier: "stable",
    environment: {},
    ...enabled,
  }), false);
  assert.equal(isTelemetryEnabled({
    isPackaged: true,
    buildInfo: { ...releaseBuild, buildId: `release-${"x".repeat(121)}` },
    releaseTier: "stable",
    environment: {},
    ...enabled,
  }), false);
  assert.equal(isTelemetryEnabled({
    isPackaged: true,
    buildInfo: { ...releaseBuild, buildId: " release.1" },
    releaseTier: "stable",
    environment: {},
    ...enabled,
  }), false);
  assert.equal(isTelemetryEnabled({
    isPackaged: true,
    buildInfo: { ...releaseBuild, buildId: "release.1\nprivate" },
    releaseTier: "stable",
    environment: {},
    ...enabled,
  }), false);
  assert.equal(isTelemetryEnabled({
    isPackaged: true,
    buildInfo: releaseBuild,
    releaseTier: "stable",
    platform: "darwin",
    arch: "ia32",
    environment: {},
    ...enabled,
  }), false);
});

test("telemetry stays disabled for CI and incomplete packaged builds", () => {
  assert.equal(isTelemetryEnabled({
    isPackaged: true,
    buildInfo: { version: "1.10.0", dev: false, buildId: "release.1", distribution: "official" },
    usageAnalyticsEnabled: true,
    releaseTier: "stable",
    environment: { CI: "true" },
  }), false);
  assert.equal(isTelemetryEnabled({
    isPackaged: true,
    buildInfo: { version: "1.10.0", dev: false, buildId: "release.1", distribution: "official" },
    usageAnalyticsEnabled: true,
    releaseTier: "stable",
    environment: { GITHUB_ACTIONS: "true" },
  }), false);
  assert.equal(isTelemetryEnabled({
    isPackaged: true,
    buildInfo: { version: "1.10.0", dev: false, buildId: "dev", distribution: "official" },
    usageAnalyticsEnabled: true,
    releaseTier: "stable",
    environment: {},
  }), false);
});

test("client omits optional text containing control characters", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-text-contract-"));
  const client = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.10.0"),
    deviceName: "Private\tDevice",
    osVersion: "15\nprivate.5",
    randomUUID: sequenceUuid(),
  });

  assert.equal(await client.initialize(), true);
  const observed = client.snapshot().queue.events.find((event) =>
    event.event_name === "git_leaf.installation.observed"
  );
  assert.deepEqual(observed.properties, { reason: "first_observed" });
  assert.equal(observed.app.os_version_major, "");
});

test("renderer telemetry accepts only registered counters and dimensions", () => {
  assert.deepEqual(normalizeTelemetryAction({
    kind: "feature",
    featureId: "navigation.deep_link",
    dimensions: { type: "exact_worktree", result: "success" },
  }), {
    kind: "feature",
    featureId: "navigation.deep_link",
    dimensions: { result: "success", type: "exact_worktree" },
  });
  assert.deepEqual(normalizeTelemetryAction({ kind: "mode", mode: "live" }), {
    kind: "mode",
    mode: "live",
  });
  assert.deepEqual(normalizeTelemetryAction({
    kind: "feature",
    featureId: "navigation.deep_link",
    dimensions: {
      type: "repository",
      result: "error",
      failure_reason: "repository_not_known",
    },
  }), {
    kind: "feature",
    featureId: "navigation.deep_link",
    dimensions: {
      failure_reason: "repository_not_known",
      result: "error",
      type: "repository",
    },
  });
  assert.equal(normalizeTelemetryAction({
    kind: "feature",
    featureId: "navigation.deep_link",
    dimensions: {
      type: "repository",
      result: "success",
      failure_reason: "repository_not_known",
    },
  }), null);
  assert.equal(normalizeTelemetryAction({
    kind: "feature",
    featureId: "navigation.deep_link",
    dimensions: { path: "/private/repo/README.md" },
  }), null);
  assert.equal(normalizeTelemetryAction({
    kind: "feature",
    featureId: "unknown.feature",
    dimensions: {},
  }), null);
});

test("update telemetry accepts a low-cardinality failure stage", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-stage-"));
  const client = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.10.0"),
    randomUUID: sequenceUuid(),
    checkpointDelayMs: 0,
  });
  await client.initialize();

  assert.equal(client.recordUpdateState({
    state: "failed",
    trigger: "automatic",
    from_version: "1.10.0",
    error_code: "network",
    stage: "check",
  }), true);
  assert.equal(client.recordUpdateState({
    state: "failed",
    trigger: "automatic",
    error_code: "network",
    stage: "private-path",
  }), false);
  assert.equal(client.recordUpdateState({
    state: "failed",
    trigger: "automatic",
    from_version: "1.10.0",
    error_code: "network",
  }), false);
  assert.equal(client.recordUpdateState({
    state: "failed",
    trigger: "automatic",
    from_version: "1.10.0",
    error_code: "network",
    stage: "download",
  }), false);
  for (const invalidTarget of ["", `1.11.0+${"a".repeat(40)}`]) {
    assert.equal(client.recordUpdateState({
      state: "failed",
      trigger: "automatic",
      from_version: "1.10.0",
      to_version: invalidTarget,
      error_code: "network",
      stage: "check",
    }), false);
  }
  assert.equal(client.recordUpdateState({
    state: "check_started",
    trigger: "automatic",
    from_version: "1.10.0",
    to_version: "1.11.0",
  }), false);
  assert.equal(client.recordUpdateState({
    state: "available",
    trigger: "automatic",
    from_version: "1.10.0",
  }), false);
  assert.equal(client.recordUpdateState({
    state: "available",
    trigger: "automatic",
    from_version: "1.10.0+build.7",
    to_version: "1.11.0-rc.1+sha.abc",
  }), true);
  assert.equal(client.recordUpdateState({
    state: "current",
    trigger: "automatic",
    from_version: "1.10.0",
    to_version: "1.11.0",
  }), false);
  assert.equal(client.recordUpdateState({
    state: "available",
    trigger: "automatic",
    from_version: "1.10.0",
    to_version: "1.10.0+different-build",
  }), false);
  assert.equal(client.recordUpdateState({
    state: "completed",
    trigger: "automatic",
    from_version: "1.9.0",
    to_version: "1.10.0+build.7",
  }), true);
  assert.equal(client.recordUpdateState({
    state: "completed",
    trigger: "automatic",
    from_version: "1.9.0",
    to_version: "1.11.0",
  }), false);
  for (const invalidVersion of [
    "1.10.0-01",
    " 1.10.0",
    "1.10",
    `1.10.0+${"a".repeat(40)}`,
  ]) {
    assert.equal(client.recordUpdateState({
      state: "available",
      trigger: "automatic",
      from_version: invalidVersion,
      to_version: "1.11.0",
    }), false);
  }
  const failed = client.snapshot().queue.events.find((event) => event.properties?.state === "failed");
  assert.equal(failed.properties.stage, "check");
});

test("telemetry initialization is best-effort and buffers early actions without blocking startup", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-buffered-"));
  let releaseMkdir;
  const mkdirGate = new Promise((resolve) => {
    releaseMkdir = resolve;
  });
  const client = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.10.0"),
    randomUUID: sequenceUuid(),
    fileSystem: {
      mkdir: async (...args) => {
        await mkdirGate;
        const { mkdir } = await import("node:fs/promises");
        return mkdir(...args);
      },
    },
  });

  const initializing = client.initialize();
  assert.equal(client.recordLaunch("manual"), true);
  assert.equal(client.recordRepositoryOpened("/repo/.git"), true);
  assert.equal(client.recordFeature("navigation.file_search"), true);
  releaseMkdir();
  assert.equal(await initializing, true);

  const day = Object.values(client.snapshot().state.days)[0];
  assert.equal(day.launchCount, 1);
  assert.equal(day.repositoryOpenCount, 1);
  assert.equal(Object.values(day.featureCounters)[0].count, 1);

  const failed = createTelemetryClient({
    enabled: true,
    userDataDir: path.join(userDataDir, "unwritable"),
    buildInfo: releaseBuild("1.10.0"),
    fileSystem: { mkdir: async () => { throw new Error("disk unavailable"); } },
  });
  const failedInitialization = failed.initialize();
  assert.equal(failed.recordLaunch("manual"), true);
  assert.equal(await failedInitialization, false);
  assert.equal(failed.enabled, false);
});

test("write-ahead checkpoint recovers state and queue after the second durable write fails", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-wal-"));
  let failStateWrite = true;
  const first = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.10.0"),
    randomUUID: sequenceUuid(),
    fileSystem: {
      rename: async (source, destination) => {
        if (failStateWrite && destination.endsWith("telemetry-state.json")) {
          failStateWrite = false;
          throw new Error("simulated crash before state commit");
        }
        return renameFile(source, destination);
      },
    },
  });

  const initializing = first.initialize();
  assert.equal(first.recordLaunch("manual"), true);
  assert.equal(await initializing, false);
  assert.ok((await readdir(userDataDir)).includes("telemetry-checkpoint.json"));

  const recovered = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.10.0"),
    randomUUID: sequenceUuid(),
  });
  assert.equal(await recovered.initialize(), true);
  const snapshot = recovered.snapshot();
  assert.equal(Object.values(snapshot.state.days)[0].launchCount, 1);
  assert.equal(snapshot.queue.events.filter((event) =>
    event.event_name === "git_leaf.installation.observed" && event.properties.reason === "first_observed"
  ).length, 1);
  assert.equal((await readdir(userDataDir)).includes("telemetry-checkpoint.json"), false);
});

test("old queues are revalidated and expired or malformed events are discarded", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-old-queue-"));
  const clock = mutableClock("2026-07-16T08:00:00.000Z");
  const first = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.10.0"),
    randomUUID: sequenceUuid(),
    now: clock.now,
  });
  await first.initialize();
  first.recordActiveMinute("preview");
  await first.queueDailySummary();
  const queuePath = path.join(userDataDir, "telemetry-queue.json");
  const queue = JSON.parse(await readFile(queuePath, "utf8"));
  const valid = queue.events.find((event) => event.event_name === "git_leaf.installation.observed");
  const validDaily = queue.events.find((event) => event.event_name === "git_leaf.daily.summary");
  const expired = {
    ...structuredClone(valid),
    event_id: "00000000-0000-4000-8000-000000000099",
    occurred_at: "2020-01-01T00:00:00.000Z",
    local_date: "2020-01-01",
  };
  const malformed = {
    ...structuredClone(valid),
    event_id: "00000000-0000-4000-8000-000000000100",
    properties: { ...valid.properties, path: "/private/repo" },
  };
  const nonexistentDate = {
    ...structuredClone(valid),
    event_id: "00000000-0000-4000-8000-000000000103",
    occurred_at: "2026-02-30T08:00:00Z",
    local_date: "2026-02-30",
  };
  const missingTimezone = {
    ...structuredClone(valid),
    event_id: "00000000-0000-4000-8000-000000000104",
    occurred_at: "2026-07-16T08:00:00",
  };
  const mismatchedLocalDate = {
    ...structuredClone(valid),
    event_id: "00000000-0000-4000-8000-000000000105",
    occurred_at: "2026-07-16T23:30:00Z",
    local_date: "2026-07-16",
    timezone_offset_minutes: 120,
  };
  const validZonedTimestamp = {
    ...structuredClone(valid),
    event_id: "00000000-0000-4000-8000-000000000109",
    occurred_at: "2026-07-16T16:00:00+08:00",
    local_date: "2026-07-16",
    timezone_offset_minutes: 480,
  };
  const unsupportedArch = {
    ...structuredClone(valid),
    event_id: "00000000-0000-4000-8000-000000000106",
    app: { ...valid.app, arch: "ia32" },
  };
  const oversizedDaily = {
    ...structuredClone(validDaily),
    event_id: "00000000-0000-4000-8000-000000000107",
    properties: {
      ...validDaily.properties,
      active_minutes: 1_000_001,
      mode_minutes: { ...validDaily.properties.mode_minutes, preview: 1_000_001 },
    },
  };
  const legacyDaily = structuredClone(validDaily);
  legacyDaily.event_id = "00000000-0000-4000-8000-000000000110";
  delete legacyDaily.properties.summary_date;
  const invalidSummaryDate = {
    ...structuredClone(validDaily),
    event_id: "00000000-0000-4000-8000-000000000111",
    properties: { ...validDaily.properties, summary_date: "2026-02-30" },
  };
  const mismatchedSummaryIdentity = {
    ...structuredClone(validDaily),
    event_id: "00000000-0000-4000-8000-000000000112",
    properties: { ...validDaily.properties, summary_date: "2026-07-15" },
  };
  const futureSummaryDate = "2026-07-17";
  const futureSummaryDateEvent = {
    ...structuredClone(validDaily),
    event_id: "00000000-0000-4000-8000-000000000113",
    properties: {
      ...validDaily.properties,
      summary_date: futureSummaryDate,
      summary_id: summaryIdFor(validDaily.install_id, futureSummaryDate),
    },
  };
  const oldSummaryDate = "2024-07-16";
  const oldExplicitDaily = {
    ...structuredClone(validDaily),
    event_id: "00000000-0000-4000-8000-000000000114",
    properties: {
      ...validDaily.properties,
      summary_date: oldSummaryDate,
      summary_id: summaryIdFor(validDaily.install_id, oldSummaryDate),
    },
  };
  const controlBuildId = {
    ...structuredClone(valid),
    event_id: "00000000-0000-4000-8000-000000000115",
    app: { ...valid.app, build_id: "release-1.10.0\nprivate" },
  };
  const controlOsVersion = {
    ...structuredClone(valid),
    event_id: "00000000-0000-4000-8000-000000000116",
    app: { ...valid.app, os_version_major: "15\tprivate" },
  };
  const emptyFirstObservedDeviceName = {
    ...structuredClone(valid),
    event_id: "00000000-0000-4000-8000-000000000117",
    properties: { ...valid.properties, device_name: "" },
  };
  const controlDeviceName = {
    ...structuredClone(valid),
    event_id: "00000000-0000-4000-8000-000000000118",
    properties: { ...valid.properties, device_name: "Private\tDevice" },
  };
  const legacyFailure = {
    ...structuredClone(valid),
    event_id: "00000000-0000-4000-8000-000000000101",
    event_name: "git_leaf.update.state_changed",
    app: { ...valid.app, version: "1.9.9", build_id: "release-1.9.9" },
    properties: {
      state: "failed",
      trigger: "automatic",
      from_version: "1.9.9",
    },
  };
  const prereleaseLegacyFailure = {
    ...structuredClone(legacyFailure),
    event_id: "00000000-0000-4000-8000-000000000108",
    app: { ...legacyFailure.app, version: "1.10.0-rc.1", build_id: "release-1.10.0-rc.1" },
    properties: { ...legacyFailure.properties, from_version: "1.10.0-rc.1" },
  };
  const strictFailureWithoutStage = {
    ...structuredClone(legacyFailure),
    event_id: "00000000-0000-4000-8000-000000000102",
    app: { ...legacyFailure.app, version: "1.10.0", build_id: "release-1.10.0" },
    properties: { ...legacyFailure.properties, from_version: "1.10.0" },
  };
  const legacyAvailable = {
    ...structuredClone(legacyFailure),
    event_id: "00000000-0000-4000-8000-000000000119",
    properties: { state: "available", trigger: "automatic", from_version: "1.9.9" },
  };
  const legacyFailedWithError = {
    ...structuredClone(legacyFailure),
    event_id: "00000000-0000-4000-8000-000000000120",
    properties: { ...legacyFailure.properties, error_code: "network" },
  };
  const legacyFailedWithStage = {
    ...structuredClone(legacyFailure),
    event_id: "00000000-0000-4000-8000-000000000121",
    properties: { ...legacyFailure.properties, stage: "download" },
  };
  const legacyAvailableWithError = {
    ...structuredClone(legacyAvailable),
    event_id: "00000000-0000-4000-8000-000000000122",
    properties: { ...legacyAvailable.properties, error_code: "network" },
  };
  const legacyAvailableWithStage = {
    ...structuredClone(legacyAvailable),
    event_id: "00000000-0000-4000-8000-000000000123",
    properties: { ...legacyAvailable.properties, stage: "check" },
  };
  const legacyFailureWithInvalidError = {
    ...structuredClone(legacyFailure),
    event_id: "00000000-0000-4000-8000-000000000124",
    properties: { ...legacyFailure.properties, error_code: "private" },
  };
  const legacyFailureWithInvalidStage = {
    ...structuredClone(legacyFailure),
    event_id: "00000000-0000-4000-8000-000000000125",
    properties: { ...legacyFailure.properties, stage: "private" },
  };
  const legacyFailureWithInvalidTarget = {
    ...structuredClone(legacyFailure),
    event_id: "00000000-0000-4000-8000-000000000126",
    properties: { ...legacyFailure.properties, to_version: "next" },
  };
  await writeFile(queuePath, `${JSON.stringify({
    ...queue,
    events: [
      valid,
      validDaily,
      expired,
      malformed,
      nonexistentDate,
      missingTimezone,
      mismatchedLocalDate,
      validZonedTimestamp,
      unsupportedArch,
      oversizedDaily,
      legacyDaily,
      invalidSummaryDate,
      mismatchedSummaryIdentity,
      futureSummaryDateEvent,
      oldExplicitDaily,
      controlBuildId,
      controlOsVersion,
      emptyFirstObservedDeviceName,
      controlDeviceName,
      legacyFailure,
      prereleaseLegacyFailure,
      strictFailureWithoutStage,
      legacyAvailable,
      legacyFailedWithError,
      legacyFailedWithStage,
      legacyAvailableWithError,
      legacyAvailableWithStage,
      legacyFailureWithInvalidError,
      legacyFailureWithInvalidStage,
      legacyFailureWithInvalidTarget,
    ],
  }, null, 2)}\n`);

  const second = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.10.0"),
    randomUUID: sequenceUuid(),
    now: clock.now,
  });
  await second.initialize();
  assert.deepEqual(second.snapshot().queue.events.map((event) => event.event_id), [
    valid.event_id,
    validDaily.event_id,
    validZonedTimestamp.event_id,
    legacyDaily.event_id,
    oldExplicitDaily.event_id,
    legacyFailure.event_id,
    prereleaseLegacyFailure.event_id,
    legacyAvailable.event_id,
    legacyFailedWithError.event_id,
    legacyFailedWithStage.event_id,
  ]);
});

test("daily rollover keeps the summarized business date separate from the queue date", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-rollover-date-"));
  const clock = mutableClock("2026-07-12T08:00:00.000Z");
  const client = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.10.0"),
    now: clock.now,
    randomUUID: sequenceUuid(),
  });
  await client.initialize();
  client.recordActiveMinute("preview");

  clock.set("2026-07-14T08:00:00.000Z");
  client.recordLaunch("manual");
  await client.checkpoint();

  const summary = client.snapshot().queue.events.find((event) =>
    event.event_name === "git_leaf.daily.summary" && event.properties.summary_date === "2026-07-12"
  );
  assert.ok(summary);
  assert.equal(summary.local_date, "2026-07-14");
  assert.equal(summary.occurred_at, "2026-07-14T08:00:00.000Z");
  assert.equal(summary.properties.summary_date, "2026-07-12");
});

test("restart queues a dirty prior-day summary with an explicit business date", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-restart-date-"));
  const clock = mutableClock("2026-07-12T08:00:00.000Z");
  const first = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.10.0"),
    now: clock.now,
    randomUUID: sequenceUuid(),
  });
  await first.initialize();
  first.recordActiveMinute("live");
  await first.checkpoint();

  clock.set("2026-07-14T08:00:00.000Z");
  const restarted = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.10.0"),
    now: clock.now,
    randomUUID: sequenceUuid(),
  });
  await restarted.initialize();

  const summary = restarted.snapshot().queue.events.find((event) =>
    event.event_name === "git_leaf.daily.summary"
  );
  assert.ok(summary);
  assert.equal(summary.local_date, "2026-07-14");
  assert.equal(summary.occurred_at, "2026-07-14T08:00:00.000Z");
  assert.equal(summary.properties.summary_date, "2026-07-12");
});

test("daily state keeps queued summaries but prunes uploaded or explicitly expired queue history", async () => {
  const start = "2026-01-01T08:00:00.000Z";
  const uploadedDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-days-uploaded-"));
  const uploadedClock = mutableClock(start);
  const uploaded = createTelemetryClient({
    enabled: true,
    userDataDir: uploadedDir,
    buildInfo: releaseBuild("1.10.0"),
    now: uploadedClock.now,
    randomUUID: sequenceUuid(),
    fetchFn: async () => ({ ok: true, status: 202 }),
  });
  await uploaded.initialize();
  for (let day = 0; day < 35; day += 1) {
    uploaded.recordActiveMinute("preview");
    await uploaded.queueDailySummary();
    await uploaded.flush({ force: true });
    uploadedClock.set(new Date(new Date(start).getTime() + (day + 1) * 86_400_000).toISOString());
  }
  assert.equal(Object.keys(uploaded.snapshot().state.days).length, 31);

  const pendingDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-days-pending-"));
  const pendingClock = mutableClock(start);
  const pending = createTelemetryClient({
    enabled: true,
    userDataDir: pendingDir,
    buildInfo: releaseBuild("1.10.0"),
    now: pendingClock.now,
    randomUUID: sequenceUuid(),
    fetchFn: async () => ({ ok: false, status: 503 }),
  });
  await pending.initialize();
  for (let day = 0; day < 20; day += 1) {
    pending.recordActiveMinute("preview");
    await pending.queueDailySummary();
    await pending.flush({ force: true });
    pendingClock.set(new Date(new Date(start).getTime() + (day + 1) * 86_400_000).toISOString());
  }
  assert.equal(Object.keys(pending.snapshot().state.days).length, 20);
  assert.ok(pending.snapshot().queue.events.some((event) => event.event_name === "git_leaf.daily.summary"));
  for (let day = 20; day < 35; day += 1) {
    pending.recordActiveMinute("preview");
    await pending.queueDailySummary();
    await pending.flush({ force: true });
    pendingClock.set(new Date(new Date(start).getTime() + (day + 1) * 86_400_000).toISOString());
  }
  assert.ok(Object.keys(pending.snapshot().state.days).length <= 31);
});

test("disabled telemetry does not create local state or call the network", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-disabled-"));
  let requested = false;
  const client = createTelemetryClient({
    enabled: false,
    userDataDir,
    fetchFn: async () => {
      requested = true;
      return { ok: true };
    },
  });

  await client.initialize();
  client.recordLaunch("manual");
  await client.flush({ force: true });

  assert.deepEqual(await readdir(userDataDir), []);
  assert.equal(requested, false);
});

test("client persists anonymous installation lifecycle and revised daily summaries", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-"));
  const sentBatches = [];
  const clock = mutableClock("2026-07-12T08:00:00.000Z");
  const client = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.5.0"),
    platform: "darwin",
    arch: "arm64",
    osVersion: "15.5.1",
    deviceName: "Example Mac",
    now: clock.now,
    randomUUID: sequenceUuid(),
    fetchFn: async (_url, options) => {
      sentBatches.push(JSON.parse(options.body));
      return { ok: true, status: 202 };
    },
    checkpointDelayMs: 0,
  });

  await client.initialize();
  client.recordLaunch("manual");
  client.recordRepositoryOpened("/private/repo/.git", { switched: false });
  client.recordFeature("navigation.file_search");
  client.recordFeature("navigation.file_search");
  client.recordFeature("git.sync", {
    strategy: "guarded_live_v1",
    result: "error",
    file_count_bucket: "2_5",
    error_code: "push_failed",
    drift_kind: "content_changed",
    retry_bucket: "1",
    duration_bucket: "3_10s",
  });
  client.recordActiveMinute("preview");
  await client.checkpoint();
  await client.queueDailySummary();

  client.recordFeature("output.pdf_export", { result: "success" });
  client.recordActiveMinute("preview");
  await client.queueDailySummary();
  await client.flush({ force: true });

  const events = sentBatches.flatMap((batch) => batch.events);
  assert.equal(events[0].event_name, "git_leaf.installation.observed");
  assert.equal(events[0].properties.device_name, "Example Mac");
  assert.doesNotMatch(JSON.stringify(events), /private\/repo|README\.md/);

  const summaries = events.filter((event) => event.event_name === "git_leaf.daily.summary");
  assert.deepEqual(summaries.map((event) => event.properties.revision), [1, 2]);
  assert.equal(summaries[0].properties.summary_id, summaries[1].properties.summary_id);
  assert.equal(summaries[1].properties.active_minutes, 2);
  assert.equal(summaries[1].properties.distinct_repository_count, 1);
  assert.deepEqual(summaries[1].properties.mode_minutes, { preview: 2, source: 0, live: 0 });
  assert.deepEqual(summaries[1].properties.feature_counts, [
    {
      feature_id: "git.sync",
      dimensions: {
        drift_kind: "content_changed",
        duration_bucket: "3_10s",
        error_code: "push_failed",
        file_count_bucket: "2_5",
        result: "error",
        retry_bucket: "1",
        strategy: "guarded_live_v1",
      },
      count: 1,
    },
    { feature_id: "navigation.file_search", count: 2 },
    { feature_id: "output.pdf_export", dimensions: { result: "success" }, count: 1 },
  ]);

  const queue = JSON.parse(await readFile(path.join(userDataDir, "telemetry-queue.json"), "utf8"));
  assert.deepEqual(queue.events, []);
});

test("client records exact foreground and interaction duration with balanced mode totals", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-duration-"));
  const client = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.18.0"),
    now: mutableClock("2026-08-03T08:00:00.000Z").now,
    randomUUID: sequenceUuid(),
  });
  await client.initialize();

  assert.equal(client.recordActivityDuration({
    foregroundMs: 90_000,
    interactiveMs: 70_000,
    mode: "preview",
  }), true);
  assert.equal(client.recordActivityDuration({
    foregroundMs: 50_000,
    interactiveMs: 40_000,
    mode: "live",
  }), true);
  assert.equal(client.recordActivityDuration({
    foregroundMs: 1_000,
    interactiveMs: 2_000,
    mode: "preview",
  }), false);
  await client.queueDailySummary();

  const summary = client.snapshot().queue.events.find((event) =>
    event.event_name === "git_leaf.daily.summary"
  );
  assert.equal(summary.properties.activity_duration_contract, "foreground_interactive_v1");
  assert.equal(summary.properties.foreground_exposure_ms, 140_000);
  assert.equal(summary.properties.interactive_active_ms, 110_000);
  assert.deepEqual(summary.properties.mode_foreground_exposure_ms, {
    preview: 90_000,
    source: 0,
    live: 50_000,
  });
  assert.deepEqual(summary.properties.mode_interactive_ms, {
    preview: 70_000,
    source: 0,
    live: 40_000,
  });
  assert.equal(summary.properties.active_minutes, 1);
  assert.deepEqual(summary.properties.mode_minutes, { preview: 1, source: 0, live: 0 });
});

test("a settled prior-day duration is queued immediately under its business date", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-duration-rollover-"));
  const clock = mutableClock("2026-08-03T08:00:00.000Z");
  const client = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.18.0"),
    now: clock.now,
    randomUUID: sequenceUuid(),
  });
  await client.initialize();

  assert.equal(client.recordActivityDuration({
    foregroundMs: 5_000,
    interactiveMs: 5_000,
    mode: "preview",
    localDate: "2026-08-02",
  }), true);

  const summary = client.snapshot().queue.events.find((event) =>
    event.event_name === "git_leaf.daily.summary"
  );
  assert.equal(summary.properties.summary_date, "2026-08-02");
  assert.equal(summary.local_date, "2026-08-03");
  assert.equal(summary.properties.foreground_exposure_ms, 5_000);
});

test("same-day legacy state stays legacy instead of claiming the duration capability retroactively", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-duration-migration-"));
  const clock = mutableClock("2026-08-03T08:00:00.000Z");
  const first = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.18.0"),
    now: clock.now,
    randomUUID: sequenceUuid(),
  });
  await first.initialize();
  first.recordLaunch("manual");
  await first.checkpoint();

  const statePath = path.join(userDataDir, "telemetry-state.json");
  const legacyState = JSON.parse(await readFile(statePath, "utf8"));
  const legacyDay = Object.values(legacyState.days)[0];
  for (const key of [
    "activityDurationContract",
    "foregroundExposureMs",
    "interactiveActiveMs",
    "modeForegroundExposureMs",
    "modeInteractiveMs",
    "legacyInteractiveRemainderMs",
  ]) delete legacyDay[key];
  await writeFile(statePath, `${JSON.stringify(legacyState, null, 2)}\n`);

  const restarted = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.18.0"),
    now: clock.now,
    randomUUID: sequenceUuid(),
  });
  await restarted.initialize();
  restarted.recordActivityDuration({ foregroundMs: 60_000, interactiveMs: 60_000, mode: "preview" });
  await restarted.queueDailySummary();

  const summary = restarted.snapshot().queue.events.findLast((event) =>
    event.event_name === "git_leaf.daily.summary"
  );
  assert.equal(Object.hasOwn(summary.properties, "activity_duration_contract"), false);
  assert.equal(summary.properties.active_minutes, 1);
});

test("daily summary polling uploads only changed revisions", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-dirty-summary-"));
  const client = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.11.1"),
    randomUUID: sequenceUuid(),
    fetchFn: async () => ({ ok: true, status: 202 }),
  });
  await client.initialize();
  client.recordLaunch("manual");

  assert.equal(await client.queueDailySummary(), true);
  const firstRevision = client.snapshot().state.days[Object.keys(client.snapshot().state.days)[0]].revision;
  await client.flush({ force: true });
  assert.equal(await client.queueDailySummary(), false);
  assert.equal(
    client.snapshot().state.days[Object.keys(client.snapshot().state.days)[0]].revision,
    firstRevision,
  );
  assert.equal(
    client.snapshot().queue.events.filter((event) => event.event_name === "git_leaf.daily.summary").length,
    0,
  );
});

test("bounded shutdown upload sends the latest launch summary", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-shutdown-upload-"));
  const sentEvents = [];
  const client = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.11.1"),
    randomUUID: sequenceUuid(),
    fetchFn: async (_url, options) => {
      sentEvents.push(...JSON.parse(options.body).events);
      return { ok: true, status: 202 };
    },
  });
  await client.initialize();
  client.recordLaunch("manual");

  await client.shutdown({ upload: true, uploadTimeoutMs: 1_500 });

  assert.ok(sentEvents.some((event) =>
    event.event_name === "git_leaf.daily.summary" && event.properties.launch_count === 1
  ));
  assert.deepEqual(client.snapshot().queue.events, []);
});

test("bounded shutdown upload preserves the queue when the network exceeds its deadline", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-shutdown-timeout-"));
  const client = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.11.1"),
    randomUUID: sequenceUuid(),
    fetchFn: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  await client.initialize();
  client.recordLaunch("manual");
  const startedAt = Date.now();

  await client.shutdown({ upload: true, uploadTimeoutMs: 10 });

  assert.ok(Date.now() - startedAt < 500);
  assert.ok(client.snapshot().queue.events.some((event) =>
    event.event_name === "git_leaf.daily.summary" && event.properties.launch_count === 1
  ));
});

test("client keeps failed uploads and reports a completed update on the next version", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-update-"));
  const clock = mutableClock("2026-07-12T08:00:00.000Z");
  const randomUUID = sequenceUuid();
  const first = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.5.0"),
    now: clock.now,
    randomUUID,
    fetchFn: async () => ({ ok: false, status: 503 }),
    checkpointDelayMs: 0,
  });
  await first.initialize();
  await first.flush({ force: true });

  clock.set("2026-07-13T08:00:00.000Z");
  const sent = [];
  const second = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.6.0"),
    now: clock.now,
    randomUUID,
    fetchFn: async (_url, options) => {
      sent.push(...JSON.parse(options.body).events);
      return { ok: true, status: 202 };
    },
    checkpointDelayMs: 0,
  });
  await second.initialize();
  await second.flush({ force: true });

  const completed = sent.find((event) =>
    event.event_name === "git_leaf.update.state_changed" && event.properties.state === "completed"
  );
  assert.deepEqual(completed.properties, {
    state: "completed",
    trigger: "automatic",
    from_version: "1.5.0",
    to_version: "1.6.0",
  });
  assert.equal(new Set(sent.map((event) => event.event_id)).size, sent.length);
});

test("build metadata changes do not create a completed version-change event", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-telemetry-build-metadata-"));
  const first = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.10.0+build.1"),
    randomUUID: sequenceUuid(),
  });
  await first.initialize();

  const second = createTelemetryClient({
    enabled: true,
    userDataDir,
    buildInfo: releaseBuild("1.10.0+build.2"),
    randomUUID: sequenceUuid(),
  });
  await second.initialize();
  assert.equal(second.snapshot().queue.events.some((event) =>
    event.event_name === "git_leaf.update.state_changed" && event.properties.state === "completed"
  ), false);
  assert.equal(second.snapshot().state.lastSeenVersion, "1.10.0+build.2");
});

function releaseBuild(version) {
  return {
    version,
    buildId: `release-${version}`,
    dev: false,
  };
}

function mutableClock(value) {
  let current = new Date(value);
  return {
    now: () => new Date(current),
    set: (next) => {
      current = new Date(next);
    },
  };
}

function sequenceUuid() {
  let value = 0;
  return () => `00000000-0000-4000-8000-${String(value += 1).padStart(12, "0")}`;
}

function summaryIdFor(installId, summaryDate, length = 32) {
  return createHash("sha256").update(`${installId}:${summaryDate}`).digest("hex").slice(0, length);
}
