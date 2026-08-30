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
