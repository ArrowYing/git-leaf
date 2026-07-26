import { createHash, createHmac, randomBytes, randomUUID as nodeRandomUUID } from "node:crypto";
import {
  mkdir as mkdirFile,
  readFile as readFileContents,
  rename as renameFile,
  rm as removeFile,
  writeFile as writeFileContents,
} from "node:fs/promises";
import path from "node:path";

import { normalizeRendererTelemetryAction } from "../public/telemetry.js";
import { isOfficialDistribution } from "./build-info.mjs";

// Event semantics and allowed analytical claims are defined by
// docs/app-usage-analytics-spec.md. Update the spec before changing this contract.

export const TELEMETRY_SCHEMA_VERSION = 1;
export const DEFAULT_TELEMETRY_ENDPOINT = "https://gitleaf.mangofuture.com/telemetry/v1/events";

const STATE_FILENAME = "telemetry-state.json";
const QUEUE_FILENAME = "telemetry-queue.json";
const CHECKPOINT_FILENAME = "telemetry-checkpoint.json";
const STRICT_UPDATE_CONTRACT_VERSION = "1.10.0";
const MAX_BATCH_EVENTS = 100;
const MAX_BATCH_BYTES = 64 * 1024;
const MAX_QUEUE_BYTES = 1024 * 1024;
const MAX_QUEUE_AGE_DAYS = 30;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
const CHECKPOINT_DELAY_MS = 500;
const ENTRY_KINDS = new Set(["manual", "deep_link", "update_restart", "windows_bootstrap", "unknown"]);
const MODES = new Set(["preview", "source", "live"]);
const CLIENT_PLATFORMS = new Set(["darwin", "win32"]);
const UPDATE_STATES = new Set([
  "check_started",
  "current",
  "available",
  "downloaded",
  "skipped",
  "install_started",
  "completed",
  "failed",
]);
const UPDATE_TRIGGERS = new Set(["automatic", "manual", "windows_bootstrap"]);
const UPDATE_ERROR_CODES = new Set([
  "network",
  "manifest",
  "signature",
  "copy",
  "launch",
  "downgrade_blocked",
  "unknown",
]);
const UPDATE_FAILURE_STAGES = new Set(["check", "download", "prepare", "install", "launch", "unknown"]);
const CLIENT_EVENT_NAMES = new Set([
  "git_leaf.installation.observed",
  "git_leaf.update.state_changed",
  "git_leaf.daily.summary",
]);

export function isTelemetryEnabled({
  isPackaged,
  buildInfo,
  usageAnalyticsEnabled = false,
  releaseTier = "stable",
  platform = process.platform,
  arch = process.arch,
  environment = process.env,
} = {}) {
  const buildId = strictTelemetryText(buildInfo?.buildId, 1, 120);
  return isPackaged === true &&
    usageAnalyticsEnabled === true &&
    isOfficialDistribution(buildInfo) &&
    buildInfo?.dev !== true &&
    validSemanticVersion(buildInfo?.version) &&
    buildId !== "" &&
    buildId !== "dev" &&
    releaseTier === "stable" &&
    CLIENT_PLATFORMS.has(platform) &&
    ["arm64", "x64"].includes(arch) &&
    !isCiEnvironment(environment);
}

function isCiEnvironment(environment) {
  return [
    "CI",
    "GITHUB_ACTIONS",
    "GITLAB_CI",
    "BUILDKITE",
    "CIRCLECI",
    "TRAVIS",
    "TF_BUILD",
    "JENKINS_URL",
    "TEAMCITY_VERSION",
    "CODEBUILD_BUILD_ID",
  ].some((key) => environmentFlagEnabled(environment?.[key]));
}

function environmentFlagEnabled(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized !== "" && !["0", "false", "no", "off"].includes(normalized);
}

export function normalizeTelemetryAction(action) {
  return normalizeRendererTelemetryAction(action);
}

