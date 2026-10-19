const MOUSE_BACK_BUTTON = 3;
const MOUSE_FORWARD_BUTTON = 4;

export function historyCommandFromMouseEvent(event) {
  if (event?.button === MOUSE_BACK_BUTTON) {
    return "history-back";
  }
  if (event?.button === MOUSE_FORWARD_BUTTON) {
    return "history-forward";
  }
  return null;
}

export function historyCommandFromBrowserShortcut(event, { platform = "" } = {}) {
  const type = String(event?.type || "").toLowerCase();
  if (type && type !== "keydown") {
    return null;
  }

  const code = String(event?.code || "");
  const key = String(event?.key || "").toLowerCase();
  if (code === "BrowserBack" || key === "browserback") {
    return "history-back";
  }
  if (code === "BrowserForward" || key === "browserforward") {
    return "history-forward";
  }

  const meta = event?.metaKey === true || event?.meta === true;
  const ctrl = event?.ctrlKey === true || event?.control === true;
  const alt = event?.altKey === true || event?.alt === true;
  const shift = event?.shiftKey === true || event?.shift === true;
  const isMac = platform === "darwin" || /^mac/i.test(platform);
  const browserModifier = isMac
    ? meta && alt && !ctrl
    : alt && !meta && !ctrl;
  if (!browserModifier || shift) {
    return null;
  }
  if (code === "ArrowLeft") {
    return "history-back";
  }
  if (code === "ArrowRight") {
    return "history-forward";
  }
  return null;
}
