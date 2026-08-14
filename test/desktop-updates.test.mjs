import test from "node:test";
import assert from "node:assert/strict";

import { createDesktopUpdateController as createDesktopUpdateControllerImpl } from "../src/desktop/updates.mjs";
import { createDesktopTranslator } from "../src/desktop/localization.mjs";

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

function fakeMacManifestFetch({
  version = "1.2.1",
  releaseTrack = "public",
  buildId = `0123456789ab.20260730T010000Z.${releaseTrack}`,
  commit = "0123456789ab",
  channel = releaseTrack === "internal" ? "internal-stable" : "stable",
  platform = "darwin-universal",
} = {}) {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    return {
      ok: true,
      json: async () => ({
        releaseTrack,
        channel,
        platform,
        version,
        buildId,
        commit,
        autoUpdater: {
          name: `OpenPeek ${version}`,
        },
        files: {
          zip: {
            url: `https://updates.mangofuture.com/git-leaf/${channel}/${platform}/OpenPeek-${version}.zip`,
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
    checkCount: 0,
    installed: false,
    setFeedURL: ({ url }) => {
      autoUpdater.feedUrls.push(url);
    },
    checkForUpdates: () => {
      autoUpdater.checked = true;
      autoUpdater.checkCount += 1;
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

test("desktop updater configures Squirrel.Mac and starts downloading after discovery", async () => {
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

  assert.equal(await controller.checkForUpdates({ manual: true }), "downloading");

  assert.deepEqual(feedUrls, [
    "https://updates.mangofuture.com/git-leaf/stable/darwin-universal/releases/0.1.1",
  ]);
  assert.equal(checked, true);
  assert.deepEqual(fetch.urls, [
    "https://updates.mangofuture.com/git-leaf/stable/darwin-universal/latest.json",
  ]);
});

test("packaged internal builds ignore environment channel overrides", async () => {
  const autoUpdater = fakeAutoUpdater();
  const fetch = fakeMacManifestFetch({
    version: "1.11.3",
    releaseTrack: "internal",
  });
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: {
      version: "1.11.2",
      releaseTrack: "internal",
    },
    fetch,
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    channel: "stable",
    environment: {
      OPENPEEK_UPDATE_CHANNEL: "candidate",
    },
  });

  assert.equal(await controller.checkForUpdates({ manual: true }), "downloading");
  assert.deepEqual(fetch.urls, [
    "https://updates.mangofuture.com/git-leaf/internal-stable/darwin-universal/latest.json",
  ]);
  assert.deepEqual(autoUpdater.feedUrls, [
    "https://updates.mangofuture.com/git-leaf/internal-stable/darwin-universal/releases/1.11.2",
  ]);
});

test("desktop updater rejects manifests from another track, channel, or platform", async () => {
  for (const mismatch of [
    { releaseTrack: "internal" },
    { channel: "internal-stable" },
    { platform: "win32-x64" },
  ]) {
    const dialog = fakeDialog();
    const fetch = fakeMacManifestFetch({
      version: "1.11.3",
      ...mismatch,
    });
    const controller = createDesktopUpdateController({
      autoUpdater: fakeAutoUpdater(),
      buildInfo: { version: "1.11.2", releaseTrack: "public" },
      dialog,
      fetch,
      isPackaged: true,
      platform: "darwin",
      arch: "arm64",
    });

    assert.equal(await controller.checkForUpdates({ manual: true }), "error");
    assert.equal(dialog.calls.length, 1);
    assert.match(dialog.calls[0][0].message, /does not match/);
  }
});

test("packaged source development builds ignore an equal-version internal release", async () => {
  const autoUpdater = fakeAutoUpdater();
  let saveCalls = 0;
  let prepareCalls = 0;
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: {
      version: "1.16.0",
      buildId: "aaaaaaaaaaaa.20260730T010000Z.source",
      commit: "aaaaaaaaaaaa",
      dev: true,
      distribution: "source",
      releaseTrack: "source",
    },
    fetch: fakeMacManifestFetch({
      version: "1.16.0",
      buildId: "2c3e9d8cfcfb.20260728T235326Z.internal",
      commit: "2c3e9d8cfcfb",
      releaseTrack: "internal",
    }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    saveDevelopmentHandoff: async () => {
      saveCalls += 1;
    },
    prepareDevelopmentHandoffUpdate: async () => {
      prepareCalls += 1;
    },
  });

  assert.equal(await controller.checkForUpdates({ manual: false }), "current");
  assert.equal(saveCalls, 0);
  assert.equal(prepareCalls, 0);
  assert.equal(autoUpdater.checked, false);
  assert.deepEqual(autoUpdater.feedUrls, []);
});

test("packaged source development builds automatically prepare a newer internal handoff", async () => {
  const autoUpdater = fakeAutoUpdater();
  const fetch = fakeMacManifestFetch({
    version: "1.16.1",
    buildId: "2c3e9d8cfcfb.20260728T235326Z.internal",
    commit: "2c3e9d8cfcfb",
    releaseTrack: "internal",
  });
  const savedHandoffs = [];
  const operations = [];
  autoUpdater.setFeedURL = ({ url }) => {
    operations.push("feed");
    autoUpdater.feedUrls.push(url);
  };
  autoUpdater.checkForUpdates = () => {
    operations.push("download");
    autoUpdater.checked = true;
  };
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: {
      version: "1.16.0",
      buildId: "aaaaaaaaaaaa.20260730T010000Z.source",
      commit: "aaaaaaaaaaaa",
      dev: true,
      distribution: "source",
      releaseTrack: "source",
    },
    fetch,
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    environment: {
      OPENPEEK_UPDATE_CHANNEL: "candidate",
    },
    saveDevelopmentHandoff: async (handoff) => {
      operations.push("save");
      savedHandoffs.push(handoff);
    },
    prepareDevelopmentHandoffUpdate: async ({ handoff }) => {
      operations.push("prepare");
      return { readyFile: "/tmp/internal-ready.json", handoff };
    },
  });

  assert.equal(await controller.checkForUpdates({ manual: true }), "downloaded");
  assert.equal(autoUpdater.checked, false);
  assert.deepEqual(fetch.urls, [
    "https://updates.mangofuture.com/git-leaf/internal-stable/darwin-universal/latest.json",
  ]);
  assert.deepEqual(operations, ["save", "prepare"]);
  assert.deepEqual(savedHandoffs, [{
    kind: "dev-to-internal",
    version: "1.16.1",
    buildId: "2c3e9d8cfcfb.20260728T235326Z.internal",
    commit: "2c3e9d8cfcfb",
    releaseTrack: "internal",
    channel: "internal-stable",
    platform: "darwin-universal",
  }]);
  assert.deepEqual(autoUpdater.feedUrls, []);
  assert.equal(autoUpdater.checked, false);
});

test("development handoff never downgrades to an older internal build", async () => {
  const autoUpdater = fakeAutoUpdater();
  const fetch = fakeMacManifestFetch({
    version: "1.15.0",
    releaseTrack: "internal",
  });
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: {
      version: "1.16.0",
      buildId: "aaaaaaaaaaaa.20260730T010000Z.source",
      commit: "aaaaaaaaaaaa",
      dev: true,
      distribution: "source",
      releaseTrack: "source",
    },
    fetch,
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
  });

  assert.equal(await controller.checkForUpdates({ manual: false }), "current");
  assert.equal(autoUpdater.checked, false);
  assert.deepEqual(autoUpdater.feedUrls, []);
});