export function createTelemetryClient({
  enabled = false,
  userDataDir = "",
  buildInfo = {},
  endpoint = DEFAULT_TELEMETRY_ENDPOINT,
  channel = "stable",
  platform = process.platform,
  arch = process.arch,
  osVersion = "",
  deviceName = "",
  now = () => new Date(),
  randomUUID = nodeRandomUUID,
  randomSecret = () => randomBytes(32).toString("hex"),
  fetchFn = globalThis.fetch,
  checkpointDelayMs = CHECKPOINT_DELAY_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  fileSystem = {},
} = {}) {
  const buildId = strictTelemetryText(buildInfo?.buildId, 1, 120);
  const osVersionMajorCandidate = String(osVersion || "").split(".")[0];
  const osVersionMajor = validTelemetryText(osVersionMajorCandidate, 0, 12)
    ? osVersionMajorCandidate
    : "";
  let state = null;
  let queue = null;
  let initialized = false;
  let initializationStarted = false;
  let operational = enabled &&
    validSemanticVersion(buildInfo?.version) &&
    buildId !== "" &&
    channel === "stable" &&
    CLIENT_PLATFORMS.has(platform) &&
    ["arm64", "x64"].includes(arch);
  let checkpointTimer = null;
  let writeChain = Promise.resolve();
  let pendingOperations = [];

  const io = {
    mkdir: fileSystem.mkdir ?? mkdirFile,
    readFile: fileSystem.readFile ?? readFileContents,
    rename: fileSystem.rename ?? renameFile,
    rm: fileSystem.rm ?? removeFile,
    writeFile: fileSystem.writeFile ?? writeFileContents,
  };

  const statePath = path.join(userDataDir, STATE_FILENAME);
  const queuePath = path.join(userDataDir, QUEUE_FILENAME);
  const checkpointPath = path.join(userDataDir, CHECKPOINT_FILENAME);
  const uploadEndpoint = boundedString(endpoint, 2048) || DEFAULT_TELEMETRY_ENDPOINT;

  return {
    get enabled() {
      return enabled && operational;
    },
    async initialize() {
      if (!enabled || initialized) {
        return enabled && operational;
      }
      try {
        initializationStarted = true;
        await io.mkdir(userDataDir, { recursive: true });
        const recovered = normalizeCheckpoint(await readJson(checkpointPath, io));
        state = normalizeState(
          recovered?.state ?? await readJson(statePath, io),
          { now, randomUUID, randomSecret },
        );
        queue = normalizeQueue(
          recovered?.queue ?? await readJson(queuePath, io),
          { now },
        );
        const firstObserved = !state.observedAt;
        const normalizedDeviceName = strictTelemetryText(deviceName, 1, 120);
        if (firstObserved) {
          state.observedAt = now().toISOString();
          enqueueUniqueLifecycleEvent("git_leaf.installation.observed", {
            reason: "first_observed",
            ...(normalizedDeviceName ? { device_name: normalizedDeviceName } : {}),
          });
        } else if (normalizedDeviceName && normalizedDeviceName !== state.lastDeviceName) {
          enqueueUniqueLifecycleEvent("git_leaf.installation.observed", {
            reason: "device_name_changed",
            device_name: normalizedDeviceName,
          });
        }
        if (
          validSemanticVersion(state.lastSeenVersion) &&
          validSemanticVersion(buildInfo.version) &&
          compareSemanticVersions(state.lastSeenVersion, buildInfo.version) !== 0
        ) {
          const completed = normalizeUpdateProperties({
            state: "completed",
            trigger: "automatic",
            from_version: state.lastSeenVersion,
            to_version: boundedString(buildInfo.version, 40),
          }, { appVersion: buildInfo.version });
          if (completed) {
            enqueueUniqueLifecycleEvent("git_leaf.update.state_changed", completed);
          }
        }
        state.lastDeviceName = normalizedDeviceName;
        state.lastSeenVersion = boundedString(buildInfo.version, 40);
        initialized = true;
        const bufferedOperations = pendingOperations;
        pendingOperations = [];
        for (const operation of bufferedOperations) {
          applyPendingOperation(operation);
        }
        for (const day of Object.values(state.days)) {
          if (day.localDate < localDateFor(now()) && day.dirty) {
            enqueueDailySummary(day);
            day.lastAutoQueuedRevision = day.revision;
          }
        }
        pruneQueue();
        if (!(await checkpoint())) {
          initialized = false;
          return false;
        }
        return true;
      } catch {
        operational = false;
        initialized = false;
        state = null;
        queue = null;
        pendingOperations = [];
        return false;
      }
    },
    recordLaunch(entryKind = "unknown") {
      const normalized = ENTRY_KINDS.has(entryKind) ? entryKind : "unknown";
      if (!ready()) return bufferOperation({ kind: "launch", entryKind: normalized });
      const day = currentDay();
      if (day.launchCount < 1_000_000) {
        day.launchCount = incrementCount(day.launchCount);
        day.launchCountsByEntryKind[normalized] = incrementCount(day.launchCountsByEntryKind[normalized]);
      }
      day.dirty = true;
      scheduleCheckpoint();
      return true;
    },
    recordRepositoryOpened(repositoryIdentity, { switched = false, worktreeSwitch = false } = {}) {
      const normalizedIdentity = strictBoundedString(repositoryIdentity, 4096);
      if (!normalizedIdentity) return false;
      if (!ready()) {
        return bufferOperation({
          kind: "repository",
          repositoryIdentity: normalizedIdentity,
          switched: switched === true,
          worktreeSwitch: worktreeSwitch === true,
        });
      }
      const day = currentDay();
      const repoKey = createHmac("sha256", state.repoSecret)
        .update(normalizedIdentity)
        .digest("hex");
      const recordRepositoryIdentity = day.repositoryOpenCount < 1_000_000;
      if (recordRepositoryIdentity) day.repositoryOpenCount = incrementCount(day.repositoryOpenCount);
      if (switched) day.repositorySwitchCount = incrementCount(day.repositorySwitchCount);
      if (worktreeSwitch) day.worktreeSwitchCount = incrementCount(day.worktreeSwitchCount);
      if (recordRepositoryIdentity &&
          (Object.hasOwn(day.repositoryKeys, repoKey) || Object.keys(day.repositoryKeys).length < 1_000_000)) {
        day.repositoryKeys[repoKey] = true;
        state.repositoryLastUsed[repoKey] = day.localDate;
      }
      day.dirty = true;
      pruneRepositoryHistory(day.localDate);
      scheduleCheckpoint();
      return true;
    },
    recordFeature(featureId, dimensions = {}) {
      const action = normalizeTelemetryAction({ kind: "feature", featureId, dimensions });
      if (!action) return false;
      if (!ready()) return bufferOperation({ kind: "feature", action });
      const day = currentDay();
      const key = featureCounterKey(action.featureId, action.dimensions);
      if (!Object.hasOwn(day.featureCounters, key) && Object.keys(day.featureCounters).length >= 100) return false;
      const counter = day.featureCounters[key] ?? {
        featureId: action.featureId,
        dimensions: action.dimensions,
        count: 0,
      };
      counter.count = incrementCount(counter.count);
      day.featureCounters[key] = counter;
      day.dirty = true;
      scheduleCheckpoint();
      return true;
    },
    recordActiveMinute(mode = "preview") {
      if (!MODES.has(mode)) return false;
      if (!ready()) return bufferOperation({ kind: "active_minute", mode });
      const day = currentDay();
      if (day.activeMinutes < 1_000_000) {
        day.activeMinutes = incrementCount(day.activeMinutes);
        day.modeMinutes[mode] = incrementCount(day.modeMinutes[mode]);
      }
      day.dirty = true;
      scheduleCheckpoint();
      return true;
    },
    recordUpdateState(update) {
      const properties = normalizeUpdateProperties(update, { appVersion: buildInfo.version });
      if (!properties) return false;
      if (!ready()) return bufferOperation({ kind: "update", properties });
      enqueueEvent("git_leaf.update.state_changed", properties);
      scheduleCheckpoint();
      return true;
    },
    recordRendererAction(action) {
      const normalized = normalizeTelemetryAction(action);
      if (!normalized) return false;
      if (normalized.kind === "mode") return normalized;
      return this.recordFeature(normalized.featureId, normalized.dimensions);
    },
    async queueDailySummary({ localDate = localDateFor(now()) } = {}) {
      if (!ready()) return false;
      const day = state.days[localDate];
      if (!day || !day.dirty) return false;
      enqueueDailySummary(day);
      await checkpoint();
      return true;
    },
    async flush({ force = false, timeoutMs = 0 } = {}) {
      if (!ready() || typeof fetchFn !== "function") return false;
      if (!force && queue.nextRetryAt && Date.parse(queue.nextRetryAt) > now().getTime()) {
        return false;
      }
      const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Date.now() + timeoutMs
        : 0;
      let uploaded = false;
      while (queue.events.length > 0) {
        const batch = nextBatch(queue.events);
        if (batch.length === 0) break;
        const remainingTimeoutMs = deadline ? Math.max(0, deadline - Date.now()) : 0;
        const response = deadline && remainingTimeoutMs === 0
          ? null
          : await postTelemetryBatch(batch, { timeoutMs: remainingTimeoutMs });
        if (!response?.ok) {
          queue.retryAttempt += 1;
          const delay = Math.min(MAX_BACKOFF_MS, 30_000 * (2 ** Math.min(queue.retryAttempt - 1, 10)));
          queue.nextRetryAt = new Date(now().getTime() + delay).toISOString();
          await checkpoint();
          return uploaded;
        }
        const uploadedIds = new Set(batch.map((event) => event.event_id));
        markUploadedDailySummaries(batch);
        queue.events = queue.events.filter((event) => !uploadedIds.has(event.event_id));
        queue.retryAttempt = 0;
        queue.nextRetryAt = "";
        pruneDays(localDateFor(now()));
        uploaded = true;
        await checkpoint();
      }
      return uploaded;
    },
    async checkpoint() {
      return checkpoint();
    },
    async shutdown({ upload = false, uploadTimeoutMs = 0 } = {}) {
      if (!ready()) return;
      await this.queueDailySummary();
      if (upload) await this.flush({ force: true, timeoutMs: uploadTimeoutMs });
      await checkpoint();
    },
    snapshot() {
      return ready() ? structuredClone({ state, queue }) : null;
    },
  };

  function ready() {
    return enabled && operational && initialized && state && queue;
  }

  function bufferOperation(operation) {
    if (!enabled || !operational || !initializationStarted || initialized) return false;
    if (pendingOperations.length >= 200) pendingOperations.shift();
    pendingOperations.push(structuredClone(operation));
    return true;
  }

  function applyPendingOperation(operation) {
    switch (operation.kind) {
      case "launch":
        return apiRecordLaunch(operation.entryKind);
      case "repository":
        return apiRecordRepository(operation);
      case "feature":
        return apiRecordFeature(operation.action);
      case "active_minute":
        return apiRecordActiveMinute(operation.mode);
      case "update":
        enqueueEvent("git_leaf.update.state_changed", operation.properties);
        return true;
      default:
        return false;
    }
  }

  function apiRecordLaunch(entryKind) {
    const day = currentDay();
    if (day.launchCount < 1_000_000) {
      day.launchCount = incrementCount(day.launchCount);
      day.launchCountsByEntryKind[entryKind] = incrementCount(day.launchCountsByEntryKind[entryKind]);
    }
    day.dirty = true;
    return true;
  }

  function apiRecordRepository({ repositoryIdentity, switched, worktreeSwitch }) {
    const day = currentDay();
    const repoKey = createHmac("sha256", state.repoSecret).update(repositoryIdentity).digest("hex");
    const recordRepositoryIdentity = day.repositoryOpenCount < 1_000_000;
    if (recordRepositoryIdentity) day.repositoryOpenCount = incrementCount(day.repositoryOpenCount);
    if (switched) day.repositorySwitchCount = incrementCount(day.repositorySwitchCount);
    if (worktreeSwitch) day.worktreeSwitchCount = incrementCount(day.worktreeSwitchCount);
    if (recordRepositoryIdentity &&
        (Object.hasOwn(day.repositoryKeys, repoKey) || Object.keys(day.repositoryKeys).length < 1_000_000)) {
      day.repositoryKeys[repoKey] = true;
      state.repositoryLastUsed[repoKey] = day.localDate;
    }
    day.dirty = true;
    pruneRepositoryHistory(day.localDate);
    return true;
  }

  function apiRecordFeature(action) {
    const day = currentDay();
    const key = featureCounterKey(action.featureId, action.dimensions);
    if (!Object.hasOwn(day.featureCounters, key) && Object.keys(day.featureCounters).length >= 100) return false;
    const counter = day.featureCounters[key] ?? {
      featureId: action.featureId,
      dimensions: action.dimensions,
      count: 0,
    };
    counter.count = incrementCount(counter.count);
    day.featureCounters[key] = counter;
    day.dirty = true;
    return true;
  }

  function apiRecordActiveMinute(mode) {
    const day = currentDay();
    if (day.activeMinutes < 1_000_000) {
      day.activeMinutes = incrementCount(day.activeMinutes);
      day.modeMinutes[mode] = incrementCount(day.modeMinutes[mode]);
    }
    day.dirty = true;
    return true;
  }

  function currentDay() {
    const localDate = localDateFor(now());
    for (const day of Object.values(state.days)) {
      if (day.localDate < localDate && day.dirty) {
        enqueueDailySummary(day);
        day.lastAutoQueuedRevision = day.revision;
      }
    }
    state.days[localDate] ??= emptyDay({
      installId: state.installId,
      localDate,
    });
    return state.days[localDate];
  }

  function enqueueDailySummary(day) {
    day.revision += 1;
    day.lastQueuedRevision = day.revision;
    enqueueEvent("git_leaf.daily.summary", dailySummaryProperties(day, state.repositoryLastUsed));
    day.dirty = false;
  }

  function enqueueUniqueLifecycleEvent(eventName, properties) {
    const alreadyQueued = queue.events.some((event) =>
      event.event_name === eventName &&
      event.install_id === state.installId &&
      JSON.stringify(event.properties) === JSON.stringify(properties)
    );
    if (!alreadyQueued) {
      enqueueEvent(eventName, properties);
    }
  }

  function enqueueEvent(eventName, properties) {
    const occurredAt = now();
    queue.events.push({
      schema_version: TELEMETRY_SCHEMA_VERSION,
      event_id: randomUUID(),
      install_id: state.installId,
      event_name: eventName,
      occurred_at: occurredAt.toISOString(),
      local_date: localDateFor(occurredAt),
      timezone_offset_minutes: -occurredAt.getTimezoneOffset(),
      app: {
        version: boundedString(buildInfo.version, 40) || "0.0.0",
        build_id: buildId,
        channel,
        platform,
        arch,
        os_version_major: osVersionMajor,
      },
      properties,
    });
    pruneQueue();
  }

  function pruneQueue() {
    const cutoff = now().getTime() - MAX_QUEUE_AGE_DAYS * 24 * 60 * 60 * 1000;
    queue.events = queue.events.filter((event) =>
      normalizeQueuedEvent(event, { now }) && parseZonedTimestamp(event.occurred_at) >= cutoff
    );
    while (Buffer.byteLength(JSON.stringify(queue), "utf8") > MAX_QUEUE_BYTES && queue.events.length > 1) {
      const removableIndex = queue.events.findIndex((event) =>
        event.event_name === "git_leaf.daily.summary" &&
        queue.events.some((candidate) =>
          candidate !== event &&
          candidate.event_name === "git_leaf.daily.summary" &&
          candidate.properties?.summary_id === event.properties?.summary_id &&
          candidate.properties?.revision > event.properties?.revision
        )
      );
      queue.events.splice(removableIndex >= 0 ? removableIndex : 0, 1);
    }
    pruneDays(localDateFor(now()));
  }

  function markUploadedDailySummaries(events) {
    for (const event of events) {
      if (event.event_name !== "git_leaf.daily.summary") continue;
      const day = Object.values(state.days).find((candidate) =>
        candidate.summaryId === event.properties?.summary_id
      );
      if (day) {
        day.lastUploadedRevision = Math.max(
          day.lastUploadedRevision,
          nonNegativeInteger(event.properties?.revision),
        );
      }
    }
  }

  function pruneDays(referenceDate) {
    const cutoff = shiftLocalDate(referenceDate, -30);
    const queuedSummaryIds = new Set(queue.events
      .filter((event) => event.event_name === "git_leaf.daily.summary")
      .map((event) => event.properties?.summary_id));
    for (const [localDate, day] of Object.entries(state.days)) {
      if (
        localDate < cutoff &&
        (day.lastUploadedRevision >= day.revision || day.lastQueuedRevision >= day.revision) &&
        !queuedSummaryIds.has(day.summaryId)
      ) {
        delete state.days[localDate];
      }
    }
  }

  function pruneRepositoryHistory(referenceDate) {
    const cutoff = shiftLocalDate(referenceDate, -29);
    for (const [key, lastUsed] of Object.entries(state.repositoryLastUsed)) {
      if (lastUsed < cutoff) delete state.repositoryLastUsed[key];
    }
  }

  async function postTelemetryBatch(batch, { timeoutMs = 0 } = {}) {
    const abortController = typeof AbortController === "function" ? new AbortController() : null;
    const request = Promise.resolve()
      .then(() => fetchFn(uploadEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }),
        ...(abortController ? { signal: abortController.signal } : {}),
      }))
      .catch(() => null);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return request;
    let timeout = null;
    const expired = new Promise((resolve) => {
      timeout = setTimeoutFn(() => {
        abortController?.abort();
        resolve(null);
      }, timeoutMs);
    });
    try {
      return await Promise.race([request, expired]);
    } finally {
      if (timeout !== null) clearTimeoutFn(timeout);
    }
  }

  function scheduleCheckpoint() {
    if (checkpointTimer !== null) return;
    checkpointTimer = setTimeoutFn(() => {
      checkpointTimer = null;
      void checkpoint();
    }, checkpointDelayMs);
  }

  async function checkpoint() {
    if ((!ready() && !state) || !operational) return false;
    if (checkpointTimer !== null) {
      clearTimeoutFn(checkpointTimer);
      checkpointTimer = null;
    }
    const checkpointValue = structuredClone({
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      state,
      queue,
    });
    const statePayload = `${JSON.stringify(checkpointValue.state, null, 2)}\n`;
    const queuePayload = `${JSON.stringify(checkpointValue.queue, null, 2)}\n`;
    const checkpointPayload = `${JSON.stringify(checkpointValue, null, 2)}\n`;
    writeChain = writeChain.catch(() => {}).then(async () => {
      // The combined write-ahead checkpoint is authoritative after a crash. It
      // prevents state from acknowledging a lifecycle change whose queued event
      // was not persisted, and also prevents the inverse partial-write state.
      await atomicWrite(checkpointPath, checkpointPayload, io);
      await atomicWrite(queuePath, queuePayload, io);
      await atomicWrite(statePath, statePayload, io);
      await io.rm(checkpointPath, { force: true }).catch(() => {});
    });
    try {
      await writeChain;
      return true;
    } catch {
      operational = false;
      return false;
    }
  }
}

