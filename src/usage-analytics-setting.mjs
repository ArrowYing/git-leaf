import { readFile } from "node:fs/promises";
import path from "node:path";

const LEGACY_TELEMETRY_STATE_FILENAME = "telemetry-state.json";

export async function initializeUsageAnalyticsSetting({
  userDataDir,
  buildInfo = {},
  currentConfig = {},
  saveEnabled,
  readFileFn = readFile,
} = {}) {
  if (typeof currentConfig?.usageAnalyticsEnabled === "boolean") {
    return {
      enabled: currentConfig.usageAnalyticsEnabled,
      source: "persisted",
      config: currentConfig,
    };
  }
  if (typeof saveEnabled !== "function") {
    throw new TypeError("saveEnabled is required to initialize usage analytics.");
  }

  const migrated = await legacyTelemetryStateShowsEnabled({
    userDataDir,
    readFileFn,
  });
  const enabled = migrated || buildInfo?.usageAnalyticsDefault === true;
  const config = await saveEnabled(enabled);
  return {
    enabled,
    source: migrated ? "legacy_telemetry_state" : "build_default",
    config,
  };
}

export async function legacyTelemetryStateShowsEnabled({
  userDataDir,
  readFileFn = readFile,
} = {}) {
  let state;
  try {
    state = JSON.parse(await readFileFn(
      path.join(userDataDir, LEGACY_TELEMETRY_STATE_FILENAME),
      "utf8",
    ));
  } catch {
    return false;
  }

  return state?.schemaVersion === 1
    && uuidLike(state.installId)
    && isoDate(state.createdAt)
    && isoDate(state.observedAt)
    && semanticVersion(state.lastSeenVersion)
    && /^[a-f0-9]{32,256}$/i.test(String(state.repoSecret || ""))
    && record(state.days)
    && record(state.repositoryLastUsed);
}

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uuidLike(value) {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8a-f0-9][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
    .test(String(value || ""));
}

function isoDate(value) {
  return typeof value === "string"
    && value.trim() === value
    && !Number.isNaN(Date.parse(value));
}

function semanticVersion(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
    .test(String(value || ""));
}