test("development handoff download is blocked when its receipt cannot be saved", async () => {
  const autoUpdater = fakeAutoUpdater();
  const dialog = fakeDialog();
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: {
      version: "1.16.0",
      buildId: "aaaaaaaaaaaa.20260730T010000Z.source",
      commit: "aaaaaaaaaaaa",
      dev: true,
      distribution: "source",
      releaseTrack: "source",
    },
    dialog,
    fetch: fakeMacManifestFetch({
      version: "1.16.1",
      buildId: "2c3e9d8cfcfb.20260728T235326Z.internal",
      commit: "2c3e9d8cfcfb",
      releaseTrack: "internal",
    }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    saveDevelopmentHandoff: async () => {
      throw new Error("config is read-only");
    },
  });

  assert.equal(await controller.checkForUpdates({ manual: false }), "error");
  assert.equal(autoUpdater.checked, false);
  assert.deepEqual(autoUpdater.feedUrls, []);
  assert.equal(dialog.calls.length, 0);
});

test("a saved identity-bound development handoff resumes without another choice", async () => {
  const autoUpdater = fakeAutoUpdater();
  const handoff = {
    kind: "dev-to-internal",
    version: "1.16.1",
    buildId: "2c3e9d8cfcfb.20260728T235326Z.internal",
    commit: "2c3e9d8cfcfb",
    releaseTrack: "internal",
    channel: "internal-stable",
    platform: "darwin-universal",
  };
  let saveCalls = 0;
  let prepareCalls = 0;
  let cleanupCalls = 0;
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: {
      version: "1.16.0",
      buildId: "aaaaaaaaaaaa.20260730T010000Z.source",
      commit: "aaaaaaaaaaaa",
      dev: true,
      distribution: "source",
      releaseTrack: "source",
    },
    fetch: fakeMacManifestFetch({
      version: handoff.version,
      buildId: handoff.buildId,
      commit: handoff.commit,
      releaseTrack: "internal",
    }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    getDevelopmentHandoff: () => handoff,
    saveDevelopmentHandoff: async () => {
      saveCalls += 1;
    },
    prepareDevelopmentHandoffUpdate: async () => {
      prepareCalls += 1;
      return { readyFile: "/tmp/internal-ready.json" };
    },
    cleanupMacUpdateCache: async () => {
      cleanupCalls += 1;
    },
  });

  assert.equal(await controller.restoreKnownUpdate(), true);
  assert.equal(await controller.checkForUpdates({ manual: false }), "downloaded");
  assert.equal(saveCalls, 0);
  assert.equal(prepareCalls, 1);
  assert.equal(await controller.checkForUpdates({ manual: false }), "downloaded");
  assert.equal(cleanupCalls, 0);
  assert.equal(autoUpdater.checked, false);
  assert.deepEqual(autoUpdater.feedUrls, []);
});