function normalizeState(value, { now, randomUUID, randomSecret }) {
  const state = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const installId = validUuidLike(state.installId) ? state.installId : randomUUID();
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    installId,
    createdAt: validDateString(state.createdAt) ? state.createdAt : now().toISOString(),
    observedAt: validDateString(state.observedAt) ? state.observedAt : "",
    lastSeenVersion: boundedString(state.lastSeenVersion, 40),
    lastDeviceName: validTelemetryText(state.lastDeviceName, 0, 120) ? state.lastDeviceName : "",
    repoSecret: boundedString(state.repoSecret, 256) || randomSecret(),
    days: normalizeDays(state.days, installId),
    repositoryLastUsed: normalizeDateMap(state.repositoryLastUsed),
  };
}

function normalizeQueue(value, { now }) {
  const cutoff = now().getTime() - MAX_QUEUE_AGE_DAYS * 24 * 60 * 60 * 1000;
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    events: Array.isArray(value?.events) ? value.events.filter((event) =>
      normalizeQueuedEvent(event, { now }) && parseZonedTimestamp(event.occurred_at) >= cutoff
    ) : [],
    retryAttempt: nonNegativeInteger(value?.retryAttempt),
    nextRetryAt: validDateString(value?.nextRetryAt) ? value.nextRetryAt : "",
  };
}

