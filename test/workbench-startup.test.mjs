import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeDocumentTabs,
  resolveActiveDocumentTabId,
} from "../public/document-tabs.js";
import {
  completeWorkbenchStartup,
  restoreDocumentTabsForStartup,
} from "../public/workbench-startup.js";

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

test("startup renders restored document tabs before opening their active document", () => {
  const calls = [];
  const restored = restoreDocumentTabsForStartup({
    session: {
      tabs: [{
        id: "tab-readme",
        path: "README.md",
        history: {
          entries: [{ path: "AGENTS.md" }, { path: "README.md" }],
          index: 1,
        },
      }],
      activeTabId: "tab-readme",
      activeTabPath: "README.md",
    },
    normalizeTabs: normalizeDocumentTabs,
    resolveActiveTabId: resolveActiveDocumentTabId,
    applyTabState(tabState, options) {
      calls.push({ tabState, options });
    },
  });

  assert.equal(restored, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].tabState.tabs.map(({ id, path }) => ({ id, path })),
    [{ id: "tab-readme", path: "README.md" }],
  );
  assert.equal(calls[0].tabState.activeTabId, "tab-readme");
  assert.deepEqual(calls[0].options, { render: true });
});