test("an equal-version saved development handoff is not restored", async () => {
  const handoff = {
    kind: "dev-to-internal",
    version: "1.16.0",
    buildId: "2c3e9d8cfcfb.20260728T235326Z.internal",
    commit: "2c3e9d8cfcfb",
    releaseTrack: "internal",
    channel: "internal-stable",
    platform: "darwin-universal",
  };
  const controller = createDesktopUpdateController({
    autoUpdater: fakeAutoUpdater(),
    buildInfo: {
      version: "1.16.0",
      buildId: "aaaaaaaaaaaa.20260730T010000Z.source",
      commit: "aaaaaaaaaaaa",
      dev: true,
      distribution: "source",
      releaseTrack: "source",
    },
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    getDevelopmentHandoff: () => handoff,
  });

  assert.equal(await controller.restoreKnownUpdate(), false);
});

test("development handoff launches the prepared bridge instead of Squirrel", async () => {
  const autoUpdater = fakeAutoUpdater();
  const operations = [];
  autoUpdater.quitAndInstall = () => {
    operations.push("install");
    autoUpdater.installed = true;
  };
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: {
      version: "1.16.0",
      buildId: "aaaaaaaaaaaa.20260730T010000Z.source",
      commit: "aaaaaaaaaaaa",
      dev: true,
      distribution: "source",
      releaseTrack: "source",
    },
    fetch: fakeMacManifestFetch({
      version: "1.16.1",
      buildId: "2c3e9d8cfcfb.20260728T235326Z.internal",
      commit: "2c3e9d8cfcfb",
      releaseTrack: "internal",
    }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    saveDevelopmentHandoff: async () => {},
    prepareDevelopmentHandoffUpdate: async ({ handoff }) => {
      operations.push(`download:${handoff.buildId}`);
      return { readyFile: "/tmp/internal-ready.json" };
    },
    launchDevelopmentHandoffUpdate: (prepared) => {
      operations.push(`launch:${prepared.readyFile}`);
    },
  });

  await controller.checkForUpdates({ manual: true });

  assert.equal(await controller.installPendingUpdateOnQuit(), false);
  assert.deepEqual(operations, [
    "download:2c3e9d8cfcfb.20260728T235326Z.internal",
    "launch:/tmp/internal-ready.json",
  ]);
  assert.equal(autoUpdater.installed, false);
});

