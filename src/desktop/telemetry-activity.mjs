export const TELEMETRY_INTERACTIVE_IDLE_SECONDS = 300;
export const DEFAULT_TELEMETRY_ACTIVITY_RECONCILE_INTERVAL_MS = 5_000;

const MODES = new Set(["preview", "source", "live"]);
const WINDOW_TRANSITION_EVENTS = ["focus", "blur", "show", "hide", "minimize", "restore", "closed"];

export function shouldAccumulateTelemetryMinute({
  visible,
  focused,
  locked,
  idleSeconds,
  quitting,
  updating,
} = {}) {
  return foregroundEligible({ visible, focused, locked, quitting, updating }) &&
    Number.isFinite(idleSeconds) && idleSeconds < TELEMETRY_INTERACTIVE_IDLE_SECONDS;
}

export function createTelemetryActivityTracker({
  browserWindow,
  powerMonitor,
  telemetry,
  getMode = () => "preview",
  getLocalDate = currentLocalDate,
  isQuitting = () => false,
  isUpdating = () => false,
  clock = defaultMonotonicClock,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  intervalMs = DEFAULT_TELEMETRY_ACTIVITY_RECONCILE_INTERVAL_MS,
} = {}) {
  let locked = false;
  let suspended = false;
  let timer = null;
  let lastSettledAt = null;
  let previous = null;
  let mode = normalizedMode(getMode());

  const onWindowTransition = () => {
    settle();
  };
  const onLock = () => transition(() => {
    locked = true;
  });
  const onUnlock = () => transition(() => {
    locked = false;
  });
  const onSuspend = () => transition(() => {
    suspended = true;
  });
  const onResume = () => transition(() => {
    suspended = false;
  });

  return {
    start() {
      if (timer !== null) return false;
      locked = initialLockState(powerMonitor);
      mode = normalizedMode(getMode());
      attachListeners();
      lastSettledAt = finiteClockValue(clock());
      previous = activitySnapshot();
      timer = setIntervalFn(settle, intervalMs);
      timer?.unref?.();
      return true;
    },
    stop() {
      if (timer === null) return false;
      settle();
      clearIntervalFn(timer);
      timer = null;
      detachListeners();
      lastSettledAt = null;
      previous = null;
      return true;
    },
    flush: settle,
    sample: settle,
    setMode(nextMode) {
      const normalized = normalizedMode(nextMode);
      if (normalized === mode) return false;
      settle();
      mode = normalized;
      resetSnapshot();
      return true;
    },
  };

  function attachListeners() {
    for (const event of WINDOW_TRANSITION_EVENTS) browserWindow?.on?.(event, onWindowTransition);
    powerMonitor?.on?.("lock-screen", onLock);
    powerMonitor?.on?.("unlock-screen", onUnlock);
    powerMonitor?.on?.("suspend", onSuspend);
    powerMonitor?.on?.("resume", onResume);
  }

  function detachListeners() {
    for (const event of WINDOW_TRANSITION_EVENTS) browserWindow?.off?.(event, onWindowTransition);
    powerMonitor?.off?.("lock-screen", onLock);
    powerMonitor?.off?.("unlock-screen", onUnlock);
    powerMonitor?.off?.("suspend", onSuspend);
    powerMonitor?.off?.("resume", onResume);
  }

  function transition(change) {
    settle();
    change();
    resetSnapshot();
  }

  function resetSnapshot() {
    if (timer === null) return;
    lastSettledAt = finiteClockValue(clock());
    previous = activitySnapshot();
  }

  function settle() {
    if (timer === null || previous === null || lastSettledAt === null) return false;
    const settledAt = finiteClockValue(clock());
    const elapsedMs = Math.max(0, settledAt - lastSettledAt);
    const current = activitySnapshot();
    const foregroundMs = previous.foreground ? elapsedMs : 0;
    const interactiveMs = foregroundMs > 0
      ? interactiveElapsedMilliseconds(previous, current, elapsedMs)
      : 0;
    const duration = {
      foregroundMs: normalizedDurationMilliseconds(foregroundMs),
      interactiveMs: normalizedDurationMilliseconds(Math.min(foregroundMs, interactiveMs)),
      mode: previous.mode,
      localDate: previous.localDate,
    };
    lastSettledAt = settledAt;
    previous = current;
    if (duration.foregroundMs <= 0) return false;
    return telemetry?.recordActivityDuration?.(duration) ?? false;
  }

  function activitySnapshot() {
    const destroyed = !browserWindow || browserWindow.isDestroyed?.() === true;
    const idleSeconds = safeIdleSeconds(powerMonitor);
    const foreground = !destroyed && !suspended && foregroundEligible({
      visible: browserWindow?.isVisible?.(),
      focused: browserWindow?.isFocused?.(),
      locked,
      quitting: isQuitting(),
      updating: isUpdating(),
    });
    return {
      foreground,
      interactive: foreground && Number.isFinite(idleSeconds) &&
        idleSeconds < TELEMETRY_INTERACTIVE_IDLE_SECONDS,
      idleSeconds,
      mode,
      localDate: getLocalDate(),
    };
  }
}

function foregroundEligible({ visible, focused, locked, quitting, updating } = {}) {
  return visible === true &&
    focused === true &&
    locked !== true &&
    quitting !== true &&
    updating !== true;
}

function interactiveElapsedMilliseconds(previous, current, elapsedMs) {
  const initiallyActiveMs = previous.interactive && Number.isFinite(previous.idleSeconds)
    ? Math.min(
      elapsedMs,
      Math.max(0, TELEMETRY_INTERACTIVE_IDLE_SECONDS - previous.idleSeconds) * 1_000,
    )
    : 0;
  const resumedAtMs = (
    current.foreground &&
    Number.isFinite(current.idleSeconds) &&
    current.idleSeconds < TELEMETRY_INTERACTIVE_IDLE_SECONDS &&
    idleTimeReset(previous.idleSeconds, current.idleSeconds, elapsedMs)
  )
    ? Math.max(0, elapsedMs - current.idleSeconds * 1_000)
    : elapsedMs;
  const resumedActiveMs = Math.max(0, elapsedMs - Math.max(initiallyActiveMs, resumedAtMs));
  return initiallyActiveMs + resumedActiveMs;
}

function idleTimeReset(previousIdleSeconds, currentIdleSeconds, elapsedMs) {
  if (!Number.isFinite(previousIdleSeconds)) return true;
  const expectedWithoutInput = previousIdleSeconds + elapsedMs / 1_000;
  return currentIdleSeconds + 0.5 < expectedWithoutInput;
}

function initialLockState(powerMonitor) {
  try {
    return powerMonitor?.getSystemIdleState?.(TELEMETRY_INTERACTIVE_IDLE_SECONDS) === "locked";
  } catch {
    return false;
  }
}

function safeIdleSeconds(powerMonitor) {
  try {
    const value = powerMonitor?.getSystemIdleTime?.();
    return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

function normalizedMode(value) {
  return MODES.has(value) ? value : "preview";
}

function finiteClockValue(value) {
  return Number.isFinite(value) ? value : 0;
}

function normalizedDurationMilliseconds(value) {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}

function defaultMonotonicClock() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function currentLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
