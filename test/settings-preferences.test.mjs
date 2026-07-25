import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_USER_PREFERENCES,
  LEGACY_USER_PREFERENCES,
  effectiveColorScheme,
  normalizeDocumentFontSize,
  normalizeLanguagePreference,
  normalizeUserPreferences,
  preferencePatch,
  resolveLanguagePreference,
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

test("language preferences normalize to the bounded persisted choices", () => {
  assert.equal(normalizeLanguagePreference("system"), "system");
  assert.equal(normalizeLanguagePreference(" EN "), "en");
  assert.equal(normalizeLanguagePreference("zh-cn"), "zh-CN");
  assert.equal(normalizeLanguagePreference("fr"), "system");
  assert.equal(normalizeLanguagePreference("fr", "zh-CN"), "zh-CN");
});

test("system language follows the first supported language and falls back to English", () => {
  assert.equal(resolveLanguagePreference("zh-CN", {
    systemLanguages: ["en-US"],
  }), "zh-CN");
  assert.equal(resolveLanguagePreference("en", {
    systemLanguages: ["zh-Hans"],
  }), "en");
  assert.equal(resolveLanguagePreference("system", {
    systemLanguages: ["fr-FR", "zh-Hant-TW", "en-US"],
  }), "zh-CN");
  assert.equal(resolveLanguagePreference("system", {
    systemLanguages: ["fr-FR", "en-US", "zh-CN"],
  }), "en");
  assert.equal(resolveLanguagePreference("system", {
    systemLanguages: ["fr-FR", "en_GB"],
  }), "en");
  assert.equal(resolveLanguagePreference("system", {
    systemLanguages: ["ja-JP", "fr-FR"],
  }), "en");
  assert.equal(resolveLanguagePreference("system", {
    systemLanguages: "zh-CN",
  }), "en");
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

test("preference patches whitelist only the public settings", () => {
  assert.deepEqual(preferencePatch("language", "zh-cn"), { language: "zh-CN" });
  assert.deepEqual(preferencePatch("fileTreeMode", "all"), { fileTreeMode: "all" });
  assert.deepEqual(preferencePatch("documentFontSize", "18"), { documentFontSize: 18 });
  assert.equal(preferencePatch("sidebarWidth", 800), null);
});

test("only file tree mode changes require rebuilding the file tree", () => {
  const current = {
    language: "system",
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
    language: "en",
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
