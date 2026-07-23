import test from "node:test";
import assert from "node:assert/strict";

import { createDesktopUpdateController as createDesktopUpdateControllerImpl } from "../desktop/updates.mjs";

function createDesktopUpdateController(options = {}) {
  return createDesktopUpdateControllerImpl({
    ...options,
    buildInfo: {
      distribution: "official",
      ...options.buildInfo,
    },
  });
}

function fakeDialog(result = { response: 0, checkboxChecked: false }) {
  const calls = [];
  return {
    calls,
    showMessageBox: (...args) => {
      calls.push(args);
      return result;
    },
  };
}

function fakeMacManifestFetch({ version = "1.2.1" } = {}) {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    return {
      ok: true,
      json: async () => ({
        version,
        autoUpdater: {
          name: `Git Leaf ${version}`,
        },
        files: {
          zip: {
            url: `https://updates.mangofuture.com/git-leaf/stable/darwin-universal/GitLeaf-${version}.zip`,
          },
        },
      }),
    };
  };
  fetch.urls = urls;
  return fetch;
}

async function flushUpdatePrompt() {
  await Promise.resolve();
  await Promise.resolve();
}

function fakeAutoUpdater() {
  const listeners = new Map();
  const autoUpdater = {
    listeners,
    feedUrls: [],
    checked: false,
    installed: false,
    setFeedURL: ({ url }) => {
      autoUpdater.feedUrls.push(url);
    },
    checkForUpdates: () => {
      autoUpdater.checked = true;
    },
    quitAndInstall: () => {
      autoUpdater.installed = true;
    },
    on: (eventName, listener) => {
      listeners.set(eventName, listener);
    },
  };
  return autoUpdater;
}

test("desktop updater configures Squirrel.Mac only after the user starts an update", async () => {
  const feedUrls = [];
  let checked = false;
  const fetch = fakeMacManifestFetch();
  const controller = createDesktopUpdateController({
    autoUpdater: {
      setFeedURL: ({ url }) => feedUrls.push(url),
      checkForUpdates: () => {
        checked = true;
      },
      on: () => {},
    },
    buildInfo: { version: "0.1.1" },
    fetch,
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    channel: "stable",
  });

  assert.equal(await controller.checkForUpdates({ manual: true }), "available");

  assert.deepEqual(feedUrls, []);
  assert.equal(checked, false);
  assert.equal(await controller.handleUpdateAction(), "downloading");

  assert.deepEqual(feedUrls, [
    "https://updates.mangofuture.com/git-leaf/stable/darwin-universal/releases/0.1.1",
  ]);
  assert.equal(checked, true);
  assert.deepEqual(fetch.urls, [
    "https://updates.mangofuture.com/git-leaf/stable/darwin-universal/latest.json",
  ]);
});

test("desktop updater disables stable updates for packaged development builds", async () => {
  const autoUpdater = fakeAutoUpdater();
  const dialog = fakeDialog();
  const fetch = fakeMacManifestFetch();
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.7.1", dev: true },
    dialog,
    fetch,
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
  });

  assert.equal(await controller.checkForUpdates({ manual: true }), "disabled");
  assert.equal(autoUpdater.checked, false);
  assert.deepEqual(autoUpdater.feedUrls, []);
  assert.deepEqual(fetch.urls, []);
  assert.match(dialog.calls[0][0].message, /Git Leaf dev/);
  assert.match(dialog.calls[0][0].message, /不会检查正式版本更新/);
});

test("desktop updater never contacts the official feed for source builds", async () => {
  const autoUpdater = fakeAutoUpdater();
  const dialog = fakeDialog();
  const fetch = fakeMacManifestFetch();
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.8.1", distribution: "source" },
    dialog,
    fetch,
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
  });

  assert.equal(await controller.checkForUpdates({ manual: true }), "disabled");
  assert.equal(autoUpdater.checked, false);
  assert.deepEqual(fetch.urls, []);
  assert.match(dialog.calls[0][0].message, /源码构建/);
});

