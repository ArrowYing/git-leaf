export const DEFAULT_TELEMETRY_INITIAL_UPLOAD_DELAY_MS = 2_000;
export const DEFAULT_TELEMETRY_UPLOAD_INTERVAL_MS = 60_000;
export const DEFAULT_TELEMETRY_UPLOAD_TIMEOUT_MS = 10_000;
export const DEFAULT_TELEMETRY_SHUTDOWN_UPLOAD_TIMEOUT_MS = 1_500;

export function createTelemetryUploadScheduler({
  telemetry,
  initialDelayMs = DEFAULT_TELEMETRY_INITIAL_UPLOAD_DELAY_MS,
  intervalMs = DEFAULT_TELEMETRY_UPLOAD_INTERVAL_MS,
  uploadTimeoutMs = DEFAULT_TELEMETRY_UPLOAD_TIMEOUT_MS,
  shutdownUploadTimeoutMs = DEFAULT_TELEMETRY_SHUTDOWN_UPLOAD_TIMEOUT_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  let initialTimer = null;
  let intervalTimer = null;
  let inFlight = null;

  return {
    start() {
      if (initialTimer !== null || intervalTimer !== null || !telemetry) return false;
      initialTimer = setTimeoutFn(() => {
        initialTimer = null;
        return flushNow();
      }, initialDelayMs);
      initialTimer?.unref?.();
      intervalTimer = setIntervalFn(() => flushNow(), intervalMs);
      intervalTimer?.unref?.();
      return true;
    },
    stop,
    flushNow,
    async shutdown() {
      stop();
      let remainingTimeoutMs = shutdownUploadTimeoutMs;
      if (inFlight) {
        const deadline = Date.now() + shutdownUploadTimeoutMs;
        if (!await settlesWithin(inFlight, shutdownUploadTimeoutMs)) {
          return telemetry?.shutdown?.({ upload: false, uploadTimeoutMs: 0 });
        }
        remainingTimeoutMs = Math.max(0, deadline - Date.now());
      }
      return telemetry?.shutdown?.({
        upload: remainingTimeoutMs > 0,
        uploadTimeoutMs: remainingTimeoutMs,
      });
    },
  };

  function stop() {
    if (initialTimer !== null) {
      clearTimeoutFn(initialTimer);
      initialTimer = null;
    }
    if (intervalTimer !== null) {
      clearIntervalFn(intervalTimer);
      intervalTimer = null;
    }
  }

  function flushNow() {
    if (!telemetry) return Promise.resolve(false);
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(() => telemetry.queueDailySummary?.())
      .then(() => telemetry.flush?.({ timeoutMs: uploadTimeoutMs }))
      .catch(() => false)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  async function settlesWithin(promise, timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return false;
    let timeout = null;
    try {
      return await Promise.race([
        promise.then(() => true, () => true),
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }
  }
}
