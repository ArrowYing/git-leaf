export const MODE_STORAGE_KEY = "git-leaf-mode";
export const MODE_STORAGE_KEY_PREFIX = "git-leaf-mode:";

export function modeFromStorageValue(value) {
  return value === "source" || value === "live" ? value : "preview";
}

export function modePreferenceStorageKey({ repoId, filePath } = {}) {
  return MODE_STORAGE_KEY;
}

export function readModePreference({ preferences, storage } = {}) {
  if (preferences && typeof preferences === "object" && "mode" in preferences) {
    return modeFromStorageValue(preferences.mode);
  }

  try {
    const key = modePreferenceStorageKey();
    const targetStorage = storage ?? globalThis.window?.localStorage;
    return modeFromStorageValue(targetStorage?.getItem(key));
  } catch {
    return "preview";
  }
}

export function writeModePreference(mode, { storage } = {}) {
  const nextMode = modeFromStorageValue(mode);
  try {
    const key = modePreferenceStorageKey();
    const targetStorage = storage ?? globalThis.window?.localStorage;
    targetStorage?.setItem(key, nextMode);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
  return nextMode;
}