test("desktop update actions cannot bypass development-build update guards", async () => {
  const autoUpdater = fakeAutoUpdater();
  const dialog = fakeDialog();
  const fetch = fakeMacManifestFetch({ version: "1.9.0" });
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.8.1", dev: true },
    dialog,
    fetch,
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
  });

  assert.equal(await controller.handleUpdateAction(), "disabled");
  assert.deepEqual(fetch.urls, []);
  assert.equal(autoUpdater.checked, false);
  assert.match(dialog.calls[0][0].message, /Git Leaf dev/);
});

test("development builds do not restore stable update actions from shared preferences", async () => {
  const statuses = [];
  const controller = createDesktopUpdateController({
    autoUpdater: fakeAutoUpdater(),
    buildInfo: { version: "1.8.1", dev: true },
    dialog: fakeDialog(),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    getUpdatePreferences: () => ({ updateAvailableVersion: "1.9.0" }),
    showUpdateStatus: async (status) => statuses.push(status),
  });

  assert.equal(await controller.restoreKnownUpdate(), false);
  assert.deepEqual(statuses, []);
});

test("desktop updater does not show transient macOS errors before a downloaded update settles", async () => {
  const autoUpdater = fakeAutoUpdater();
  const dialog = fakeDialog();
  let delayedError;
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.2.0" },
    dialog,
    fetch: fakeMacManifestFetch(),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    scheduleTimeout: (callback) => {
      delayedError = callback;
      return 1;
    },
    clearTimeout: () => {},
  });

  await controller.checkForUpdates({ manual: true });
  await controller.handleUpdateAction();
  autoUpdater.listeners.get("error")(
    new Error("文件夹“GitLeaf-1.2.1-darwin-arm64.zip”不存在。：该文件夹不存在。"),
  );

  assert.equal(dialog.calls.length, 0);
  assert.equal(typeof delayedError, "function");

  autoUpdater.listeners.get("update-downloaded")();

  assert.equal(dialog.calls.length, 0);
  assert.equal(await controller.installPendingUpdateOnQuit(), true);
});

test("desktop updater reports macOS manual update progress", async () => {
  const autoUpdater = fakeAutoUpdater();
  const statuses = [];
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.2.0" },
    dialog: fakeDialog(),
    fetch: fakeMacManifestFetch(),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    showUpdateStatus: async (status) => statuses.push(status),
  });

  await controller.checkForUpdates({ manual: true });
  await controller.handleUpdateAction();
  autoUpdater.listeners.get("update-available")();
  autoUpdater.listeners.get("update-downloaded")();

  assert.deepEqual(statuses.map((status) => status.state), [
    "checking",
    "available",
    "downloading",
    "downloading",
    "downloaded",
  ]);
  assert.match(statuses[0].message, /正在检查更新/);
  assert.match(statuses[2].message, /下载并准备/);
});

test("desktop updater reports low-cardinality lifecycle telemetry", async () => {
  const autoUpdater = fakeAutoUpdater();
  const updates = [];
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.2.0" },
    dialog: fakeDialog({ response: 0 }),
    fetch: fakeMacManifestFetch({ version: "1.2.1" }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    recordUpdateState: (update) => updates.push(update),
  });

  await controller.checkForUpdates({ manual: true });
  await controller.handleUpdateAction();
  autoUpdater.listeners.get("update-downloaded")();
  await controller.installPendingUpdateOnQuit();

  assert.deepEqual(updates, [
    { state: "check_started", trigger: "manual", from_version: "1.2.0" },
    { state: "available", trigger: "manual", from_version: "1.2.0", to_version: "1.2.1" },
    { state: "downloaded", trigger: "manual", from_version: "1.2.0", to_version: "1.2.1" },
    { state: "install_started", trigger: "manual", from_version: "1.2.0", to_version: "1.2.1" },
  ]);
});