test("development handoff refuses installation when the bridge cannot launch", async () => {
  const autoUpdater = fakeAutoUpdater();
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: {
      version: "1.16.0",
      buildId: "aaaaaaaaaaaa.20260730T010000Z.source",
      commit: "aaaaaaaaaaaa",
      dev: true,
      distribution: "source",
      releaseTrack: "source",
    },
    fetch: fakeMacManifestFetch({
      version: "1.16.1",
      buildId: "2c3e9d8cfcfb.20260728T235326Z.internal",
      commit: "2c3e9d8cfcfb",
      releaseTrack: "internal",
    }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    saveDevelopmentHandoff: async () => {},
    prepareDevelopmentHandoffUpdate: async () => ({
      readyFile: "/tmp/internal-ready.json",
    }),
    launchDevelopmentHandoffUpdate: () => {
      throw new Error("bridge launch failed");
    },
  });

  await controller.checkForUpdates({ manual: true });

  assert.equal(await controller.installPendingUpdateOnQuit(), false);
  assert.equal(autoUpdater.installed, false);
});

test("desktop updater never contacts the official feed for Community Builds", async () => {
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
  assert.match(dialog.calls[0][0].message, /Community Builds/);
});

test("desktop updater resolves its dynamic translator when feedback is shown", async () => {
  const dialog = fakeDialog();
  let language = "en";
  const controller = createDesktopUpdateController({
    autoUpdater: fakeAutoUpdater(),
    buildInfo: {
      version: "1.8.1",
      dev: true,
      distribution: "source",
      releaseTrack: "source",
    },
    dialog,
    isPackaged: false,
    platform: "darwin",
    arch: "arm64",
    translate(key, values) {
      return createDesktopTranslator({ language })(key, values);
    },
  });

  language = "zh-CN";
  assert.equal(await controller.checkForUpdates({ manual: true }), "disabled");
  assert.match(dialog.calls[0][0].message, /已打包安装/);
  assert.deepEqual(dialog.calls[0][0].buttons, ["好"]);
});

test("desktop update actions cannot bypass development-build update guards", async () => {
  const autoUpdater = fakeAutoUpdater();
  const dialog = fakeDialog();
  const fetch = fakeMacManifestFetch({ version: "1.9.0" });
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: {
      version: "1.8.1",
      dev: true,
      distribution: "source",
      releaseTrack: "source",
    },
    dialog,
    fetch,
    isPackaged: false,
    platform: "darwin",
    arch: "arm64",
  });

  assert.equal(await controller.handleUpdateAction(), "disabled");
  assert.deepEqual(fetch.urls, []);
  assert.equal(autoUpdater.checked, false);
  assert.match(dialog.calls[0][0].message, /OpenPeek dev/);
});

test("development builds do not restore version-only update actions from shared preferences", async () => {
  const statuses = [];
  const controller = createDesktopUpdateController({
    autoUpdater: fakeAutoUpdater(),
    buildInfo: {
      version: "1.8.1",
      dev: true,
      distribution: "source",
      releaseTrack: "source",
    },
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
  autoUpdater.listeners.get("error")(
    new Error("文件夹“OpenPeek-1.2.1-darwin-arm64.zip”不存在。：该文件夹不存在。"),
  );

  assert.equal(dialog.calls.length, 0);
  assert.equal(typeof delayedError, "function");

  autoUpdater.listeners.get("update-downloaded")();

  assert.equal(dialog.calls.length, 0);
  assert.equal(await controller.installPendingUpdateOnQuit(), true);
});

test("desktop updater preserves the current macOS App path before ShipIt restarts", async () => {
  const autoUpdater = fakeAutoUpdater();
  const calls = [];
  autoUpdater.quitAndInstall = () => {
    calls.push("quit-and-install");
    autoUpdater.installed = true;
  };
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.2.0" },
    dialog: fakeDialog(),
    fetch: fakeMacManifestFetch(),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    prepareMacUpdateInstallation: async (update) => {
      calls.push(`preserve-path:${update.version}`);
    },
  });

  await controller.checkForUpdates({ manual: true });
  autoUpdater.listeners.get("update-downloaded")();

  assert.equal(await controller.installPendingUpdateOnQuit(), true);
  assert.deepEqual(calls, [
    "preserve-path:1.2.1",
    "quit-and-install",
  ]);
});

