import assert from "node:assert/strict";
import test from "node:test";

import { completeDesktopShutdown } from "../src/desktop/shutdown.mjs";

test("desktop shutdown launches the updater only after every close step", async () => {
  const events = [];

  const updaterOwnsExit = await completeDesktopShutdown({
    prepareUpdate: () => events.push("prepare-update"),
    shutdownSteps: [
      () => events.push("save-window"),
      () => events.push("destroy-window"),
      async () => events.push("close-server"),
      async () => events.push("flush-telemetry"),
    ],
    installUpdate: () => {
      events.push("install-update");
      return true;
    },
    exit: () => events.push("app-exit"),
  });

  assert.equal(updaterOwnsExit, true);
  assert.deepEqual(events, [
    "prepare-update",
    "save-window",
    "destroy-window",
    "close-server",
    "flush-telemetry",
    "install-update",
  ]);
});

test("desktop shutdown attempts every close step after an earlier failure", async () => {
  const events = [];

  const updaterOwnsExit = await completeDesktopShutdown({
    prepareUpdate: () => {
      throw new Error("telemetry unavailable");
    },
    shutdownSteps: [
      () => {
        events.push("save-window");
        throw new Error("disk full");
      },
      () => events.push("destroy-window"),
      async () => events.push("close-server"),
    ],
    installUpdate: () => {
      events.push("install-update");
      throw new Error("updater unavailable");
    },
    exit: (code) => events.push(`app-exit-${code}`),
  });

  assert.equal(updaterOwnsExit, false);
  assert.deepEqual(events, [
    "save-window",
    "destroy-window",
    "close-server",
    "install-update",
    "app-exit-0",
  ]);
});