function normalizeDays(value, installId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const days = {};
  for (const [localDate, raw] of Object.entries(value)) {
    if (!validLocalDate(localDate) || !raw || typeof raw !== "object") continue;
    const fallback = emptyDay({ installId, localDate });
    days[localDate] = {
      ...fallback,
      ...raw,
      localDate,
      summaryId: raw.summaryId === fallback.summaryId ? raw.summaryId : fallback.summaryId,
      revision: nonNegativeInteger(raw.revision),
      dirty: typeof raw.dirty === "boolean"
        ? raw.dirty
        : nonNegativeInteger(raw.lastAutoQueuedRevision) !== nonNegativeInteger(raw.revision),
      lastQueuedRevision: nonNegativeInteger(raw.lastQueuedRevision),
      lastUploadedRevision: nonNegativeInteger(raw.lastUploadedRevision),
      lastAutoQueuedRevision: nonNegativeInteger(raw.lastAutoQueuedRevision),
      launchCount: nonNegativeInteger(raw.launchCount),
      launchCountsByEntryKind: normalizeCountMap(raw.launchCountsByEntryKind, ENTRY_KINDS),
      activeMinutes: nonNegativeInteger(raw.activeMinutes),
      repositoryOpenCount: nonNegativeInteger(raw.repositoryOpenCount),
      repositorySwitchCount: nonNegativeInteger(raw.repositorySwitchCount),
      worktreeSwitchCount: nonNegativeInteger(raw.worktreeSwitchCount),
      repositoryKeys: normalizeBooleanMap(raw.repositoryKeys),
      modeMinutes: {
        preview: nonNegativeInteger(raw.modeMinutes?.preview),
        source: nonNegativeInteger(raw.modeMinutes?.source),
        live: nonNegativeInteger(raw.modeMinutes?.live),
      },
      featureCounters: normalizeFeatureCounters(raw.featureCounters),
    };
  }
  return days;
}

