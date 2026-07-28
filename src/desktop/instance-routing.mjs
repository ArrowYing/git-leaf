export function desktopSecondInstanceAction({
  isDesktopReady = false,
  request = {},
} = {}) {
  if (!desktopRequestNeedsNavigation(request)) {
    return "focus";
  }
  return isDesktopReady ? "open" : "queue";
}

export function desktopRequestNeedsNavigation(request = {}) {
  return Boolean(
    request.share
    || request.repoRoot
    || request.repository
    || request.file
    || request.handoff,
  );
}
