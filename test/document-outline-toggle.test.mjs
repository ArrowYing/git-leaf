import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readDesktopConfig,
  saveDesktopPreferences,
} from "../src/desktop/config.mjs";

test("desktop config keeps document outline layout across repositories", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-outline-toggle-"));

  await saveDesktopPreferences({
    userDataDir,
    repoRoot: "/repo/one",
    preferences: {
      documentOutlineCollapsed: true,
      documentOutlineWidth: 312,
    },
  });
  assert.equal(
    (await readDesktopConfig({ userDataDir })).preferences.documentOutlineCollapsed,
    true,
  );
  assert.equal(
    (await readDesktopConfig({ userDataDir })).preferences.documentOutlineWidth,
    312,
  );

  await saveDesktopPreferences({
    userDataDir,
    repoRoot: "/repo/two",
    preferences: { documentOutlineCollapsed: false },
  });
  assert.equal(
    (await readDesktopConfig({ userDataDir })).preferences.documentOutlineCollapsed,
    false,
  );
  assert.equal(
    (await readDesktopConfig({ userDataDir })).preferences.documentOutlineWidth,
    312,
  );
});