test("desktop updater eventually reports terminal macOS update errors", async () => {
  const autoUpdater = fakeAutoUpdater();
  const dialog = fakeDialog();
  const updates = [];
  let delayedError;
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.2.0" },
    dialog,
    fetch: fakeMacManifestFetch(),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    scheduleTimeout: (callback) => {
      delayedError = callback;
      return 1;
    },
    clearTimeout: () => {},
    recordUpdateState: (update) => updates.push(update),
  });

  await controller.checkForUpdates({ manual: true });
  await controller.handleUpdateAction();
  autoUpdater.listeners.get("error")(new Error("network failed"));

  assert.equal(dialog.calls.length, 0);
  await delayedError();

  assert.equal(dialog.calls.length, 1);
  assert.match(dialog.calls[0][0].message, /下载更新失败：network failed/);
  assert.equal(updates.at(-1).stage, "download");
});

test("a previously requested macOS download retries quietly after restart", async () => {
  const autoUpdater = fakeAutoUpdater();
  const dialog = fakeDialog();
  const statuses = [];
  let delayedError;
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.2.0" },
    dialog,
    fetch: fakeMacManifestFetch(),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    getUpdatePreferences: () => ({ updateRequestedVersion: "1.2.1" }),
    showUpdateStatus: async (status) => statuses.push(status),
    scheduleTimeout: (callback) => {
      delayedError = callback;
      return 1;
    },
    clearTimeout: () => {},
  });

  await controller.checkForUpdates({ manual: false });
  autoUpdater.listeners.get("update-available")();
  autoUpdater.listeners.get("error")(new Error("network failed"));
  await delayedError();

  assert.deepEqual(statuses.map((status) => status.state), ["available", "downloading", "downloading", "error"]);
  assert.equal(statuses.at(-1).manual, false);
  assert.equal(dialog.calls.length, 0);
  assert.equal(await controller.checkForUpdates({ manual: false }), "downloading");
});

test("legacy skipped versions no longer hide the persistent update action", async () => {
  const autoUpdater = fakeAutoUpdater();
  const dialog = fakeDialog();
  const statuses = [];
  const savedPreferences = [];
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.2.0" },
    dialog,
    fetch: fakeMacManifestFetch({ version: "1.2.1" }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    getUpdatePreferences: () => ({ skippedUpdateVersion: "1.2.1" }),
    saveUpdatePreferences: async (preferences) => savedPreferences.push(preferences),
    showUpdateStatus: async (status) => statuses.push(status),
  });

  const result = await controller.checkForUpdates({ manual: true });

  assert.equal(result, "available");
  assert.equal(autoUpdater.checked, false);
  assert.deepEqual(statuses.map((status) => status.state), ["checking", "available"]);
  assert.deepEqual(savedPreferences, [
    { updateAvailableVersion: "1.2.1" },
    { promptedUpdateVersion: "", skippedUpdateVersion: "" },
  ]);
  assert.equal(dialog.calls.length, 0);
});

test("desktop updater does not show a native choice prompt after download", async () => {
  const autoUpdater = fakeAutoUpdater();
  const dialog = fakeDialog({ response: 2 });
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.2.0" },
    dialog,
    fetch: fakeMacManifestFetch({ version: "1.2.1" }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
  });

  await controller.checkForUpdates({ manual: true });
  await controller.handleUpdateAction();
  autoUpdater.listeners.get("update-downloaded")();

  assert.equal(dialog.calls.length, 0);
  assert.equal(autoUpdater.installed, false);
});

test("desktop updater installs a downloaded macOS update on normal quit", async () => {
  const autoUpdater = fakeAutoUpdater();
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.2.0" },
    dialog: fakeDialog({ response: 1 }),
    fetch: fakeMacManifestFetch({ version: "1.2.1" }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
  });

  await controller.checkForUpdates({ manual: true });
  await controller.handleUpdateAction();
  autoUpdater.listeners.get("update-downloaded")();

  assert.equal(autoUpdater.installed, false);
  assert.equal(await controller.installPendingUpdateOnQuit(), true);
  assert.equal(autoUpdater.installed, true);
});

