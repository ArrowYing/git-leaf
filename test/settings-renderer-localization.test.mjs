import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const ROOT = path.join(import.meta.dirname, "..");
const SETTINGS_HTML_PATH = path.join(ROOT, "src", "desktop", "settings", "index.html");
const SETTINGS_RENDERER_PATH = path.join(ROOT, "src", "desktop", "settings", "renderer.js");
const SETTINGS_STYLES_PATH = path.join(ROOT, "src", "desktop", "settings", "styles.css");

test("settings page exposes the bounded language choices and stays hidden until localized", async () => {
  const [html, styles] = await Promise.all([
    readFile(SETTINGS_HTML_PATH, "utf8"),
    readFile(SETTINGS_STYLES_PATH, "utf8"),
  ]);

  const languageValues = [...html.matchAll(/name="language"\s+value="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(languageValues, ["system", "en", "zh-CN"]);
  assert.match(html, /<html lang="en" data-settings-ready="false">/);
  assert.equal(
    [...html.matchAll(/class="section-kicker"\s+data-i18n="([^"]+)"/g)].length,
    5,
  );
  assert.match(
    html,
    /class="language-sample" aria-hidden="true" data-i18n="languageAuto">Auto<\/span>/,
  );
  assert.match(styles, /:root\[data-settings-ready="false"\] body\s*\{\s*visibility: hidden;/);
});

test("settings renderer applies resolved language and rehydrates a full model after saving", async () => {
  const source = await readFile(SETTINGS_RENDERER_PATH, "utf8");
  const initialModel = settingsModel({
    language: "system",
    resolvedLanguage: "zh-CN",
    helpTitle: "仓库文件",
  });
  const englishModel = settingsModel({
    language: "en",
    resolvedLanguage: "en",
    helpTitle: "Repository files",
  });
  const harness = createRendererHarness({
    initialModel,
    saveResponse: {
      ok: true,
      preferences: englishModel.preferences,
      model: englishModel,
    },
  });

  vm.runInNewContext(source, harness.context, {
    filename: SETTINGS_RENDERER_PATH,
  });
  await settle();

  assert.equal(harness.document.documentElement.lang, "zh-CN");
  assert.equal(harness.document.documentElement.dataset.settingsReady, "true");
  assert.equal(harness.localizedHeading.textContent, "外观");
  assert.equal(harness.radio("language", "system").checked, true);

  const englishInput = harness.radio("language", "en");
  harness.radio("language", "system").checked = false;
  englishInput.checked = true;
  harness.document.dispatch("change", { target: englishInput });
  await settle();

  assert.equal(harness.savedPatches.length, 1);
  assert.equal(harness.savedPatches[0].language, "en");
  assert.equal(harness.document.documentElement.lang, "en");
  assert.equal(harness.localizedHeading.textContent, "Appearance");
  assert.equal(harness.radio("language", "en").checked, true);
  assert.equal(harness.appStatus.children[0].textContent, "Application");
});

test("settings renderer serializes saves so a language model is not lost behind a later preference", async () => {
  const source = await readFile(SETTINGS_RENDERER_PATH, "utf8");
  const initialModel = settingsModel({
    language: "system",
    resolvedLanguage: "zh-CN",
    helpTitle: "仓库文件",
  });
  const englishModel = settingsModel({
    language: "en",
    resolvedLanguage: "en",
    helpTitle: "Repository files",
  });
  let releaseLanguageSave;
  const languageSave = new Promise((resolve) => {
    releaseLanguageSave = resolve;
  });
  const harness = createRendererHarness({
    initialModel,
    async updatePreferences(patch) {
      if (patch.language === "en") {
        return languageSave;
      }
      return {
        ok: true,
        preferences: {
          ...englishModel.preferences,
          ...patch,
        },
      };
    },
  });

  vm.runInNewContext(source, harness.context, {
    filename: SETTINGS_RENDERER_PATH,
  });
  await settle();

  const englishInput = harness.radio("language", "en");
  englishInput.checked = true;
  harness.document.dispatch("change", { target: englishInput });
  const darkInput = harness.radio("colorMode", "dark");
  darkInput.checked = true;
  harness.document.dispatch("change", { target: darkInput });
  await settle();

  assert.equal(harness.savedPatches.length, 1);
  assert.equal(harness.savedPatches[0].language, "en");
  releaseLanguageSave({
    ok: true,
    preferences: englishModel.preferences,
    model: englishModel,
  });
  await settle();
  await settle();

  assert.equal(harness.savedPatches.length, 2);
  assert.equal(harness.savedPatches[0].language, "en");
  assert.equal(harness.savedPatches[1].colorMode, "dark");
  assert.equal(harness.document.documentElement.lang, "en");
  assert.equal(harness.localizedHeading.textContent, "Appearance");
  assert.equal(harness.radio("colorMode", "dark").checked, true);
});

test("settings renderer clears an update result when the interface language changes", async () => {
  const source = await readFile(SETTINGS_RENDERER_PATH, "utf8");
  const initialModel = settingsModel({
    language: "system",
    resolvedLanguage: "zh-CN",
    helpTitle: "仓库文件",
  });
  const englishModel = settingsModel({
    language: "en",
    resolvedLanguage: "en",
    helpTitle: "Repository files",
  });
  const harness = createRendererHarness({
    initialModel,
    saveResponse: {
      ok: true,
      preferences: englishModel.preferences,
      model: englishModel,
    },
    checkForUpdates: async () => ({
      result: {
        state: "current",
        message: "Git Leaf 已经是最新版本。",
      },
    }),
  });

  vm.runInNewContext(source, harness.context, {
    filename: SETTINGS_RENDERER_PATH,
  });
  await settle();
  harness.checkForUpdatesButton.dispatch("click", {});
  await settle();
  assert.equal(harness.updateCheckResult.textContent, "Git Leaf 已经是最新版本。");

  const englishInput = harness.radio("language", "en");
  englishInput.checked = true;
  harness.document.dispatch("change", { target: englishInput });
  await settle();

  assert.equal(harness.document.documentElement.lang, "en");
  assert.equal(harness.updateCheckResult.textContent, "");
});

test("settings renderer keeps localized Chinese error summaries ahead of technical errors", async () => {
  const source = await readFile(SETTINGS_RENDERER_PATH, "utf8");
  const initialModel = settingsModel({
    language: "zh-CN",
    resolvedLanguage: "zh-CN",
    helpTitle: "仓库文件",
  });
  const harness = createRendererHarness({
    initialModel,
    checkForUpdates: async () => {
      throw new Error("Error invoking remote method 'git-leaf-settings:action'");
    },
  });

  vm.runInNewContext(source, harness.context, {
    filename: SETTINGS_RENDERER_PATH,
  });
  await settle();
  harness.checkForUpdatesButton.dispatch("click", {});
  await settle();

  assert.equal(harness.errorBox.textContent, "检查更新失败。");
  assert.doesNotMatch(harness.errorBox.textContent, /Error invoking remote method/);
});

function settingsModel({ language, resolvedLanguage, helpTitle }) {
  return {
    preferences: {
      language,
      colorMode: "system",
      documentFont: "system-sans",
      documentFontSize: 16,
      fileTreeMode: "content",
    },
    resolvedLanguage,
    helpSections: [{ id: "repository-files", title: helpTitle, body: [] }],
    shortcutGroups: [],
    status: {},
  };
}

function createRendererHarness({
  initialModel,
  saveResponse,
  updatePreferences,
  checkForUpdates,
}) {
  const listeners = new Map();
  const savedPatches = [];
  const elements = new Map();
  const radios = new Map();
  const documentElement = new FakeElement();
  documentElement.dataset.settingsReady = "false";
  documentElement.style = { setProperty() {} };

  for (const selector of [
    "#settings-navigation",
    "#help-navigation",
    "#settings-content",
    "#settings-back",
    "#document-font-size-value",
    "#help-sections",
    "#shortcut-groups",
    "#app-status",
    "#environment-status",
    "#repository-status",
    ".status-actions",
    "#check-for-updates",
    "#update-check-result",
    "#settings-error",
    "#settings-save-status",
  ]) {
    elements.set(selector, new FakeElement());
  }
  const fontSizeInput = new FakeInputElement({
    id: "document-font-size",
    type: "range",
    value: "16",
  });
  elements.set("#document-font-size", fontSizeInput);

  for (const [name, values] of Object.entries({
    language: ["system", "en", "zh-CN"],
    colorMode: ["system", "light", "dark"],
    documentFont: ["system-sans", "reading-serif"],
    fileTreeMode: ["content", "all"],
  })) {
    for (const value of values) {
      radios.set(`${name}:${value}`, new FakeInputElement({
        name,
        type: "radio",
        value,
      }));
    }
  }

  const localizedHeading = new FakeElement({
    dataset: { i18n: "appearanceTitle" },
  });
  const localizedAria = new FakeElement({
    dataset: { i18nAriaLabel: "sidebarAria" },
  });

  const document = {
    documentElement,
    title: "",
    querySelector(selector) {
      const radioMatch = selector.match(
        /^input\[name="([^"]+)"\]\[value="([^"]+)"\]$/,
      );
      if (radioMatch) {
        return radios.get(`${radioMatch[1]}:${radioMatch[2]}`) ?? null;
      }
      return elements.get(selector) ?? null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-i18n]") {
        return [localizedHeading];
      }
      if (selector === "[data-i18n-aria-label]") {
        return [localizedAria];
      }
      if (selector === "[data-section-panel]") {
        return [];
      }
      return [];
    },
    createElement() {
      return new FakeElement();
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type, event) {
      listeners.get(type)?.(event);
    },
  };

  const api = {
    async getModel() {
      return initialModel;
    },
    async updatePreferences(patch) {
      savedPatches.push(patch);
      return typeof updatePreferences === "function"
        ? updatePreferences(patch)
        : saveResponse;
    },
    async close() {},
    async checkForUpdates() {
      return typeof checkForUpdates === "function"
        ? checkForUpdates()
        : {};
    },
    async openExternal() {},
    onShow(listener) {
      Promise.resolve().then(() => listener({ model: initialModel }));
      return () => {};
    },
  };
  const window = {
    gitLeafSettings: api,
    matchMedia() {
      return {
        matches: false,
        addEventListener() {},
      };
    },
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    setTimeout() {
      return 1;
    },
  };

  return {
    context: {
      console,
      document,
      window,
      navigator: { language: "en-US" },
      HTMLInputElement: FakeInputElement,
      URL,
    },
    document,
    localizedHeading,
    appStatus: elements.get("#app-status"),
    checkForUpdatesButton: elements.get("#check-for-updates"),
    updateCheckResult: elements.get("#update-check-result"),
    errorBox: elements.get("#settings-error"),
    savedPatches,
    radio(name, value) {
      return radios.get(`${name}:${value}`);
    },
  };
}

class FakeElement {
  constructor({
    id = "",
    dataset = {},
    name = "",
    type = "",
    value = "",
  } = {}) {
    this.id = id;
    this.dataset = { ...dataset };
    this.name = name;
    this.type = type;
    this.value = value;
    this.checked = false;
    this.hidden = false;
    this.textContent = "";
    this.children = [];
    this.attributes = new Map();
    this.scrollHeight = 0;
    this.scrollTop = 0;
    this.clientHeight = 0;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type, event) {
    this.listeners.get(type)?.(event);
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  querySelectorAll() {
    return [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  focus() {}

  scrollIntoView() {}

  getBoundingClientRect() {
    return { top: 0 };
  }
}

class FakeInputElement extends FakeElement {}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
