import assert from "node:assert/strict";
import test from "node:test";

import { completeWorkbenchStartup } from "../public/workbench-startup.js";

test("workbench becomes ready even while an occluding view suppresses animation frames", () => {
  const classes = new Set(["is-workbench-loading"]);
  let loadingRemoved = false;
  let frameRequested = false;

  completeWorkbenchStartup({
    root: {
      classList: {
        add(value) {
          classes.add(value);
        },
        remove(value) {
          classes.delete(value);
        },
      },
    },
    loadingElement: {
      remove() {
        loadingRemoved = true;
      },
    },
    requestFrame() {
      frameRequested = true;
    },
    scheduleTimeout() {},
  });

  assert.equal(frameRequested, true);
  assert.equal(classes.has("is-workbench-loading"), false);
  assert.equal(classes.has("is-workbench-ready"), true);
  assert.equal(loadingRemoved, false);
});