test("clicking a prepared macOS update requests a controlled app shutdown", async () => {
  const autoUpdater = fakeAutoUpdater();
  let quitRequests = 0;
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.2.0" },
    dialog: fakeDialog({ response: 0 }),
    fetch: fakeMacManifestFetch({ version: "1.2.1" }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    requestQuitForUpdate: async () => {
      quitRequests += 1;
    },
  });

  await controller.checkForUpdates({ manual: true });
  await controller.handleUpdateAction();
  autoUpdater.listeners.get("update-downloaded")();

  assert.equal(await controller.handleUpdateAction(), "install-now");
  assert.equal(quitRequests, 1);
  assert.equal(autoUpdater.installed, false);
  assert.equal(await controller.installPendingUpdateOnQuit(), true);
  assert.equal(autoUpdater.installed, true);
});

test("legacy prompted versions do not suppress the persistent update action", async () => {
  const autoUpdater = fakeAutoUpdater();
  const dialog = fakeDialog();
  const savedPreferences = [];
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.2.0" },
    dialog,
    fetch: fakeMacManifestFetch({ version: "1.2.1" }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    getUpdatePreferences: () => ({ promptedUpdateVersion: "1.2.1" }),
    saveUpdatePreferences: async (preferences) => savedPreferences.push(preferences),
  });

  assert.equal(await controller.checkForUpdates({ manual: false }), "available");

  assert.equal(dialog.calls.length, 0);
  assert.deepEqual(savedPreferences, [
    { updateAvailableVersion: "1.2.1" },
    { promptedUpdateVersion: "", skippedUpdateVersion: "" },
  ]);
  assert.equal(autoUpdater.checked, false);
  assert.equal(autoUpdater.installed, false);
});

test("desktop updater prepares Windows after a click and launches it on quit", async () => {
  const preparedManifests = [];
  const launched = [];
  const dialog = fakeDialog({ response: 0 });
  const statuses = [];
  const controller = createDesktopUpdateController({
    buildInfo: { version: "0.1.1" },
    dialog,
    fetch: async () => ({
      ok: true,
      json: async () => ({
        version: "0.1.2",
        files: {
          zip: {
            url: "https://updates.mangofuture.com/git-leaf/stable/win32-x64/Git%20Leaf.zip",
            sha256: "a".repeat(64),
            size: 123,
          },
        },
      }),
    }),
    isPackaged: true,
    platform: "win32",
    arch: "x64",
    prepareWindowsUpdate: async (manifest) => {
      preparedManifests.push(manifest);
      return { version: manifest.version, executable: "C:\\updates\\Git Leaf.exe" };
    },
    launchWindowsUpdate: (prepared) => launched.push(prepared),
    showUpdateStatus: async (status) => statuses.push(status),
  });

  await controller.checkForUpdates({ manual: true });
  await controller.handleUpdateAction();

  assert.deepEqual(statuses.map((status) => status.state), ["checking", "available", "downloading", "downloaded"]);
  assert.equal(dialog.calls.length, 0);
  assert.equal(preparedManifests.length, 1);
  assert.equal(await controller.installPendingUpdateOnQuit(), false);
  assert.equal(launched.length, 1);
  assert.equal(launched[0].version, "0.1.2");
});

test("desktop updater reports current Windows builds as up to date on manual checks", async () => {
  const dialog = fakeDialog();
  const statuses = [];
  const controller = createDesktopUpdateController({
    buildInfo: { version: "0.1.2" },
    dialog,
    fetch: async () => ({
      ok: true,
      json: async () => ({
        version: "0.1.2",
        files: {
          zip: {
            url: "https://updates.mangofuture.com/git-leaf/stable/win32-x64/Git%20Leaf.zip",
          },
        },
      }),
    }),
    isPackaged: true,
    platform: "win32",
    arch: "x64",
    showUpdateStatus: async (status) => statuses.push(status),
  });

  await controller.checkForUpdates({ manual: true });

  assert.deepEqual(statuses.map((status) => status.state), ["checking", "current"]);
  assert.match(dialog.calls[0][0].message, /已经是最新版本/);
});