function emptyDay({ installId, localDate }) {
  return {
    localDate,
    summaryId: createHash("sha256").update(`${installId}:${localDate}`).digest("hex").slice(0, 32),
    revision: 0,
    dirty: false,
    lastQueuedRevision: 0,
    lastUploadedRevision: 0,
    lastAutoQueuedRevision: 0,
    launchCount: 0,
    launchCountsByEntryKind: {},
    activeMinutes: 0,
    repositoryOpenCount: 0,
    repositorySwitchCount: 0,
    worktreeSwitchCount: 0,
    repositoryKeys: {},
    modeMinutes: { preview: 0, source: 0, live: 0 },
    featureCounters: {},
  };
}

function dailySummaryProperties(day, repositoryLastUsed) {
  const rollingCutoff = shiftLocalDate(day.localDate, -29);
  return {
    summary_id: day.summaryId,
    summary_date: day.localDate,
    revision: day.revision,
    launch_count: day.launchCount,
    launch_counts_by_entry_kind: sortedObject(day.launchCountsByEntryKind),
    active_minutes: day.activeMinutes,
    repository_open_count: day.repositoryOpenCount,
    repository_switch_count: day.repositorySwitchCount,
    distinct_repository_count: Object.keys(day.repositoryKeys).length,
    rolling_30d_distinct_repository_count: Object.values(repositoryLastUsed)
      .filter((lastUsed) => lastUsed >= rollingCutoff && lastUsed <= day.localDate).length,
    worktree_switch_count: day.worktreeSwitchCount,
    mode_minutes: { ...day.modeMinutes },
    feature_counts: Object.values(day.featureCounters)
      .sort((left, right) => featureCounterKey(left.featureId, left.dimensions)
        .localeCompare(featureCounterKey(right.featureId, right.dimensions)))
      .map((counter) => ({
        feature_id: counter.featureId,
        ...(Object.keys(counter.dimensions).length > 0 ? { dimensions: counter.dimensions } : {}),
        count: counter.count,
      })),
  };
}

