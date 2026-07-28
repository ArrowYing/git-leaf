import assert from "node:assert/strict";
import test from "node:test";

import {
  SQUIRREL_DIRECT_CONTENTS_WRITE_KEY,
  configureMacUpdateInstallation,
} from "../src/desktop/mac-update-installation.mjs";

const OFFICIAL_BUILD = {
  distribution: "official",
  releaseTrack: "internal",
  dev: false,
};

test("official packaged mac builds persist Squirrel direct Contents updates", () => {
  const calls = [];
  const result = configureMacUpdateInstallation({
    platform: "darwin",
    isPackaged: true,
    buildInfo: OFFICIAL_BUILD,
    systemPreferences: {
      setUserDefault: (...args) => calls.push(args),
      getUserDefault: () => true,
    },
    log: () => {},
  });

  assert.deepEqual(result, { configured: true });
  assert.deepEqual(calls, [[
    SQUIRREL_DIRECT_CONTENTS_WRITE_KEY,
    "boolean",
    true,
  ]]);
});

test("source, development, and non-mac builds do not change native defaults", () => {
  let calls = 0;
  const systemPreferences = {
    setUserDefault: () => {
      calls += 1;
    },
  };
  const scenarios = [
    { platform: "win32", isPackaged: true, buildInfo: OFFICIAL_BUILD },
    {
      platform: "darwin",
      isPackaged: false,
      buildInfo: OFFICIAL_BUILD,
    },
    {
      platform: "darwin",
      isPackaged: true,
      buildInfo: { ...OFFICIAL_BUILD, dev: true },
    },
    {
      platform: "darwin",
      isPackaged: true,
      buildInfo: { distribution: "source", releaseTrack: "source", dev: false },
    },
  ];

  for (const scenario of scenarios) {
    assert.deepEqual(
      configureMacUpdateInstallation({ ...scenario, systemPreferences }),
      { configured: false, reason: "not-official-packaged-mac" },
    );
  }
  assert.equal(calls, 0);
});

test("official packaged mac builds fail closed when the native default is not stored", () => {
  assert.throws(
    () => configureMacUpdateInstallation({
      platform: "darwin",
      isPackaged: true,
      buildInfo: OFFICIAL_BUILD,
      systemPreferences: {
        setUserDefault: () => {},
        getUserDefault: () => false,
      },
      log: () => {},
    }),
    /Could not enable SquirrelMacEnableDirectContentsWrite/,
  );
});
