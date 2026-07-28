import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATIC_UPDATE_CHECK_INTERVAL_MS,
  AUTOMATIC_UPDATE_CHECK_MIN_GAP_MS,
  AUTOMATIC_UPDATE_RETRY_DELAY_MS,
  STARTUP_UPDATE_CHECK_DELAY_MS,
  createUpdateCheckScheduler,
} from "../src/desktop/update-check-schedule.mjs";

test("desktop update checks run at startup, hourly, and on meaningful activation", async () => {
  let now = 1_000_000;
  const checks = [];
  const timeouts = [];
  const intervals = [];
  const scheduler = createUpdateCheckScheduler({
    checkForUpdates: async (options) => checks.push(options),
    now: () => now,
    setTimeoutFn(callback, delay) {
      timeouts.push({ callback, delay });
      return timeouts.length;
    },
    clearTimeoutFn() {},
    setIntervalFn(callback, delay) {
      intervals.push({ callback, delay });
      return intervals.length;
    },
    clearIntervalFn() {},
  });

  scheduler.start();
  assert.equal(timeouts[0].delay, STARTUP_UPDATE_CHECK_DELAY_MS);
  assert.equal(intervals[0].delay, AUTOMATIC_UPDATE_CHECK_INTERVAL_MS);

  await timeouts[0].callback();
  assert.deepEqual(checks, [{ manual: false }]);

  now += AUTOMATIC_UPDATE_CHECK_MIN_GAP_MS - 1;
  assert.equal(await scheduler.onActivate(), "throttled");
  assert.deepEqual(checks, [{ manual: false }]);

  now += 1;
  await scheduler.onActivate();
  assert.deepEqual(checks.at(-1), { manual: false });

  now += AUTOMATIC_UPDATE_CHECK_INTERVAL_MS;
  await intervals[0].callback();
  assert.deepEqual(checks.at(-1), { manual: false });
});

test("manual update checks bypass the automatic scheduler", async () => {
  const checks = [];
  const scheduler = createUpdateCheckScheduler({
    checkForUpdates: async (options) => checks.push(options),
    setTimeoutFn: () => 1,
    clearTimeoutFn() {},
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });

  await scheduler.checkManually();
  await scheduler.checkManually();
  assert.deepEqual(checks, [{ manual: true }, { manual: true }]);
});

test("automatic update failures receive one short retry", async () => {
  const timeouts = [];
  let calls = 0;
  const scheduler = createUpdateCheckScheduler({
    checkForUpdates: async () => (++calls === 1 ? "error" : "current"),
    setTimeoutFn(callback, delay) {
      timeouts.push({ callback, delay });
      return timeouts.length;
    },
    clearTimeoutFn() {},
    setIntervalFn: () => 1,
    clearIntervalFn() {},
  });

  scheduler.start();
  await timeouts[0].callback();
  assert.equal(timeouts[1].delay, AUTOMATIC_UPDATE_RETRY_DELAY_MS);
  await timeouts[1].callback();
  assert.equal(calls, 2);
});
