import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  initializeUsageAnalyticsSetting,
  legacyTelemetryStateShowsEnabled,
} from "../src/usage-analytics-setting.mjs";

test("persisted usage analytics setting always wins over a new build default", async () => {
  let saved = false;
  const result = await initializeUsageAnalyticsSetting({
    buildInfo: { usageAnalyticsDefault: true },
    currentConfig: { usageAnalyticsEnabled: false },
    saveEnabled: async () => {
      saved = true;
    },
  });

  assert.equal(result.enabled, false);
  assert.equal(result.source, "persisted");
  assert.equal(saved, false);
});

test("new installs persist the build default exactly once", async () => {
  const saved = [];
  const result = await initializeUsageAnalyticsSetting({
    userDataDir: "/missing",
    buildInfo: { usageAnalyticsDefault: true },
    currentConfig: {},
    readFileFn: async () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
    saveEnabled: async (enabled) => {
      saved.push(enabled);
      return { usageAnalyticsEnabled: enabled };
    },
  });

  assert.equal(result.enabled, true);
  assert.equal(result.source, "build_default");
  assert.deepEqual(saved, [true]);
  assert.deepEqual(result.config, { usageAnalyticsEnabled: true });
});

test("a valid legacy telemetry state preserves internal analytics on upgrade", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-analytics-migration-"));
  await writeFile(
    path.join(userDataDir, "telemetry-state.json"),
    JSON.stringify(validLegacyState()),
    "utf8",
  );

  assert.equal(await legacyTelemetryStateShowsEnabled({ userDataDir }), true);
  const result = await initializeUsageAnalyticsSetting({
    userDataDir,
    buildInfo: { usageAnalyticsDefault: false },
    currentConfig: {},
    saveEnabled: async (enabled) => ({ usageAnalyticsEnabled: enabled }),
  });
  assert.equal(result.enabled, true);
  assert.equal(result.source, "legacy_telemetry_state");
});

test("file existence alone cannot authorize legacy analytics migration", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-analytics-migration-"));
  await writeFile(
    path.join(userDataDir, "telemetry-state.json"),
    JSON.stringify({ schemaVersion: 1, observedAt: "2026-07-23T00:00:00.000Z" }),
    "utf8",
  );

  assert.equal(await legacyTelemetryStateShowsEnabled({ userDataDir }), false);
});

function validLegacyState() {
  return {
    schemaVersion: 1,
    installId: "123e4567-e89b-42d3-a456-426614174000",
    createdAt: "2026-07-01T00:00:00.000Z",
    observedAt: "2026-07-01T00:00:01.000Z",
    lastSeenVersion: "1.11.2",
    repoSecret: "a".repeat(64),
    days: {},
    repositoryLastUsed: {},
  };
}
