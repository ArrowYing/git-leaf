const DEFAULT_SOURCE_PREVIEW_RATIO = 45;
const MIN_SOURCE_PREVIEW_RATIO = 25;
const MAX_SOURCE_PREVIEW_RATIO = 75;

export function clampSourcePreviewRatio(value) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) {
    return DEFAULT_SOURCE_PREVIEW_RATIO;
  }
  return Math.min(MAX_SOURCE_PREVIEW_RATIO, Math.max(MIN_SOURCE_PREVIEW_RATIO, ratio));
}

export function sourcePreviewRatioFromStorageValue(value) {
  if (!value) {
    return DEFAULT_SOURCE_PREVIEW_RATIO;
  }
  const ratio = Number(value);
  if (
    !Number.isFinite(ratio) ||
    ratio < MIN_SOURCE_PREVIEW_RATIO ||
    ratio > MAX_SOURCE_PREVIEW_RATIO
  ) {
    return DEFAULT_SOURCE_PREVIEW_RATIO;
  }
  return ratio;
}
