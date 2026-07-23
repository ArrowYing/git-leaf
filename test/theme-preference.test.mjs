import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const THEME_PREFERENCE_PATH = path.join(import.meta.dirname, "..", "public", "theme-preference.js");
const THEME_PREFERENCE_URL = pathToFileURL(THEME_PREFERENCE_PATH).href;

async function loadThemePreference() {
  const exists = await access(THEME_PREFERENCE_PATH).then(
    () => true,
    () => false,
  );
  assert.equal(exists, true, "expected public/theme-preference.js to exist");
  return import(`${THEME_PREFERENCE_URL}?cache=${Date.now()}`);
}

test("themeFromStorageValue accepts only the two app themes and defaults to light", async () => {
  const { themeFromStorageValue } = await loadThemePreference();

  assert.equal(themeFromStorageValue("light"), "light");
  assert.equal(themeFromStorageValue("dark"), "dark");
  assert.equal(themeFromStorageValue(" DARK "), "dark");
  assert.equal(themeFromStorageValue("system"), "light");
  assert.equal(themeFromStorageValue(""), "light");
  assert.equal(themeFromStorageValue(null), "light");
});

test("nextTheme toggles only between light and dark", async () => {
  const { nextTheme } = await loadThemePreference();

  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "light");
  assert.equal(nextTheme("system"), "dark");
});

test("readThemePreference defaults to light and tolerates unavailable storage", async () => {
  const { THEME_STORAGE_KEY, readThemePreference } = await loadThemePreference();

  assert.equal(
    readThemePreference({
      preferences: { theme: "dark" },
      storage: {
        getItem(key) {
          assert.equal(key, THEME_STORAGE_KEY);
          return "light";
        },
      },
    }),
    "dark",
  );
  assert.equal(readThemePreference({ storage: { getItem: () => "system" } }), "light");
  assert.equal(
    readThemePreference({
      storage: {
        getItem() {
          throw new Error("storage unavailable");
        },
      },
    }),
    "light",
  );
});

test("writeThemePreference stores the normalized global theme and tolerates storage errors", async () => {
  const { THEME_STORAGE_KEY, writeThemePreference } = await loadThemePreference();
  const writes = [];
  const storage = {
    setItem(key, value) {
      writes.push([key, value]);
    },
  };

  assert.equal(writeThemePreference("dark", { storage }), "dark");
  assert.deepEqual(writes, [[THEME_STORAGE_KEY, "dark"]]);

  assert.equal(writeThemePreference("unknown", { storage }), "light");
  assert.deepEqual(writes.at(-1), [THEME_STORAGE_KEY, "light"]);

  assert.equal(
    writeThemePreference("dark", {
      storage: {
        setItem() {
          throw new Error("storage unavailable");
        },
      },
    }),
    "dark",
  );
});
