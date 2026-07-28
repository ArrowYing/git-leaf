import {
  DEFAULT_USER_PREFERENCES,
  normalizeGitRemoteCheckIntervalMinutes,
} from "./settings-preferences.js";

export function remoteSyncIntervalMs(
  intervalMinutes = DEFAULT_USER_PREFERENCES.gitRemoteCheckIntervalMinutes,
) {
  return normalizeGitRemoteCheckIntervalMinutes(intervalMinutes) * 60 * 1000;
}

export const REMOTE_SYNC_INTERVAL_MS = remoteSyncIntervalMs();

export function remoteSyncCheckDue({
  intervalMinutes,
  lastAttemptAt = 0,
  now = Date.now(),
} = {}) {
  const normalizedNow = Number(now);
  const normalizedLastAttemptAt = Number(lastAttemptAt);
  return Number.isFinite(normalizedNow)
    && Number.isFinite(normalizedLastAttemptAt)
    && normalizedNow - normalizedLastAttemptAt >= remoteSyncIntervalMs(intervalMinutes);
}

export function hasGitChangesChanged(previousChanges, nextChanges) {
  const previous = Array.isArray(previousChanges) ? previousChanges : [];
  const next = Array.isArray(nextChanges) ? nextChanges : [];
  if (previous.length !== next.length) {
    return true;
  }

  return previous.some((change, index) => {
    const nextChange = next[index];
    return change?.path !== nextChange?.path
      || change?.oldPath !== nextChange?.oldPath
      || change?.status !== nextChange?.status
      || change?.rawStatus !== nextChange?.rawStatus;
  });
}

export function remoteSyncDecision({
  remote,
  localChangeCount = 0,
  canEdit = false,
  operation = "",
} = {}) {
  const localChanges = Math.max(0, Number(localChangeCount) || 0);
  const behind = Math.max(0, Number(remote?.behind) || 0);
  const remoteAvailable = remote?.ok === true;
  const busy = Boolean(operation);
  return {
    shouldAutoMerge: canEdit && !busy && remoteAvailable && behind > 0 && localChanges === 0,
    showMergeRemote: remoteAvailable && behind > 0 && localChanges > 0,
    canMergeRemote: canEdit && !busy && remoteAvailable && behind > 0 && localChanges > 0,
    canRunPrimary: canEdit && !busy,
    primaryAction: localChanges > 0 ? "publish" : "check",
    badge: localChanges > 0 ? String(localChanges) : behind > 0 ? "↓" : "",
  };
}
