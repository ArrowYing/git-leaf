export const SIDEBAR_MIN_WIDTH = 120;
export const SIDEBAR_MAX_WIDTH = 560;
export const CONTENT_MIN_WIDTH = 520;

export function clampSidebarWidth(width, viewportWidth) {
  const contentAwareMax = Math.max(SIDEBAR_MIN_WIDTH, viewportWidth - CONTENT_MIN_WIDTH);
  const maxWidth = Math.min(SIDEBAR_MAX_WIDTH, contentAwareMax);
  return Math.min(Math.max(Math.round(width), SIDEBAR_MIN_WIDTH), maxWidth);
}

export function sidebarWidthFromStorageValue(value, defaultWidth = 320) {
  if (!value) {
    return defaultWidth;
  }
  const width = Number(value);
  return Number.isFinite(width) ? width : defaultWidth;
}

export function sidebarCollapsedFromStorageValue(value, defaultValue = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return defaultValue;
}