test("automatic macOS checks only expose an available update without downloading it", async () => {
  const autoUpdater = fakeAutoUpdater();
  const statuses = [];
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.8.1" },
    dialog: fakeDialog(),
    fetch: fakeMacManifestFetch({ version: "1.9.0" }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    showUpdateStatus: async (status) => statuses.push(status),
  });

  assert.equal(await controller.checkForUpdates({ manual: false }), "available");
  assert.equal(autoUpdater.checked, false);
  assert.deepEqual(statuses.map((status) => status.state), ["available"]);
  assert.equal(statuses[0].version, "1.9.0");
});

test("a known available update is restored before the network check", async () => {
  const autoUpdater = fakeAutoUpdater();
  const fetch = fakeMacManifestFetch({ version: "1.9.0" });
  const statuses = [];
  const savedPreferences = [];
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.8.1" },
    dialog: fakeDialog(),
    fetch,
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    getUpdatePreferences: () => ({ updateAvailableVersion: "1.9.0" }),
    saveUpdatePreferences: async (preferences) => savedPreferences.push(preferences),
    showUpdateStatus: async (status) => statuses.push(status),
  });

  assert.equal(await controller.restoreKnownUpdate(), true);
  assert.deepEqual(fetch.urls, []);
  assert.equal(statuses.at(-1).state, "available");
  assert.equal(statuses.at(-1).version, "1.9.0");

  assert.equal(await controller.handleUpdateAction(), "downloading");
  assert.equal(fetch.urls.length, 1);
  assert.equal(autoUpdater.checked, true);
  assert.deepEqual(savedPreferences, [{ updateRequestedVersion: "1.9.0" }]);
});

test("a restored update action survives a temporary network failure", async () => {
  const statuses = [];
  const controller = createDesktopUpdateController({
    autoUpdater: fakeAutoUpdater(),
    buildInfo: { version: "1.8.1" },
    dialog: fakeDialog(),
    fetch: async () => {
      throw new Error("offline");
    },
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    getUpdatePreferences: () => ({ updateAvailableVersion: "1.9.0" }),
    showUpdateStatus: async (status) => statuses.push(status),
  });

  assert.equal(await controller.restoreKnownUpdate(), true);
  assert.equal(await controller.handleUpdateAction(), "error");
  assert.equal(statuses.at(-1).state, "error");
  assert.equal(statuses.at(-1).version, "1.9.0");
  assert.equal(await controller.handleUpdateAction(), "error");
  assert.equal(statuses.at(-1).version, "1.9.0");
});

test("a current build clears durable update discovery and request state", async () => {
  const savedPreferences = [];
  const preferences = {
    updateAvailableVersion: "1.9.0",
    updateRequestedVersion: "1.9.0",
    promptedUpdateVersion: "1.9.0",
    skippedUpdateVersion: "1.9.0",
  };
  const controller = createDesktopUpdateController({
    buildInfo: { version: "1.9.0" },
    dialog: fakeDialog(),
    fetch: fakeMacManifestFetch({ version: "1.9.0" }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    getUpdatePreferences: () => preferences,
    saveUpdatePreferences: async (updates) => {
      savedPreferences.push(updates);
      Object.assign(preferences, updates);
    },
  });

  assert.equal(await controller.checkForUpdates({ manual: false }), "current");
  assert.deepEqual(savedPreferences, [{
    updateAvailableVersion: "",
    updateRequestedVersion: "",
    promptedUpdateVersion: "",
    skippedUpdateVersion: "",
  }]);
  assert.equal(await controller.restoreKnownUpdate(), false);
});

test("clicking an available macOS update starts one persisted download", async () => {
  const autoUpdater = fakeAutoUpdater();
  const savedPreferences = [];
  const statuses = [];
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.8.1" },
    dialog: fakeDialog(),
    fetch: fakeMacManifestFetch({ version: "1.9.0" }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    saveUpdatePreferences: async (preferences) => savedPreferences.push(preferences),
    showUpdateStatus: async (status) => statuses.push(status),
  });

  await controller.checkForUpdates({ manual: false });
  assert.equal(await controller.handleUpdateAction(), "downloading");
  assert.equal(autoUpdater.checked, true);
  assert.deepEqual(savedPreferences, [
    { updateAvailableVersion: "1.9.0" },
    { updateRequestedVersion: "1.9.0" },
  ]);
  assert.deepEqual(statuses.map((status) => status.state), ["available", "downloading"]);
});