function normalizeUpdateProperties(update, {
  appVersion,
  legacyUpdateContract = false,
} = {}) {
  if (!update || !UPDATE_STATES.has(update.state) || !UPDATE_TRIGGERS.has(update.trigger)) return null;
  const allowedKeys = new Set(["state", "trigger", "from_version", "to_version", "error_code", "stage"]);
  if (Object.keys(update).some((key) => !allowedKeys.has(key))) return null;
  const fromVersion = strictBoundedString(update.from_version, 40);
  const toVersion = update.to_version === null ? null : strictBoundedString(update.to_version, 40);
  if (!validSemanticVersion(fromVersion)) return null;
  const errorCode = update.error_code;
  const stage = update.stage;

  if (legacyUpdateContract) {
    if (errorCode !== undefined && !UPDATE_ERROR_CODES.has(errorCode)) return null;
    if (stage !== undefined && (update.state !== "failed" || !UPDATE_FAILURE_STAGES.has(stage))) return null;
    if (update.state !== "failed" && errorCode !== undefined) return null;
    if (update.to_version !== undefined && toVersion !== null && !validSemanticVersion(toVersion)) return null;
    return {
      state: update.state,
      trigger: update.trigger,
      from_version: fromVersion,
      ...(update.to_version !== undefined ? { to_version: toVersion } : {}),
      ...(errorCode ? { error_code: errorCode } : {}),
      ...(stage ? { stage } : {}),
    };
  }
  if (!validSemanticVersion(appVersion)) return null;
  const keys = Object.keys(update).sort();
  if (update.state === "check_started") {
    if (!sameKeys(keys, ["state", "trigger", "from_version"]) || compareSemanticVersions(fromVersion, appVersion) !== 0) {
      return null;
    }
  } else if (update.state === "failed") {
    if (!UPDATE_ERROR_CODES.has(errorCode) || !UPDATE_FAILURE_STAGES.has(stage)) return null;
    if (compareSemanticVersions(fromVersion, appVersion) !== 0) return null;
    if (update.to_version !== undefined && update.to_version !== null && !validSemanticVersion(toVersion)) return null;
    if (stage !== "check" && !validSemanticVersion(toVersion)) return null;
  } else {
    if (!sameKeys(keys, ["state", "trigger", "from_version", "to_version"]) || !validSemanticVersion(toVersion)) {
      return null;
    }
    if (update.state === "completed") {
      if (
        compareSemanticVersions(toVersion, appVersion) !== 0 ||
        compareSemanticVersions(toVersion, fromVersion) === 0
      ) return null;
    } else {
      if (compareSemanticVersions(fromVersion, appVersion) !== 0) return null;
      const comparison = compareSemanticVersions(toVersion, fromVersion);
      if (update.state === "current" ? comparison > 0 : comparison <= 0) return null;
    }
  }
  return {
    state: update.state,
    trigger: update.trigger,
    from_version: fromVersion,
    ...(update.state !== "check_started" && update.to_version !== undefined
      ? { to_version: toVersion }
      : {}),
    ...(errorCode ? { error_code: errorCode } : {}),
    ...(stage ? { stage } : {}),
  };
}

