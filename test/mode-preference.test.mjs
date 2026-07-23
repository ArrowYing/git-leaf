import assert from "node:assert/strict";
import test from "node:test";

import {
  MODE_STORAGE_KEY,
  MODE_STORAGE_KEY_PREFIX,
  modeFromStorageValue,
  modePreferenceStorageKey,
  readModePreference,
  writeModePreference,
} from "../public/mode-preference.js";

test("modeFromStorageValue accepts only supported document modes", () => {
  assert.equal(modeFromStorageValue("preview"), "preview");
  assert.equal(modeFromStorageValue("source"), "source");
  assert.equal(modeFromStorageValue("live"), "live");
  assert.equal(modeFromStorageValue(""), "preview");
  assert.equal(modeFromStorageValue("unknown"), "preview");
});

test("modePreferenceStorageKey uses one global app mode key", () => {
  assert.equal(modePreferenceStorageKey({ repoId: "docs-repo", filePath: "docs/guide.md" }), MODE_STORAGE_KEY);
  assert.equal(modePreferenceStorageKey({ repoId: "content-repo", filePath: "README.md" }), MODE_STORAGE_KEY);
  assert.equal(MODE_STORAGE_KEY_PREFIX, "git-leaf-mode:");
});

test("readModePreference reads one global mode across documents and repositories", () => {
  const storage = {
    getItem(key) {
      if (key === "git-leaf-mode") {
        return "live";
      }
      return null;
    },
  };

  assert.equal(readModePreference({ storage }), "live");
  assert.equal(readModePreference({ preferences: { mode: "source" }, storage }), "source");
  assert.equal(readModePreference({ preferences: { mode: "unknown" }, storage }), "preview");
  assert.equal(
    readModePreference({
      storage: {
        getItem() {
          throw new Error("storage unavailable");
        },
      },
    }),
    "preview",
  );
});

test("writeModePreference stores normalized mode globally", () => {
  const writes = [];
  const storage = {
    setItem(key, value) {
      writes.push([key, value]);
    },
  };

  assert.equal(
    writeModePreference("source", {
      storage,
    }),
    "source",
  );
  assert.deepEqual(writes, [[MODE_STORAGE_KEY, "source"]]);

  assert.equal(
    writeModePreference("bad-mode", {
      storage,
    }),
    "preview",
  );
  assert.deepEqual(writes.at(-1), [MODE_STORAGE_KEY, "preview"]);

  assert.equal(writeModePreference("live", { storage }), "live");
  assert.deepEqual(writes.at(-1), [MODE_STORAGE_KEY, "live"]);

  assert.equal(
    writeModePreference("live", {
      storage: {
        setItem() {
          throw new Error("storage unavailable");
        },
      },
    }),
    "live",
  );
});
