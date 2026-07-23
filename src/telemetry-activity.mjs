export function shouldAccumulateTelemetryMinute({
  visible,
  focused,
  locked,
  idleSeconds,
  quitting,
  updating,
} = {}) {
  return visible === true &&
    focused === true &&
    locked !== true &&
    Number.isFinite(idleSeconds) && idleSeconds < 300 &&
    quitting !== true &&
    updating !== true;
}

export function createTelemetryActivityTracker({
  browserWindow,
  powerMonitor,
  telemetry,
  getMode = () => "preview",
  isQuitting = () => false,
  isUpdating = () => false,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  intervalMs = 60_000,
} = {}) {
  let locked = false;
  let timer = null;
  const onLock = () => {
    locked = true;
  };
  const onUnlock = () => {
    locked = false;
  };

  return {
    start() {
      if (timer !== null) return;
      powerMonitor?.on?.("lock-screen", onLock);
      powerMonitor?.on?.("unlock-screen", onUnlock);
      timer = setIntervalFn(sample, intervalMs);
    },
    stop() {
      if (timer !== null) {
        clearIntervalFn(timer);
        timer = null;
      }
      powerMonitor?.off?.("lock-screen", onLock);
      powerMonitor?.off?.("unlock-screen", onUnlock);
    },
    sample,
  };

  function sample() {
    if (!browserWindow || browserWindow.isDestroyed?.()) return false;
    const active = shouldAccumulateTelemetryMinute({
      visible: browserWindow.isVisible?.(),
      focused: browserWindow.isFocused?.(),
      locked,
      idleSeconds: powerMonitor?.getSystemIdleTime?.(),
      quitting: isQuitting(),
      updating: isUpdating(),
    });
    if (active) telemetry?.recordActiveMinute?.(getMode());
    return active;
  }
}
