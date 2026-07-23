export const STARTUP_UPDATE_CHECK_DELAY_MS = 5_000;
export const AUTOMATIC_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1_000;
export const AUTOMATIC_UPDATE_CHECK_MIN_GAP_MS = 30 * 60 * 1_000;
export const AUTOMATIC_UPDATE_RETRY_DELAY_MS = 5 * 60 * 1_000;

export function createUpdateCheckScheduler({
  checkForUpdates,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  let startupTimer = null;
  let intervalTimer = null;
  let retryTimer = null;
  let lastAutomaticCheckAt = null;
  let started = false;

  function scheduleRetry() {
    if (!started || retryTimer !== null) {
      return false;
    }
    retryTimer = setTimeoutFn(() => {
      retryTimer = null;
      return runAutomaticCheck({ force: true });
    }, AUTOMATIC_UPDATE_RETRY_DELAY_MS);
    return true;
  }

  async function runAutomaticCheck({ force = false } = {}) {
    const checkedAt = now();
    if (
      !force &&
      lastAutomaticCheckAt !== null &&
      checkedAt - lastAutomaticCheckAt < AUTOMATIC_UPDATE_CHECK_MIN_GAP_MS
    ) {
      return "throttled";
    }
    lastAutomaticCheckAt = checkedAt;
    const result = await checkForUpdates?.({ manual: false });
    if (result === "error") {
      scheduleRetry();
    }
    return result;
  }

  return {
    start() {
      if (started) {
        return;
      }
      started = true;
      startupTimer = setTimeoutFn(() => {
        startupTimer = null;
        return runAutomaticCheck({ force: true });
      }, STARTUP_UPDATE_CHECK_DELAY_MS);
      intervalTimer = setIntervalFn(
        () => runAutomaticCheck(),
        AUTOMATIC_UPDATE_CHECK_INTERVAL_MS,
      );
    },
    stop() {
      started = false;
      if (startupTimer !== null) {
        clearTimeoutFn(startupTimer);
        startupTimer = null;
      }
      if (intervalTimer !== null) {
        clearIntervalFn(intervalTimer);
        intervalTimer = null;
      }
      if (retryTimer !== null) {
        clearTimeoutFn(retryTimer);
        retryTimer = null;
      }
    },
    onActivate() {
      if (!started) return "inactive";
      return runAutomaticCheck();
    },
    onResume() {
      if (!started) return "inactive";
      return runAutomaticCheck();
    },
    checkManually() {
      return checkForUpdates?.({ manual: true });
    },
    retrySoon() {
      return scheduleRetry();
    },
  };
}
