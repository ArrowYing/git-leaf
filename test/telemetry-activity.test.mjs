import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createTelemetryActivityTracker,
  shouldAccumulateTelemetryMinute,
} from "../src/desktop/telemetry-activity.mjs";

test("legacy interactive-minute qualification requires a focused visible unlocked non-idle app", () => {
  assert.equal(shouldAccumulateTelemetryMinute({
    visible: true,
    focused: true,
    locked: false,
    idleSeconds: 10,
    quitting: false,
    updating: false,
  }), true);
  for (const override of [
    { visible: false },
    { focused: false },
    { locked: true },
    { idleSeconds: 300 },
    { quitting: true },
    { updating: true },
  ]) {
    assert.equal(shouldAccumulateTelemetryMinute({
      visible: true,
      focused: true,
      locked: false,
      idleSeconds: 10,
      quitting: false,
      updating: false,
      ...override,
    }), false);
  }
});

test("short foreground sessions settle their exact exit tail instead of disappearing", () => {
  const harness = activityHarness({ mode: "live" });
  harness.tracker.start();

  harness.advance({ milliseconds: 45_000, idleSeconds: 45 });
  harness.tracker.stop();

  assert.deepEqual(harness.durations, [{
    foregroundMs: 45_000,
    interactiveMs: 45_000,
    mode: "live",
    localDate: "2026-08-03",
  }]);
  assert.equal(harness.window.eventNames().length, 0);
  assert.equal(harness.powerMonitor.eventNames().length, 0);
});

test("quiet reading remains foreground exposure while the five-minute idle boundary limits activity", () => {
  const harness = activityHarness({ idleSeconds: 290 });
  harness.tracker.start();

  harness.advance({ milliseconds: 20_000, idleSeconds: 310 });
  harness.reconcile();
  harness.tracker.stop();

  assert.deepEqual(harness.durations, [{
    foregroundMs: 20_000,
    interactiveMs: 10_000,
    mode: "preview",
    localDate: "2026-08-03",
  }]);
});

test("physical input renews activity after idle without renderer scroll telemetry", () => {
  const harness = activityHarness({ idleSeconds: 310 });
  harness.tracker.start();

  harness.advance({ milliseconds: 5_000, idleSeconds: 2 });
  harness.reconcile();
  harness.tracker.stop();

  assert.deepEqual(harness.durations, [{
    foregroundMs: 5_000,
    interactiveMs: 2_000,
    mode: "preview",
    localDate: "2026-08-03",
  }]);
});

test("focus, lock, and mode transitions settle the previous segment immediately", () => {
  const harness = activityHarness();
  harness.tracker.start();

  harness.advance({ milliseconds: 10_000, idleSeconds: 10 });
  harness.tracker.setMode("live");
  harness.advance({ milliseconds: 20_000, idleSeconds: 30 });
  harness.focused = false;
  harness.window.emit("blur");
  harness.advance({ milliseconds: 10_000, idleSeconds: 40 });
  harness.focused = true;
  harness.window.emit("focus");
  harness.advance({ milliseconds: 10_000, idleSeconds: 50 });
  harness.powerMonitor.emit("lock-screen");
  harness.advance({ milliseconds: 10_000, idleSeconds: 60 });
  harness.powerMonitor.emit("unlock-screen");
  harness.advance({ milliseconds: 10_000, idleSeconds: 70 });
  harness.tracker.stop();

  assert.deepEqual(harness.durations, [
    { foregroundMs: 10_000, interactiveMs: 10_000, mode: "preview", localDate: "2026-08-03" },
    { foregroundMs: 20_000, interactiveMs: 20_000, mode: "live", localDate: "2026-08-03" },
    { foregroundMs: 10_000, interactiveMs: 10_000, mode: "live", localDate: "2026-08-03" },
    { foregroundMs: 10_000, interactiveMs: 10_000, mode: "live", localDate: "2026-08-03" },
  ]);
});

function activityHarness({ mode = "preview", idleSeconds: initialIdleSeconds = 0 } = {}) {
  const browserWindow = new EventEmitter();
  const powerMonitor = new EventEmitter();
  let now = 0;
  let idleSeconds = initialIdleSeconds;
  let reconcile = null;
  const durations = [];
  const harness = {
    window: browserWindow,
    powerMonitor,
    visible: true,
    focused: true,
    durations,
    advance({ milliseconds, idleSeconds: nextIdleSeconds }) {
      now += milliseconds;
      idleSeconds = nextIdleSeconds;
    },
    reconcile() {
      reconcile();
    },
  };
  browserWindow.isDestroyed = () => false;
  browserWindow.isVisible = () => harness.visible;
  browserWindow.isFocused = () => harness.focused;
  powerMonitor.getSystemIdleTime = () => idleSeconds;
  powerMonitor.getSystemIdleState = () => "active";
  harness.tracker = createTelemetryActivityTracker({
    browserWindow,
    powerMonitor,
    telemetry: { recordActivityDuration: (duration) => durations.push(duration) },
    getMode: () => mode,
    getLocalDate: () => "2026-08-03",
    clock: () => now,
    setIntervalFn: (callback) => {
      reconcile = callback;
      return 7;
    },
    clearIntervalFn: () => {},
  });
  return harness;
}