test("desktop updater fails closed when the macOS App path cannot be preserved", async () => {
  const autoUpdater = fakeAutoUpdater();
  const updates = [];
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.2.0" },
    dialog: fakeDialog(),
    fetch: fakeMacManifestFetch(),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    prepareMacUpdateInstallation: async () => {
      throw new Error("ShipIt state mismatch");
    },
    recordUpdateState: (update) => updates.push(update),
  });

  await controller.checkForUpdates({ manual: true });
  autoUpdater.listeners.get("update-downloaded")();

  assert.equal(await controller.installPendingUpdateOnQuit(), false);
  assert.equal(autoUpdater.installed, false);
  assert.deepEqual(updates.at(-1), {
    state: "failed",
    trigger: "manual",
    from_version: "1.2.0",
    to_version: "1.2.1",
    error_code: "launch",
    stage: "install",
  });
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
  autoUpdater.listeners.get("update-available")();
  autoUpdater.listeners.get("update-downloaded")();

  assert.deepEqual(statuses.map((status) => status.state), [
    "checking",
    "available",
    "downloading",
    "downloading",
    "downloaded",
  ]);
  assert.match(statuses[0].message, /Checking for updates/);
  assert.match(statuses[2].message, /Downloading and preparing/);
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
  autoUpdater.listeners.get("error")(new Error("network failed"));

  assert.equal(dialog.calls.length, 0);
  await delayedError();

  assert.equal(dialog.calls.length, 1);
  assert.match(dialog.calls[0][0].message, /Could not download the update/);
  assert.equal(dialog.calls[0][0].detail, "network failed");
  assert.deepEqual(dialog.calls[0][0].buttons, ["OK"]);
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

test("legacy skipped versions no longer suppress automatic update preparation", async () => {
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

  assert.equal(result, "downloading");
  assert.equal(autoUpdater.checked, true);
  assert.deepEqual(statuses.map((status) => status.state), ["checking", "available", "downloading"]);
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
  autoUpdater.listeners.get("update-downloaded")();

  assert.equal(await controller.handleUpdateAction(), "install-now");
  assert.equal(quitRequests, 1);
  assert.equal(autoUpdater.installed, false);
  assert.equal(await controller.installPendingUpdateOnQuit(), true);
  assert.equal(autoUpdater.installed, true);
});

test("legacy prompted versions do not suppress automatic update preparation", async () => {
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

  assert.equal(await controller.checkForUpdates({ manual: false }), "downloading");

  assert.equal(dialog.calls.length, 0);
  assert.deepEqual(savedPreferences, [
    { updateAvailableVersion: "1.2.1" },
    { promptedUpdateVersion: "", skippedUpdateVersion: "" },
  ]);
  assert.equal(autoUpdater.checked, true);
  assert.equal(autoUpdater.installed, false);
});

test("desktop updater automatically prepares Windows and launches it on quit", async () => {
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
        releaseTrack: "public",
        channel: "stable",
        platform: "win32-x64",
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
      return { version: manifest.version, executable: "C:\\updates\\OpenPeek.exe" };
    },
    launchWindowsUpdate: (prepared) => launched.push(prepared),
    showUpdateStatus: async (status) => statuses.push(status),
  });

  assert.equal(await controller.checkForUpdates({ manual: true }), "downloaded");

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
        releaseTrack: "public",
        channel: "stable",
        platform: "win32-x64",
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
  assert.match(dialog.calls[0][0].message, /up to date/);
});