function normalizeQueuedEvent(event, { now: _now }) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  if (!hasExactKeys(event, [
    "schema_version",
    "event_id",
    "install_id",
    "event_name",
    "occurred_at",
    "local_date",
    "timezone_offset_minutes",
    "app",
    "properties",
  ])) return null;
  if (
    event.schema_version !== TELEMETRY_SCHEMA_VERSION ||
    !validUuidLike(event.event_id) ||
    !validUuidLike(event.install_id) ||
    !CLIENT_EVENT_NAMES.has(event.event_name) ||
    parseZonedTimestamp(event.occurred_at) === null ||
    !validLocalDate(event.local_date) ||
    !Number.isInteger(event.timezone_offset_minutes) ||
    Math.abs(event.timezone_offset_minutes) > 14 * 60 ||
    !validQueuedApp(event.app)
  ) return null;
  if (localDateAtOffset(event.occurred_at, event.timezone_offset_minutes) !== event.local_date) return null;

  if (event.event_name === "git_leaf.installation.observed") {
    return validInstallationProperties(event.properties) ? event : null;
  }
  if (event.event_name === "git_leaf.update.state_changed") {
    const legacyUpdateContract = semanticVersionBefore(
      event.app.version,
      STRICT_UPDATE_CONTRACT_VERSION,
    );
    return normalizeUpdateProperties(event.properties, {
      appVersion: event.app.version,
      legacyUpdateContract,
    }) ? event : null;
  }
  return validDailySummaryProperties(event.properties, {
    installId: event.install_id,
    envelopeLocalDate: event.local_date,
  }) ? event : null;
}

function validQueuedApp(app) {
  return app && typeof app === "object" && !Array.isArray(app) &&
    hasExactKeys(app, ["version", "build_id", "channel", "platform", "arch", "os_version_major"]) &&
    validSemanticVersion(app.version) &&
    validTelemetryText(app.build_id, 1, 120) &&
    app.channel === "stable" &&
    CLIENT_PLATFORMS.has(app.platform) &&
    ["arm64", "x64"].includes(app.arch) &&
    validTelemetryText(app.os_version_major, 0, 12);
}

function validInstallationProperties(properties) {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return false;
  const reason = properties.reason;
  if (reason === "first_observed") {
    return hasOnlyKeys(properties, ["reason", "device_name"]) &&
      (properties.device_name === undefined || validTelemetryText(properties.device_name, 1, 120));
  }
  return reason === "device_name_changed" &&
    hasExactKeys(properties, ["reason", "device_name"]) &&
    validTelemetryText(properties.device_name, 1, 120);
}

function validDailySummaryProperties(properties, { installId, envelopeLocalDate } = {}) {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return false;
  const baseKeys = [
    "summary_id",
    "revision",
    "launch_count",
    "launch_counts_by_entry_kind",
    "active_minutes",
    "repository_open_count",
    "repository_switch_count",
    "distinct_repository_count",
    "rolling_30d_distinct_repository_count",
    "worktree_switch_count",
    "mode_minutes",
    "feature_counts",
  ];
  const hasSummaryDate = Object.hasOwn(properties, "summary_date");
  if (!hasExactKeys(properties, hasSummaryDate ? [...baseKeys, "summary_date"] : baseKeys)) return false;
  if (!/^[a-f0-9]{32,64}$/.test(properties.summary_id) ||
      !positiveCount(properties.revision) || properties.revision > 100_000) return false;
  if (hasSummaryDate) {
    if (
      !validLocalDate(properties.summary_date) ||
      properties.summary_date > envelopeLocalDate ||
      !validUuidLike(installId)
    ) return false;
    const expectedSummaryId = createHash("sha256")
      .update(`${installId}:${properties.summary_date}`)
      .digest("hex")
      .slice(0, properties.summary_id.length);
    if (properties.summary_id !== expectedSummaryId) return false;
  }
  const countKeys = [
    "launch_count",
    "active_minutes",
    "repository_open_count",
    "repository_switch_count",
    "distinct_repository_count",
    "rolling_30d_distinct_repository_count",
    "worktree_switch_count",
  ];
  if (countKeys.some((key) => !validCount(properties[key]))) return false;
  const launches = properties.launch_counts_by_entry_kind;
  if (!launches || typeof launches !== "object" || Array.isArray(launches)) return false;
  if (Object.entries(launches).some(([key, count]) => !ENTRY_KINDS.has(key) || !validCount(count))) return false;
  const modes = properties.mode_minutes;
  if (!modes || typeof modes !== "object" || Array.isArray(modes) ||
      !hasExactKeys(modes, ["preview", "source", "live"]) ||
      Object.values(modes).some((count) => !validCount(count))) return false;
  if (!Array.isArray(properties.feature_counts) || properties.feature_counts.length > 100 || properties.feature_counts.some((counter) => {
    if (!counter || typeof counter !== "object" || Array.isArray(counter)) return true;
    if (!hasOnlyKeys(counter, ["feature_id", "dimensions", "count"]) ||
        !Object.hasOwn(counter, "feature_id") || !Object.hasOwn(counter, "count") ||
        !positiveCount(counter.count)) return true;
    return !normalizeTelemetryAction({
      kind: "feature",
      featureId: counter.feature_id,
      dimensions: counter.dimensions ?? {},
    });
  })) return false;
  return properties.launch_count === sumCounts(launches) &&
    properties.active_minutes === sumCounts(modes) &&
    properties.distinct_repository_count <= properties.repository_open_count &&
    properties.distinct_repository_count <= properties.rolling_30d_distinct_repository_count;
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
}

function positiveCount(value) {
  return validCount(value) && value > 0;
}

function incrementCount(value) {
  return Math.min(1_000_000, nonNegativeInteger(value) + 1);
}

function sumCounts(value) {
  return Object.values(value).reduce((sum, count) => sum + count, 0);
}

function normalizeCheckpoint(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    value.schemaVersion === TELEMETRY_SCHEMA_VERSION &&
    value.state && typeof value.state === "object" &&
    value.queue && typeof value.queue === "object"
    ? value
    : null;
}