test("a requested macOS update resumes after restart and installs on normal quit", async () => {
  const autoUpdater = fakeAutoUpdater();
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.8.1" },
    dialog: fakeDialog(),
    fetch: fakeMacManifestFetch({ version: "1.9.0" }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    getUpdatePreferences: () => ({ updateRequestedVersion: "1.9.0" }),
  });

  assert.equal(await controller.checkForUpdates({ manual: false }), "downloading");
  assert.equal(autoUpdater.checked, true);
  autoUpdater.listeners.get("update-downloaded")();

  assert.equal(await controller.installPendingUpdateOnQuit(), true);
  assert.equal(autoUpdater.installed, true);
});

test("automatic Windows checks wait for a click before preparing and install on quit", async () => {
  const prepared = [];
  const launched = [];
  const controller = createDesktopUpdateController({
    buildInfo: { version: "1.8.1" },
    dialog: fakeDialog(),
    fetch: async () => ({
      ok: true,
      json: async () => ({
        version: "1.9.0",
        files: {
          zip: {
            url: "https://updates.example/GitLeaf-1.9.0-win32-x64.zip",
            sha256: "a".repeat(64),
            size: 123,
          },
        },
      }),
    }),
    isPackaged: true,
    platform: "win32",
    arch: "x64",
    prepareWindowsUpdate: async (manifest) => {
      prepared.push(manifest.version);
      return { version: manifest.version, executable: "C:\\updates\\Git Leaf.exe" };
    },
    launchWindowsUpdate: (pending) => launched.push(pending),
  });

  assert.equal(await controller.checkForUpdates({ manual: false }), "available");
  assert.deepEqual(prepared, []);
  assert.equal(await controller.handleUpdateAction(), "downloaded");
  assert.deepEqual(prepared, ["1.9.0"]);
  assert.equal(await controller.installPendingUpdateOnQuit(), false);
  assert.equal(launched.length, 1);
  assert.equal(launched[0].version, "1.9.0");
});

test("late macOS available events cannot move a downloaded update backwards", async () => {
  const autoUpdater = fakeAutoUpdater();
  const statuses = [];
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.8.1" },
    dialog: fakeDialog(),
    fetch: fakeMacManifestFetch({ version: "1.9.0" }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    showUpdateStatus: async (status) => statuses.push(status),
  });

  await controller.checkForUpdates({ manual: false });
  await controller.handleUpdateAction();
  autoUpdater.listeners.get("update-downloaded")();
  autoUpdater.listeners.get("update-available")();

  assert.equal(statuses.at(-1).state, "downloaded");
  assert.equal(await controller.installPendingUpdateOnQuit(), true);
});

test("a failed update-intent write blocks the download with a retryable state", async () => {
  const autoUpdater = fakeAutoUpdater();
  const statuses = [];
  const dialog = fakeDialog();
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.8.1" },
    dialog,
    fetch: fakeMacManifestFetch({ version: "1.9.0" }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    saveUpdatePreferences: async () => {
      throw new Error("disk full");
    },
    showUpdateStatus: async (status) => statuses.push(status),
  });

  await controller.checkForUpdates({ manual: false });
  assert.equal(await controller.handleUpdateAction(), "error");
  assert.equal(autoUpdater.checked, false);
  assert.equal(statuses.at(-1).state, "error");
  assert.equal(statuses.at(-1).version, "1.9.0");
  assert.match(dialog.calls[0][0].message, /无法保存更新选择/);
});

