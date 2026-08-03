import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createTelemetryUploadScheduler } from "../src/desktop/telemetry-upload-scheduler.mjs";

test("telemetry upload scheduler sends the launch summary quickly and refreshes every minute", async () => {
  const calls = [];
  const cleared = [];
  let initialCallback = null;
  let intervalCallback = null;
  const scheduler = createTelemetryUploadScheduler({
    beforeQueueDailySummary: () => calls.push("settle"),
    telemetry: {
      queueDailySummary: async () => {
        calls.push("queue");
        return true;
      },
      flush: async (options) => {
        calls.push(["flush", options]);
        return true;
      },
      shutdown: async (options) => {
        calls.push(["shutdown", options]);
      },
    },
    initialDelayMs: 2_000,
    intervalMs: 60_000,
    shutdownUploadTimeoutMs: 1_500,
    setTimeoutFn: (callback, delay) => {
      assert.equal(delay, 2_000);
      initialCallback = callback;
      return 11;
    },
    clearTimeoutFn: (timer) => cleared.push(["timeout", timer]),
    setIntervalFn: (callback, delay) => {
      assert.equal(delay, 60_000);
      intervalCallback = callback;
      return 12;
    },
    clearIntervalFn: (timer) => cleared.push(["interval", timer]),
  });

  scheduler.start();
  await initialCallback();
  await intervalCallback();
  assert.deepEqual(calls, [
    "settle",
    "queue",
    ["flush", { timeoutMs: 10_000 }],
    "settle",
    "queue",
    ["flush", { timeoutMs: 10_000 }],
  ]);

  await scheduler.shutdown();
  assert.deepEqual(cleared, [["interval", 12]]);
  assert.deepEqual(calls.at(-1), [
    "shutdown",
    { upload: true, uploadTimeoutMs: 1_500 },
  ]);
});

test("telemetry upload scheduler stops pending timers without uploading", () => {
  const cleared = [];
  const scheduler = createTelemetryUploadScheduler({
    telemetry: {},
    setTimeoutFn: () => 21,
    clearTimeoutFn: (timer) => cleared.push(["timeout", timer]),
    setIntervalFn: () => 22,
    clearIntervalFn: (timer) => cleared.push(["interval", timer]),
  });

  scheduler.start();
  scheduler.stop();

  assert.deepEqual(cleared, [["timeout", 21], ["interval", 22]]);
});

test("shutdown does not overlap a stuck periodic upload and stays bounded", async () => {
  const shutdownCalls = [];
  const scheduler = createTelemetryUploadScheduler({
    telemetry: {
      queueDailySummary: async () => true,
      flush: async () => new Promise(() => {}),
      shutdown: async (options) => shutdownCalls.push(options),
    },
    shutdownUploadTimeoutMs: 20,
  });
  void scheduler.flushNow();
  const startedAt = Date.now();

  await scheduler.shutdown();

  assert.ok(Date.now() - startedAt < 500);
  assert.deepEqual(shutdownCalls, [{ upload: false, uploadTimeoutMs: 0 }]);
});

test("shutdown deadline keeps an otherwise idle process alive until it settles", () => {
  const schedulerModuleUrl = new URL("../src/desktop/telemetry-upload-scheduler.mjs", import.meta.url).href;
  const script = `
    import { createTelemetryUploadScheduler } from ${JSON.stringify(schedulerModuleUrl)};
    const scheduler = createTelemetryUploadScheduler({
      telemetry: {
        queueDailySummary: async () => true,
        flush: async () => new Promise(() => {}),
        shutdown: async () => process.stdout.write("shutdown-complete\\n"),
      },
      shutdownUploadTimeoutMs: 20,
    });
    void scheduler.flushNow();
    await scheduler.shutdown();
  `;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "shutdown-complete\n");
});
