export function shouldIgnoreWatchedChange({
  currentMode,
  watchedHash,
  lastWrittenHash,
}) {
  const isEditingMode = currentMode === "source" || currentMode === "live";
  return isEditingMode && Boolean(watchedHash) && watchedHash === lastWrittenHash;
}

export function syncLabelForState(state) {
  const labels = {
    idle: "",
    syncing: "",
    external: "",
    error: "同步失败",
  };
  return labels[state] ?? labels.idle;
}

export function sourceLineForPreviewSync(sourceLine, availableLines) {
  const lines = [...new Set(availableLines)]
    .filter((line) => Number.isInteger(line))
    .sort((left, right) => left - right);
  if (!Number.isInteger(sourceLine) || lines.length === 0) {
    return null;
  }

  let fallback = lines[0];
  for (const line of lines) {
    if (line > sourceLine) {
      return fallback;
    }
    fallback = line;
  }
  return fallback;
}

export function sourceLineFromPreviewScroll({ contentTop, lineRects }) {
  const rects = lineRects
    .filter((rect) => Number.isInteger(rect.line) && Number.isFinite(rect.top))
    .sort((left, right) => left.top - right.top);
  if (rects.length === 0) {
    return null;
  }

  let fallback = rects[0].line;
  for (const rect of rects) {
    if (rect.top >= contentTop) {
      return rect.line;
    }
    fallback = rect.line;
  }
  return fallback;
}