test("automatic macOS checks start downloading without an action", async () => {
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

  assert.equal(await controller.checkForUpdates({ manual: false }), "downloading");
  assert.equal(autoUpdater.checked, true);
  assert.deepEqual(statuses.map((status) => status.state), ["available", "downloading"]);
  assert.equal(statuses[0].version, "1.9.0");
});

test("a newer macOS release replaces the downloaded update and prunes the old package", async () => {
  const autoUpdater = fakeAutoUpdater();
  const cleanupVersions = [];
  const statuses = [];
  let releaseFirstCleanup;
  const firstCleanupCanFinish = new Promise((resolve) => {
    releaseFirstCleanup = resolve;
  });
  let version = "1.9.0";
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.8.1" },
    dialog: fakeDialog(),
    fetch: async () => ({
      ok: true,
      json: async () => ({
        releaseTrack: "public",
        channel: "stable",
        platform: "darwin-universal",
        version,
        autoUpdater: { name: `OpenPeek ${version}` },
        files: {
          zip: {
            url: `https://updates.example/OpenPeek-${version}-darwin-universal.zip`,
          },
        },
      }),
    }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    cleanupMacUpdateCache: async () => {
      cleanupVersions.push(version);
      if (cleanupVersions.length === 1) {
        await firstCleanupCanFinish;
      }
    },
    showUpdateStatus: async (status) => statuses.push(status),
  });

  assert.equal(await controller.checkForUpdates({ manual: false }), "downloading");
  autoUpdater.listeners.get("update-downloaded")();
  await flushUpdatePrompt();
  assert.deepEqual(cleanupVersions, ["1.9.0"]);

  version = "1.10.0";
  const newerCheck = controller.checkForUpdates({ manual: false });
  await flushUpdatePrompt();
  assert.equal(autoUpdater.checkCount, 1);
  releaseFirstCleanup();
  assert.equal(await newerCheck, "downloading");
  autoUpdater.listeners.get("update-downloaded")();
  await flushUpdatePrompt();

  assert.deepEqual(cleanupVersions, ["1.9.0", "1.10.0"]);
  assert.equal(autoUpdater.checkCount, 2);
  assert.equal(await controller.checkForUpdates({ manual: false }), "downloaded");
  assert.equal(autoUpdater.checkCount, 2);
  assert.equal(statuses.at(-1).state, "downloaded");
  assert.equal(statuses.at(-1).version, "1.10.0");
});

test("a downloaded macOS update retries transient cache cleanup on the next check", async () => {
  const autoUpdater = fakeAutoUpdater();
  let cleanupCalls = 0;
  const controller = createDesktopUpdateController({
    autoUpdater,
    buildInfo: { version: "1.8.1" },
    dialog: fakeDialog(),
    fetch: fakeMacManifestFetch({ version: "1.9.0" }),
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    cleanupMacUpdateCache: async () => {
      cleanupCalls += 1;
      if (cleanupCalls === 1) {
        throw new Error("cache temporarily busy");
      }
      return { complete: true };
    },
  });

  assert.equal(await controller.checkForUpdates({ manual: false }), "downloading");
  autoUpdater.listeners.get("update-downloaded")();
  await flushUpdatePrompt();
  assert.equal(cleanupCalls, 1);

  assert.equal(await controller.checkForUpdates({ manual: false }), "downloaded");
  assert.equal(cleanupCalls, 2);
  assert.equal(autoUpdater.checkCount, 1);
});

test("a known available update is restored before automatic preparation", async () => {
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

  assert.equal(await controller.checkForUpdates({ manual: false }), "downloading");
  assert.equal(fetch.urls.length, 1);
  assert.equal(autoUpdater.checked, true);
  assert.deepEqual(savedPreferences, []);
});

