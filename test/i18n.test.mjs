import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
  createTranslator,
  formatMessage,
  localizeDocument,
  normalizeLocaleTag,
  resolveLocalePreference,
} from "../public/i18n.js";
import { WORKBENCH_MESSAGES } from "../public/workbench-locales.js";

test("system language resolution uses the first supported locale and defaults to English", () => {
  assert.equal(resolveLocalePreference("system", ["fr-FR", "zh-Hans", "en-US"]), "zh-CN");
  assert.equal(resolveLocalePreference("system", ["fr-FR", "en-GB", "zh-CN"]), "en");
  assert.equal(resolveLocalePreference("system", ["fr-FR"]), "en");
  assert.equal(resolveLocalePreference("zh-TW", ["en-US"]), "zh-CN");
  assert.equal(resolveLocalePreference("de-DE", ["zh-CN"]), "en");
  assert.equal(normalizeLocaleTag("zh_Hans"), "zh-CN");
});

test("document localization updates language, visible copy, and accessible attributes", () => {
  const textElement = fakeElement({ "data-i18n": "title" });
  const titleElement = fakeElement({ "data-i18n-title": "tooltip" });
  const placeholderElement = fakeElement({ "data-i18n-placeholder": "placeholder" });
  const ariaElement = fakeElement({ "data-i18n-aria-label": "aria" });
  const emptyLabelElement = fakeElement({ "data-i18n-data-empty-label": "empty" });
  const bySelector = new Map([
    ["[data-i18n]", [textElement]],
    ["[data-i18n-title]", [titleElement]],
    ["[data-i18n-placeholder]", [placeholderElement]],
    ["[data-i18n-aria-label]", [ariaElement]],
    ["[data-i18n-data-empty-label]", [emptyLabelElement]],
  ]);
  const root = {
    documentElement: { lang: "", dataset: {} },
    querySelectorAll: (selector) => bySelector.get(selector) ?? [],
  };
  const translate = createTranslator({
    en: {
      title: "Title",
      tooltip: "Tooltip",
      placeholder: "Search",
      aria: "Search documents",
      empty: "No open documents",
    },
    "zh-CN": {},
  }, "en");

  localizeDocument(root, translate);

  assert.equal(root.documentElement.lang, "en");
  assert.equal(root.documentElement.dataset.locale, "en");
  assert.equal(textElement.textContent, "Title");
  assert.equal(titleElement.getAttribute("title"), "Tooltip");
  assert.equal(placeholderElement.getAttribute("placeholder"), "Search");
  assert.equal(ariaElement.getAttribute("aria-label"), "Search documents");
  assert.equal(emptyLabelElement.getAttribute("data-empty-label"), "No open documents");
});

function fakeElement(initialAttributes = {}) {
  const attributes = new Map(Object.entries(initialAttributes));
  return {
    textContent: "",
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
  };
}

test("translator falls back to English and formats named values", () => {
  const messages = {
    en: { greeting: "Hello, {name}", onlyEnglish: "English fallback" },
    "zh-CN": { greeting: "你好，{name}" },
  };
  const chinese = createTranslator(messages, "zh-CN");

  assert.equal(chinese("greeting", { name: "Git Leaf" }), "你好，Git Leaf");
  assert.equal(chinese("onlyEnglish"), "English fallback");
  assert.equal(chinese("missing.key"), "missing.key");
  assert.equal(formatMessage("{count} files", { count: 3 }), "3 files");
});

test("workbench English and Simplified Chinese resources cover the same message keys", () => {
  assert.deepEqual(
    Object.keys(WORKBENCH_MESSAGES.en).sort(),
    Object.keys(WORKBENCH_MESSAGES["zh-CN"]).sort(),
  );
});

test("workbench locale resources localize linked worktrees and link dialog fields", () => {
  const english = createTranslator(WORKBENCH_MESSAGES, "en");
  const chinese = createTranslator(WORKBENCH_MESSAGES, "zh-CN");

  assert.equal(english("worktree.linkedName", { name: "review" }), "Worktree - review");
  assert.equal(chinese("worktree.linkedName", { name: "review" }), "工作树 - review");
  assert.equal(english("link.fieldTitle"), "Title");
  assert.equal(english("link.fieldLink"), "Link");
  assert.equal(chinese("link.fieldTitle"), "标题");
  assert.equal(chinese("link.fieldLink"), "链接");
});

test("workbench first paint honors the desktop-resolved language before browser languages", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const inlineScript = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]
    .replace("__GIT_LEAF_INITIAL_FILE__", "\"\"")
    .replace("__GIT_LEAF_INITIAL_REPO__", "\"repo\"")
    .replace("__GIT_LEAF_WORKTREE_ID__", "\"repo\"")
    .replace("__GIT_LEAF_CAN_EDIT__", "true")
    .replace("__GIT_LEAF_DESKTOP_PREFERENCES__", "window.__TEST_PREFERENCES__")
    .replace("__GIT_LEAF_TELEMETRY_ENABLED__", "false");
  assert.ok(inlineScript);

  assert.equal(runWorkbenchBootstrap(inlineScript, {
    preferences: {
      language: "system",
      resolvedLanguage: "zh-CN",
    },
    systemLanguages: ["en-US"],
  }), "zh-CN");
  assert.equal(runWorkbenchBootstrap(inlineScript, {
    preferences: {
      language: "system",
      resolvedLanguage: "en",
    },
    systemLanguages: ["zh-CN"],
  }), "en");
  assert.equal(runWorkbenchBootstrap(inlineScript, {
    preferences: null,
    systemLanguages: ["fr-FR", "zh-Hans"],
  }), "zh-CN");
  assert.equal(runWorkbenchBootstrap(inlineScript, {
    preferences: { language: "unsupported" },
    systemLanguages: ["zh-CN"],
  }), "en");
});

function runWorkbenchBootstrap(source, { preferences, systemLanguages }) {
  const documentElement = {
    lang: "",
    dataset: {},
    style: {
      colorScheme: "",
    },
  };
  const window = {
    __TEST_PREFERENCES__: preferences,
    GIT_LEAF_DESKTOP_PREFERENCES: preferences,
    navigator: {
      languages: systemLanguages,
      language: systemLanguages[0],
    },
    localStorage: {
      getItem: () => null,
    },
    matchMedia: () => ({ matches: false }),
  };
  vm.runInNewContext(source, {
    document: { documentElement },
    window,
  });
  return window.GIT_LEAF_INITIAL_LOCALE;
}
