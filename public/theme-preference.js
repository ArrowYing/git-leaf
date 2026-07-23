export const THEME_STORAGE_KEY = "git-leaf-theme";

const SUPPORTED_THEMES = new Set(["light", "dark"]);

export function themeFromStorageValue(value) {
  const theme = String(value ?? "").trim().toLowerCase();
  return SUPPORTED_THEMES.has(theme) ? theme : "light";
}

export function nextTheme(theme) {
  return themeFromStorageValue(theme) === "dark" ? "light" : "dark";
}

export function readThemePreference({ preferences, storage } = {}) {
  if (preferences && typeof preferences === "object" && "theme" in preferences) {
    return themeFromStorageValue(preferences.theme);
  }

  try {
    const targetStorage = storage ?? globalThis.window?.localStorage;
    return themeFromStorageValue(targetStorage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "light";
  }
}

export function writeThemePreference(theme, { storage } = {}) {
  const next = themeFromStorageValue(theme);
  try {
    const targetStorage = storage ?? globalThis.window?.localStorage;
    targetStorage?.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
  return next;
}