test("a restored available indicator survives temporary automatic network failures", async () => {
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
  assert.equal(await controller.checkForUpdates({ manual: false }), "error");
  assert.equal(statuses.at(-1).state, "available");
  assert.equal(statuses.at(-1).version, "1.9.0");
  assert.equal(await controller.checkForUpdates({ manual: false }), "error");
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

test("discovering an available macOS update starts one automatic download", async () => {
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

  assert.equal(await controller.checkForUpdates({ manual: false }), "downloading");
  assert.equal(autoUpdater.checked, true);
  assert.deepEqual(savedPreferences, [{ updateAvailableVersion: "1.9.0" }]);
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

test("automatic Windows checks prepare immediately and install on quit", async () => {
  const prepared = [];
  const launched = [];
  const controller = createDesktopUpdateController({
    buildInfo: { version: "1.8.1" },
    dialog: fakeDialog(),
    fetch: async () => ({
      ok: true,
      json: async () => ({
        releaseTrack: "public",
        channel: "stable",
        platform: "win32-x64",
        version: "1.9.0",
        files: {
          zip: {
            url: "https://updates.example/OpenPeek-1.9.0-win32-x64.zip",
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
      return { version: manifest.version, executable: "C:\\updates\\OpenPeek.exe" };
    },
    launchWindowsUpdate: (pending) => launched.push(pending),
  });

  assert.equal(await controller.checkForUpdates({ manual: false }), "downloaded");
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
  autoUpdater.listeners.get("update-downloaded")();
  autoUpdater.listeners.get("update-available")();

  assert.equal(statuses.at(-1).state, "downloaded");
  assert.equal(await controller.installPendingUpdateOnQuit(), true);
});

test("a failed discovery-state write does not block the automatic download", async () => {
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

  assert.equal(await controller.checkForUpdates({ manual: false }), "downloading");
  assert.equal(autoUpdater.checked, true);
  assert.equal(statuses.at(-1).state, "downloading");
  assert.equal(statuses.at(-1).version, "1.9.0");
  assert.equal(dialog.calls.length, 0);
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

  assert.equal(await controller.checkForUpdates({ manual: false }), "error");
  assert.equal(statuses.at(-1).state, "error");
  assert.equal(statuses.at(-1).version, "1.9.0");
});

test("invalid manifests and missing Windows artifacts close every started check with a check failure", async () => {
  for (const manifest of [
    {
      releaseTrack: "public",
      channel: "stable",
      platform: "win32-x64",
      version: "1.2.0-01",
      files: { zip: { url: "https://example.test/update.zip" } },
    },
    {
      releaseTrack: "public",
      channel: "stable",
      platform: "win32-x64",
      version: "1.2.0",
      files: {},
    },
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
        releaseTrack: "public",
        channel: "stable",
        platform: "win32-x64",
        version: "1.2.0",
        files: { zip: { url: "https://example.test/update.zip" } },
      }),
    }),
    isPackaged: true,
    platform: "win32",
    arch: "x64",
    prepareWindowsUpdate: async () => ({ executable: "OpenPeek.exe" }),
    launchWindowsUpdate: () => { throw new Error("launch failed"); },
    recordUpdateState: async (update) => updates.push(update),
  });

  await controller.checkForUpdates({ manual: false });
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
  assert.equal(statuses.at(-1).detail, "fetch failed");
  assert.match(dialog.calls[0][0].message, /Could not check for updates/);
  assert.equal(dialog.calls[0][0].detail, "fetch failed");
  assert.deepEqual(updates.at(-1), {
    state: "failed",
    trigger: "manual",
    from_version: "0.1.1",
    error_code: "network",
    stage: "check",
  });
});

test("desktop updater reports invalid latest.json without leaking Chinese parser copy", async () => {
  const dialog = fakeDialog();
  const statuses = [];
  const controller = createDesktopUpdateController({
    buildInfo: { version: "0.1.1" },
    dialog,
    fetch: async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    }),
    isPackaged: true,
    platform: "win32",
    arch: "x64",
    showUpdateStatus: async (status) => statuses.push(status),
    translate: createDesktopTranslator({ language: "zh-CN" }),
  });

  assert.equal(await controller.checkForUpdates({ manual: true }), "error");
  assert.equal(statuses.at(-1).message, "检查更新失败。");
  assert.match(statuses.at(-1).detail, /Could not parse latest\.json: Unexpected token/);
  assert.doesNotMatch(statuses.at(-1).detail, /不可解析/);
  assert.equal(dialog.calls[0][0].message, "检查更新失败。");
  assert.doesNotMatch(dialog.calls[0][0].detail, /不可解析/);
});
