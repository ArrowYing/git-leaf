import assert from "node:assert/strict";
import test from "node:test";

import { historyCommandFromMouseEvent } from "../public/mouse-navigation.js";

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
