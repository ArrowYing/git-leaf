import assert from "node:assert/strict";
import test from "node:test";

import {
  historyCommandFromBrowserShortcut,
  historyCommandFromMouseEvent,
} from "../public/mouse-navigation.js";

test("browser mouse side buttons map to document history", () => {
  assert.equal(historyCommandFromMouseEvent({ button: 3 }), "history-back");
  assert.equal(historyCommandFromMouseEvent({ button: 4 }), "history-forward");
});

test("regular mouse buttons do not trigger document history", () => {
  assert.equal(historyCommandFromMouseEvent({ button: 0 }), null);
  assert.equal(historyCommandFromMouseEvent({ button: 1 }), null);
  assert.equal(historyCommandFromMouseEvent({ button: 2 }), null);
  assert.equal(historyCommandFromMouseEvent({ button: 5 }), null);
  assert.equal(historyCommandFromMouseEvent(null), null);
});

test("browser-style keyboard events from mouse drivers map to document history", () => {
  assert.equal(
    historyCommandFromBrowserShortcut(
      { type: "keyDown", code: "ArrowLeft", meta: true, alt: true },
      { platform: "darwin" },
    ),
    "history-back",
  );
  assert.equal(
    historyCommandFromBrowserShortcut(
      { type: "keydown", code: "ArrowRight", altKey: true },
      { platform: "win32" },
    ),
    "history-forward",
  );
  assert.equal(
    historyCommandFromBrowserShortcut({ type: "keyDown", code: "BrowserBack" }),
    "history-back",
  );
  assert.equal(
    historyCommandFromBrowserShortcut({ type: "keyDown", key: "BrowserForward" }),
    "history-forward",
  );
});

test("typing and repository shortcut modifiers do not masquerade as browser history", () => {
  assert.equal(
    historyCommandFromBrowserShortcut(
      { type: "keydown", code: "ArrowLeft", altKey: true },
      { platform: "darwin" },
    ),
    null,
  );
  assert.equal(
    historyCommandFromBrowserShortcut(
      { type: "keyDown", code: "ArrowLeft", meta: true, alt: true, shift: true },
      { platform: "darwin" },
    ),
    null,
  );
  assert.equal(
    historyCommandFromBrowserShortcut(
      { type: "keyUp", code: "ArrowLeft", meta: true, alt: true },
      { platform: "darwin" },
    ),
    null,
  );
});
