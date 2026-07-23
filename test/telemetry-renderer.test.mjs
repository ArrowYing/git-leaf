import assert from "node:assert/strict";
import test from "node:test";

import { createRendererTelemetry } from "../public/telemetry.js";

test("renderer telemetry batches only local counter actions", async () => {
  const requests = [];
  let scheduled = null;
  const telemetry = createRendererTelemetry({
    enabled: true,
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return { ok: true };
    },
    setTimeoutFn: (callback) => {
      scheduled = callback;
      return 1;
    },
    clearTimeoutFn: () => {},
  });

  assert.equal(telemetry.recordFeature("navigation.file_search"), true);
  assert.equal(telemetry.recordFeature("git.sync", {
    strategy: "guarded_live_v1",
    result: "success",
    file_count_bucket: "2_5",
    drift_kind: "content_changed",
    retry_bucket: "1",
    duration_bucket: "1_3s",
  }), true);
  assert.equal(telemetry.setMode("live"), true);
  assert.equal(telemetry.recordFeature("bad feature", { path: "/private/repo" }), false);
  assert.equal(telemetry.recordFeature("git.sync", { result: "maybe" }), false);
  assert.equal(telemetry.recordFeature("git.sync", { path: "/private/repo" }), false);
  assert.equal(telemetry.setMode("invalid"), false);
  await scheduled();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/telemetry");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    actions: [
      { kind: "feature", featureId: "navigation.file_search", dimensions: {} },
      {
        kind: "feature",
        featureId: "git.sync",
        dimensions: {
          strategy: "guarded_live_v1",
          result: "success",
          file_count_bucket: "2_5",
          drift_kind: "content_changed",
          retry_bucket: "1",
          duration_bucket: "1_3s",
        },
      },
      { kind: "mode", mode: "live" },
    ],
  });
});

test("renderer telemetry is inert when desktop telemetry is disabled", async () => {
  let requested = false;
  const telemetry = createRendererTelemetry({
    enabled: false,
    fetchFn: async () => {
      requested = true;
    },
  });

  assert.equal(telemetry.recordFeature("navigation.file_search"), false);
  assert.equal(await telemetry.flush(), false);
  assert.equal(requested, false);
});