function nextBatch(events) {
  const batch = [];
  for (const event of events.slice(0, MAX_BATCH_EVENTS)) {
    const candidate = [...batch, event];
    if (Buffer.byteLength(JSON.stringify({ events: candidate }), "utf8") > MAX_BATCH_BYTES) break;
    batch.push(event);
  }
  return batch;
}

function featureCounterKey(featureId, dimensions = {}) {
  return `${featureId}:${JSON.stringify(sortedObject(dimensions))}`;
}

function normalizeFeatureCounters(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const counters = {};
  for (const counter of Object.values(value)) {
    const action = normalizeTelemetryAction({
      kind: "feature",
      featureId: counter?.featureId,
      dimensions: counter?.dimensions ?? {},
    });
    if (!action) continue;
    counters[featureCounterKey(action.featureId, action.dimensions)] = {
      featureId: action.featureId,
      dimensions: action.dimensions,
      count: nonNegativeInteger(counter.count),
    };
  }
  return counters;
}

function normalizeCountMap(value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => allowedKeys.has(key))
    .map(([key, count]) => [key, nonNegativeInteger(count)]));
}

function normalizeBooleanMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.keys(value).filter((key) => /^[a-f0-9]{64}$/.test(key)).map((key) => [key, true]));
}

function normalizeDateMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, date]) =>
    /^[a-f0-9]{64}$/.test(key) && validLocalDate(date)
  ));
}

function hasOnlyKeys(value, allowedKeys) {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function sameKeys(actualKeys, expectedKeys) {
  const actual = [...actualKeys].sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right)));
}

function localDateFor(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftLocalDate(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function boundedString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function strictBoundedString(value, maxLength) {
  return typeof value === "string" && value === value.trim() && value.length <= maxLength
    ? value
    : "";
}

function validTelemetryText(value, minimum, maximum) {
  return typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/[\u0000-\u001F\u007F]/.test(value);
}

function strictTelemetryText(value, minimum, maximum) {
  return validTelemetryText(value, minimum, maximum) && value === value.trim() ? value : "";
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function validDateString(value) {
  return typeof value === "string" && value && Number.isFinite(Date.parse(value));
}

function validUuidLike(value) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(value);
}

function validSemanticVersion(value) {
  return parseSemanticVersion(value) !== null;
}

function parseSemanticVersion(value) {
  if (typeof value !== "string" || value.length > 40) return null;
  const match = value.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
  );
  if (!match) return null;
  const prerelease = match[4] ? match[4].split(".") : [];
  if (prerelease.some((identifier) =>
    /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")
  )) return null;
  return {
    core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])],
    prerelease,
  };
}

function semanticVersionBefore(value, boundary) {
  return compareSemanticVersions(value, boundary) < 0;
}

function compareSemanticVersions(left, right) {
  const leftValue = parseSemanticVersion(left);
  const rightValue = parseSemanticVersion(right);
  if (!leftValue || !rightValue) throw new TypeError("Semantic version comparison requires valid versions.");
  for (let index = 0; index < 3; index += 1) {
    if (leftValue.core[index] !== rightValue.core[index]) {
      return leftValue.core[index] > rightValue.core[index] ? 1 : -1;
    }
  }
  if (leftValue.prerelease.length === 0 || rightValue.prerelease.length === 0) {
    if (leftValue.prerelease.length === rightValue.prerelease.length) return 0;
    return leftValue.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.min(leftValue.prerelease.length, rightValue.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftValue.prerelease[index];
    const rightIdentifier = rightValue.prerelease[index];
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) return BigInt(leftIdentifier) > BigInt(rightIdentifier) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier > rightIdentifier ? 1 : -1;
  }
  if (leftValue.prerelease.length === rightValue.prerelease.length) return 0;
  return leftValue.prerelease.length > rightValue.prerelease.length ? 1 : -1;
}

function parseZonedTimestamp(value) {
  if (typeof value !== "string" || value.length > 40) return null;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/,
  );
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const zoneHour = Number(match[10] ?? 0);
  const zoneMinute = Number(match[11] ?? 0);
  if (
    year < 1 || month < 1 || month > 12 || day < 1 ||
    hour > 23 || minute > 59 || second > 59 || zoneHour > 23 || zoneMinute > 59
  ) return null;
  const millisecond = Number(String(match[7] ?? "").padEnd(3, "0").slice(0, 3) || 0);
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, millisecond);
  if (
    local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day ||
    local.getUTCHours() !== hour || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second
  ) return null;
  const zoneOffset = match[8] === "Z"
    ? 0
    : (match[9] === "+" ? 1 : -1) * (zoneHour * 60 + zoneMinute);
  return local.getTime() - zoneOffset * 60_000;
}

function validLocalDate(value) {
  if (typeof value !== "string") return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function localDateAtOffset(occurredAt, timezoneOffsetMinutes) {
  const timestamp = parseZonedTimestamp(occurredAt);
  if (timestamp === null) return "";
  const date = new Date(timestamp + timezoneOffsetMinutes * 60_000);
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

async function readJson(filePath, io) {
  try {
    return JSON.parse(await io.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function atomicWrite(filePath, contents, io) {
  const temporaryPath = `${filePath}.tmp`;
  await io.writeFile(temporaryPath, contents, "utf8");
  await io.rename(temporaryPath, filePath);
}