test("a synchronous macOS updater launch failure keeps a retryable update action", async () => {
  const autoUpdater = fakeAutoUpdater();
  autoUpdater.checkForUpdates = () => {
    throw new Error("updater unavailable");
  };
  const statuses = [];
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.8.1" },
    dialog: fakeDialog(),
    fetch: fakeMacManifestFetch({ version: "1.9.0" }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    showUpdateStatus: async (status) => statuses.push(status),
  });

  assert.equal(await controller.checkForUpdates({ manual: false }), "available");
  assert.equal(await controller.handleUpdateAction(), "error");
  assert.equal(statuses.at(-1).state, "error");
  assert.equal(statuses.at(-1).version, "1.9.0");
});

test("invalid manifests and missing Windows artifacts close every started check with a check failure", async () => {
  for (const manifest of [
    { version: "1.2.0-01", files: { zip: { url: "https://example.test/update.zip" } } },
    { version: "1.2.0", files: {} },
  ]) {
    const updates = [];
    const controller = createDesktopUpdateController({
      buildInfo: { version: "1.1.0" },
      dialog: fakeDialog(),
      fetch: async () => ({ ok: true, json: async () => manifest }),
      isPackaged: true,
      platform: "win32",
      arch: "x64",
      recordUpdateState: (update) => updates.push(update),
    });

    assert.equal(await controller.checkForUpdates({ manual: false }), "error");
    assert.equal(updates[0].state, "check_started");
    assert.deepEqual(updates.at(-1), {
      state: "failed",
      trigger: "automatic",
      from_version: "1.1.0",
      ...(manifest.version === "1.2.0" ? { to_version: "1.2.0" } : {}),
      error_code: "manifest",
      stage: "check",
    });
  }
});

test("install lifecycle is recorded at the real entry and entry failures are explicit", async () => {
  const updates = [];
  const controller = createDesktopUpdateController({
    buildInfo: { version: "1.1.0" },
    dialog: fakeDialog(),
    fetch: async () => ({
      ok: true,
      json: async () => ({
        version: "1.2.0",
        files: { zip: { url: "https://example.test/update.zip" } },
      }),
    }),
    isPackaged: true,
    platform: "win32",
    arch: "x64",
    prepareWindowsUpdate: async () => ({ executable: "Git Leaf.exe" }),
    launchWindowsUpdate: () => { throw new Error("launch failed"); },
    recordUpdateState: async (update) => updates.push(update),
  });

  await controller.checkForUpdates({ manual: false });
  await controller.handleUpdateAction();
  assert.equal(updates.some((update) => update.state === "install_started"), false);
  assert.equal(controller.preparePendingUpdateOnQuit(), true);
  assert.equal(updates.some((update) => update.state === "install_started"), false);
  assert.equal(await controller.installPendingUpdateOnQuit(), false);
  assert.deepEqual(updates.slice(-2).map((update) => [update.state, update.stage]), [
    ["install_started", undefined],
    ["failed", "install"],
  ]);
  assert.equal(updates.at(-1).error_code, "launch");
});

test("desktop updater reports Windows network failures on manual checks", async () => {
  const dialog = fakeDialog();
  const statuses = [];
  const updates = [];
  const controller = createDesktopUpdateController({
    buildInfo: { version: "0.1.1" },
    dialog,
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
    isPackaged: true,
    platform: "win32",
    arch: "x64",
    showUpdateStatus: async (status) => statuses.push(status),
    recordUpdateState: (update) => updates.push(update),
  });

  const result = await controller.checkForUpdates({ manual: true });

  assert.equal(result, "error");
  assert.deepEqual(statuses.map((status) => status.state), ["checking", "error"]);
  assert.match(dialog.calls[0][0].message, /检查更新失败：fetch failed/);
  assert.deepEqual(updates.at(-1), {
    state: "failed",
    trigger: "manual",
    from_version: "0.1.1",
    error_code: "network",
    stage: "check",
  });
});
