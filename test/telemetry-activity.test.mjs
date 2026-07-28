import assert from "node:assert/strict";
import test from "node:test";

import {
  createTelemetryActivityTracker,
  shouldAccumulateTelemetryMinute,
} from "../src/desktop/telemetry-activity.mjs";

test("active minutes require a focused visible unlocked non-idle app", () => {
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

test("activity tracker records the current mode and observes lock state", () => {
  const minutes = [];
  const listeners = new Map();
  let timer = null;
  const tracker = createTelemetryActivityTracker({
    browserWindow: {
      isDestroyed: () => false,
      isVisible: () => true,
      isFocused: () => true,
    },
    powerMonitor: {
      getSystemIdleTime: () => 12,
      on: (event, listener) => listeners.set(event, listener),
      off: (event) => listeners.delete(event),
    },
    telemetry: {
      recordActiveMinute: (mode) => minutes.push(mode),
    },
    getMode: () => "live",
    setIntervalFn: (callback) => {
      timer = callback;
      return 7;
    },
    clearIntervalFn: () => {},
  });

  tracker.start();
  timer();
  listeners.get("lock-screen")();
  timer();
  listeners.get("unlock-screen")();
  timer();
  tracker.stop();

  assert.deepEqual(minutes, ["live", "live"]);
  assert.equal(listeners.size, 0);
});
