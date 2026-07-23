export const DEFAULT_USER_PREFERENCES = Object.freeze({
  colorMode: "system",
  documentFont: "system-sans",
  documentFontSize: 16,
  fileTreeMode: "content",
});

export const LEGACY_USER_PREFERENCES = Object.freeze({
  ...DEFAULT_USER_PREFERENCES,
  colorMode: "light",
  fileTreeMode: "all",
});

const COLOR_MODES = new Set(["system", "light", "dark"]);
const DOCUMENT_FONTS = new Set(["system-sans", "reading-serif"]);
const FILE_TREE_MODES = new Set(["content", "all"]);

export function normalizeColorMode(value, fallback = DEFAULT_USER_PREFERENCES.colorMode) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return COLOR_MODES.has(normalized) ? normalized : normalizeColorModeFallback(fallback);
}

export function effectiveColorScheme(colorMode, { systemDark = false } = {}) {
  const normalized = normalizeColorMode(colorMode);
  if (normalized === "system") {
    return systemDark ? "dark" : "light";
  }
  return normalized;
}

export function normalizeDocumentFont(value, fallback = DEFAULT_USER_PREFERENCES.documentFont) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return DOCUMENT_FONTS.has(normalized) ? normalized : normalizeDocumentFontFallback(fallback);
}

export function normalizeDocumentFontSize(value, fallback = DEFAULT_USER_PREFERENCES.documentFontSize) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 14 && number <= 22) {
    return number;
  }
  return normalizeDocumentFontSizeFallback(fallback);
}

export function normalizeFileTreeMode(value, fallback = DEFAULT_USER_PREFERENCES.fileTreeMode) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return FILE_TREE_MODES.has(normalized) ? normalized : normalizeFileTreeModeFallback(fallback);
}

export function normalizeUserPreferences(value, {
  defaults = DEFAULT_USER_PREFERENCES,
} = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const legacyTheme = source.theme === "light" || source.theme === "dark" ? source.theme : "";
  return {
    colorMode: normalizeColorMode(source.colorMode || legacyTheme, defaults.colorMode),
    documentFont: normalizeDocumentFont(source.documentFont, defaults.documentFont),
    documentFontSize: normalizeDocumentFontSize(source.documentFontSize, defaults.documentFontSize),
    fileTreeMode: normalizeFileTreeMode(source.fileTreeMode, defaults.fileTreeMode),
  };
}

export function shouldRebuildFileTreeForPreferences(
  previousValue,
  nextValue,
  { defaults = DEFAULT_USER_PREFERENCES } = {},
) {
  const previous = normalizeUserPreferences(previousValue, { defaults });
  const next = normalizeUserPreferences(nextValue, { defaults });
  return previous.fileTreeMode !== next.fileTreeMode;
}

export function preferencePatch(key, value) {
  switch (key) {
    case "colorMode":
      return { colorMode: normalizeColorMode(value) };
    case "documentFont":
      return { documentFont: normalizeDocumentFont(value) };
    case "documentFontSize":
      return { documentFontSize: normalizeDocumentFontSize(value) };
    case "fileTreeMode":
      return { fileTreeMode: normalizeFileTreeMode(value) };
    default:
      return null;
  }
}

function normalizeColorModeFallback(value) {
  return COLOR_MODES.has(value) ? value : DEFAULT_USER_PREFERENCES.colorMode;
}

function normalizeDocumentFontFallback(value) {
  return DOCUMENT_FONTS.has(value) ? value : DEFAULT_USER_PREFERENCES.documentFont;
}

function normalizeDocumentFontSizeFallback(value) {
  return Number.isInteger(value) && value >= 14 && value <= 22
    ? value
    : DEFAULT_USER_PREFERENCES.documentFontSize;
}

function normalizeFileTreeModeFallback(value) {
  return FILE_TREE_MODES.has(value) ? value : DEFAULT_USER_PREFERENCES.fileTreeMode;
}
