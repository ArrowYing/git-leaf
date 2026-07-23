import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_USER_PREFERENCES,
  LEGACY_USER_PREFERENCES,
  effectiveColorScheme,
  normalizeDocumentFontSize,
  normalizeUserPreferences,
  preferencePatch,
  shouldRebuildFileTreeForPreferences,
} from "../public/settings-preferences.js";

test("new and legacy installs have deliberate user preference defaults", () => {
  assert.deepEqual(normalizeUserPreferences({}), DEFAULT_USER_PREFERENCES);
  assert.deepEqual(
    normalizeUserPreferences({}, { defaults: LEGACY_USER_PREFERENCES }),
    LEGACY_USER_PREFERENCES,
  );
});

test("legacy light and dark themes migrate into color mode", () => {
  assert.equal(normalizeUserPreferences({ theme: "dark" }).colorMode, "dark");
  assert.equal(normalizeUserPreferences({ theme: "light" }).colorMode, "light");
  assert.equal(
    normalizeUserPreferences({ colorMode: "system", theme: "dark" }).colorMode,
    "system",
  );
});

test("system color mode resolves without overwriting the stored choice", () => {
  assert.equal(effectiveColorScheme("system", { systemDark: false }), "light");
  assert.equal(effectiveColorScheme("system", { systemDark: true }), "dark");
  assert.equal(effectiveColorScheme("light", { systemDark: true }), "light");
});

test("document font size accepts only whole pixels from 14 through 22", () => {
  assert.equal(normalizeDocumentFontSize(14), 14);
  assert.equal(normalizeDocumentFontSize("22"), 22);
  assert.equal(normalizeDocumentFontSize(13), 16);
  assert.equal(normalizeDocumentFontSize(22.5), 16);
});

test("preference patches whitelist only the four public settings", () => {
  assert.deepEqual(preferencePatch("fileTreeMode", "all"), { fileTreeMode: "all" });
  assert.deepEqual(preferencePatch("documentFontSize", "18"), { documentFontSize: 18 });
  assert.equal(preferencePatch("sidebarWidth", 800), null);
});

test("only file tree mode changes require rebuilding the file tree", () => {
  const current = {
    colorMode: "system",
    documentFont: "system-sans",
    documentFontSize: 16,
    fileTreeMode: "content",
  };

  assert.equal(shouldRebuildFileTreeForPreferences(current, {
    ...current,
    colorMode: "dark",
    documentFont: "reading-serif",
    documentFontSize: 20,
  }), false);
  assert.equal(shouldRebuildFileTreeForPreferences(current, {
    ...current,
    fileTreeMode: "all",
  }), true);
  assert.equal(shouldRebuildFileTreeForPreferences(current, {
    ...current,
    futurePreference: { enabled: true },
  }), false);
});
