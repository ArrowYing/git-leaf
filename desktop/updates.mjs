import {
  DEFAULT_UPDATE_BASE_URL,
  DEFAULT_UPDATE_CHANNEL,
  appUpdatePlatformKey,
  compareAppVersions,
  isAppVersionNewer,
  macAutoUpdaterFeedUrl,
  updateChannelForBuildInfo,
  updateManifestIdentityError,
  updateManifestUrl,
} from "../src/app-updates.mjs";
import {
  isOfficialDistribution,
  releaseTrackForBuildInfo,
} from "../src/build-info.mjs";

export function createDesktopUpdateController({
  app,
  autoUpdater,
  buildInfo,
  dialog,
  fetch: fetchFn = globalThis.fetch,
  isPackaged = app?.isPackaged ?? false,
  platform = process.platform,
  arch = process.arch,
  baseUrl = process.env.GIT_LEAF_UPDATE_BASE_URL || DEFAULT_UPDATE_BASE_URL,
  channel: configuredChannel,
  environment = process.env,
  scheduleTimeout = setTimeout,
  clearTimeout: clearScheduledTimeout = clearTimeout,
  macErrorDialogDelayMs = 20_000,
  showUpdateStatus = async () => {},
  getUpdatePreferences = () => ({}),
  saveUpdatePreferences = async () => {},
  recordUpdateState = () => {},
  prepareWindowsUpdate = async () => {
    throw new Error("Windows update preparation is unavailable.");
  },
  launchWindowsUpdate = () => {
    throw new Error("Windows update launch is unavailable.");
  },
  requestQuitForUpdate = async () => {},
} = {}) {
  let isChecking = false;
  let pendingMacErrorTimer = null;
  let pendingMacError = null;
  let pendingMacErrorManual = false;
  let pendingMacUpdate = null;
  let pendingWindowsUpdate = null;
  let installStartedForVersion = "";
  const platformKey = appUpdatePlatformKey({ platform, arch });
  const releaseTrack = releaseTrackForBuildInfo(buildInfo);
  const releaseTrackChannel = updateChannelForBuildInfo(buildInfo);
  const channel = isPackaged
    ? releaseTrackChannel
    : configuredChannel
      || environment.GIT_LEAF_UPDATE_CHANNEL
      || releaseTrackChannel
      || DEFAULT_UPDATE_CHANNEL;

  if (autoUpdater?.on) {
    autoUpdater.on("update-not-available", () => {
      clearPendingMacUpdateError();
      const update = pendingMacUpdate;
      if (update?.state === "downloading") {
        update.state = "error";
        notifyUpdateTelemetry(recordUpdateState, {
          state: "failed",
          trigger: update.trigger || "automatic",
          from_version: buildInfo?.version,
          to_version: update.version || null,
          error_code: "manifest",
          stage: "download",
        });
        void notifyUpdateStatus(showUpdateStatus, {
          state: "error",
          version: update.version || "",
          manual: update.trigger === "manual",
          message: "更新包暂不可用，点击重试。",
        });
      }
    });
    autoUpdater.on("update-available", () => {
      clearPendingMacUpdateError();
      if (pendingMacUpdate?.state !== "downloading") {
        return;
      }
      void notifyUpdateStatus(showUpdateStatus, {
        state: "downloading",
        version: pendingMacUpdate?.version || "",
        message: "正在下载并准备新版本…",
      });
    });
    autoUpdater.on("error", (error) => {
      if (platform === "darwin") {
        scheduleMacUpdateError(error, {
          manual: pendingMacUpdate?.trigger === "manual",
        });
      }
    });
    autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName, releaseDate, updateUrl) => {
      clearPendingMacUpdateError();
      pendingMacUpdate = macDownloadedUpdateInfo({
        pendingUpdate: pendingMacUpdate,
        releaseName,
        updateUrl,
      });
      pendingMacUpdate.state = "downloaded";
      notifyUpdateTelemetry(recordUpdateState, {
        state: "downloaded",
        trigger: pendingMacUpdate.trigger || "automatic",
        from_version: buildInfo?.version,
        to_version: pendingMacUpdate.version || null,
      });
      void notifyUpdateStatus(showUpdateStatus, {
        state: "downloaded",
        version: pendingMacUpdate.version || "",
        message: "新版本已准备好，退出 Git Leaf 后自动安装。",
      });
    });
  }

  return {
    checkForUpdates,
    handleUpdateAction() {
      return handleUpdateAction();
    },
    async restoreKnownUpdate() {
      if (await disabledUpdateResult({ manual: false })) {
        return false;
      }
      const preferences = normalizedUpdatePreferences(getUpdatePreferences());
      const version = newerVersion(
        preferences.updateAvailableVersion,
        preferences.updateRequestedVersion,
      );
      if (!isAppVersionNewer(version, buildInfo?.version)) {
        return false;
      }
      const pending = {
        version,
        trigger: "automatic",
        platform,
        state: "available",
        restored: true,
      };
      if (platform === "darwin") {
        pendingMacUpdate = pending;
      } else if (platform === "win32") {
        pendingWindowsUpdate = pending;
      } else {
        return false;
      }
      await notifyUpdateStatus(showUpdateStatus, {
        state: "available",
        version,
        message: `Git Leaf ${version} 可用，点击更新后开始下载。`,
      });
      return true;
    },
    hasPendingUpdateOnQuit() {
      return Boolean(downloadedUpdate());
    },
    preparePendingUpdateOnQuit() {
      return Boolean(downloadedUpdate());
    },
    async installPendingUpdateOnQuit() {
      const update = downloadedUpdate();
      if (!update) {
        return false;
      }
      try {
        await recordInstallStarted(update);
        if (update.platform === "win32") {
          launchWindowsUpdate(update.prepared);
          return false;
        }
        autoUpdater.quitAndInstall();
        return true;
      } catch {
        await notifyUpdateTelemetryAsync(recordUpdateState, {
          state: "failed",
          trigger: update.trigger || "manual",
          from_version: buildInfo?.version,
          to_version: update.version,
          error_code: "launch",
          stage: "install",
        });
        return false;
      }
    },
  };

  async function checkForUpdates({ manual = false } = {}) {
    if (isChecking) {
      return "busy";
    }
    const existingUpdate = pendingMacUpdate || pendingWindowsUpdate;
    if (existingUpdate?.state === "downloaded") {
      return "downloaded";
    }
    if (existingUpdate?.state === "downloading") {
      return "busy";
    }
    const disabled = await disabledUpdateResult({ manual });
    if (disabled) {
      return disabled;
    }

    isChecking = true;
    const trigger = manual ? "manual" : "automatic";
    notifyUpdateTelemetry(recordUpdateState, {
      state: "check_started",
      trigger,
      from_version: buildInfo?.version,
    });
    try {
      return await discoverUpdate({ manual });
    } finally {
      isChecking = false;
    }
  }

  async function disabledUpdateResult({ manual = false } = {}) {
    if (buildInfo?.dev === true) {
      if (manual) {
        await showInfo(dialog, "Git Leaf dev 不会检查正式版本更新。请重新构建并安装开发版本。");
      }
      return "disabled";
    }
    if (!isOfficialDistribution(buildInfo)) {
      if (manual) {
        await showInfo(dialog, "源码构建不会连接 Git Leaf 官方更新服务。请从官方渠道安装签名版本以接收更新。");
      }
      return "disabled";
    }
    if (!releaseTrackChannel) {
      if (manual) {
        await showInfo(dialog, "当前构建没有可用的正式更新轨道。");
      }
      return "disabled";
    }
    if (!isPackaged && process.env.GIT_LEAF_ENABLE_UPDATES !== "1") {
      if (manual) {
        await showInfo(dialog, "开发模式不会检查自动更新。");
      }
      return "disabled";
    }
    return "";
  }

  async function handleUpdateAction() {
    let update = pendingMacUpdate || pendingWindowsUpdate;
    if (update?.restored) {
      const restoredUpdate = update;
      pendingMacUpdate = null;
      pendingWindowsUpdate = null;
      const result = await checkForUpdates({ manual: true });
      if (result !== "available") {
        if (result === "error") {
          restoredUpdate.state = "error";
          if (restoredUpdate.platform === "darwin") {
            pendingMacUpdate = restoredUpdate;
          } else {
            pendingWindowsUpdate = restoredUpdate;
          }
          await notifyUpdateStatus(showUpdateStatus, {
            state: "error",
            version: restoredUpdate.version,
            manual: true,
            message: "更新检查未完成，点击重试。",
          });
        }
        return result;
      }
      update = pendingMacUpdate || pendingWindowsUpdate;
    }
    if (!update) {
      const result = await checkForUpdates({ manual: true });
      if (result !== "available") {
        return result;
      }
      return startPendingDownload({ trigger: "manual", persistIntent: true });
    }
    if (update.state === "downloading") {
      return "busy";
    }
    if (update.state === "downloaded") {
      await requestQuitForUpdate();
      return "install-now";
    }
    if (update.state === "available" || update.state === "error") {
      return startPendingDownload({ trigger: "manual", persistIntent: true });
    }
    return "unavailable";
  }

  function scheduleMacUpdateError(error, { manual = false } = {}) {
    clearPendingMacUpdateError();
    pendingMacError = error;
    pendingMacErrorManual = manual;
    pendingMacErrorTimer = scheduleTimeout(async () => {
      pendingMacErrorTimer = null;
      const currentError = pendingMacError;
      const currentManual = pendingMacErrorManual;
      pendingMacError = null;
      pendingMacErrorManual = false;
      if (!currentError) {
        return;
      }
      const failedVersion = pendingMacUpdate?.version || null;
      if (pendingMacUpdate) {
        pendingMacUpdate.state = "error";
      }
      notifyUpdateTelemetry(recordUpdateState, {
        state: "failed",
        trigger: currentManual ? "manual" : "automatic",
        from_version: buildInfo?.version,
        to_version: failedVersion,
        error_code: "unknown",
        stage: "download",
      });
      await notifyUpdateStatus(showUpdateStatus, {
        state: "error",
        version: failedVersion || "",
        manual: currentManual,
        message: `下载更新失败，点击重试：${currentError?.message ?? String(currentError)}`,
      });
      if (currentManual) {
        await showInfo(dialog, `下载更新失败：${currentError?.message ?? String(currentError)}`);
      }
    }, macErrorDialogDelayMs);
  }

  function clearPendingMacUpdateError() {
    if (pendingMacErrorTimer !== null) {
      clearScheduledTimeout(pendingMacErrorTimer);
      pendingMacErrorTimer = null;
    }
    pendingMacError = null;
    pendingMacErrorManual = false;
  }

  async function discoverUpdate({ manual = false } = {}) {
    if (platform !== "darwin" && platform !== "win32") {
      if (manual) {
        await showInfo(dialog, "当前平台暂不支持 Git Leaf 自动更新。");
      }
      return "unsupported";
    }
    clearPendingMacUpdateError();
    if (manual) {
      await notifyUpdateStatus(showUpdateStatus, {
        state: "checking",
        message: "正在检查更新…",
      });
    }

    let manifest;
    try {
      manifest = await fetchUpdateManifest({ fetchFn, baseUrl, channel, platformKey });
    } catch (error) {
      notifyUpdateTelemetry(recordUpdateState, {
        state: "failed",
        trigger: manual ? "manual" : "automatic",
        from_version: buildInfo?.version,
        error_code: "network",
        stage: "check",
      });
      if (manual) {
        await notifyUpdateStatus(showUpdateStatus, {
          state: "error",
          manual: true,
          message: `检查更新失败：${error?.message ?? String(error)}`,
        });
        await showInfo(dialog, `检查更新失败：${error?.message ?? String(error)}`);
      }
      return "error";
    }

    const identityError = updateManifestIdentityError(manifest, {
      releaseTrack,
      channel,
      platformKey,
    });
    if (identityError) {
      notifyUpdateTelemetry(recordUpdateState, {
        state: "failed",
        trigger: manual ? "manual" : "automatic",
        from_version: buildInfo?.version,
        error_code: "manifest",
        stage: "check",
      });
      if (manual) {
        await notifyUpdateStatus(showUpdateStatus, {
          state: "error",
          manual: true,
          message: identityError,
        });
        await showInfo(dialog, identityError);
      }
      return "error";
    }

    if (!validSemanticVersion(manifest?.version)) {
      notifyUpdateTelemetry(recordUpdateState, {
        state: "failed",
        trigger: manual ? "manual" : "automatic",
        from_version: buildInfo?.version,
        error_code: "manifest",
        stage: "check",
      });
      const message = "更新清单中的版本号无效。";
      if (manual) {
        await notifyUpdateStatus(showUpdateStatus, { state: "error", manual: true, message });
        await showInfo(dialog, message);
      }
      return "error";
    }

    if (!isAppVersionNewer(manifest.version, buildInfo?.version)) {
      pendingMacUpdate = null;
      pendingWindowsUpdate = null;
      notifyUpdateTelemetry(recordUpdateState, {
        state: "current",
        trigger: manual ? "manual" : "automatic",
        from_version: buildInfo?.version,
        to_version: manifest.version || null,
      });
      await clearObsoleteUpdatePreferences();
      if (manual) {
        await notifyUpdateStatus(showUpdateStatus, {
          state: "current",
          message: "Git Leaf 已经是最新版本。",
        });
        await showInfo(dialog, "Git Leaf 已经是最新版本。");
      }
      return "current";
    }

    if (platform === "win32" && !manifest?.files?.zip?.url) {
      notifyUpdateTelemetry(recordUpdateState, {
        state: "failed",
        trigger: manual ? "manual" : "automatic",
        from_version: buildInfo?.version,
        to_version: manifest.version,
        error_code: "manifest",
        stage: "check",
      });
      const message = "发现新版本，但更新包地址缺失。";
      if (manual) {
        await notifyUpdateStatus(showUpdateStatus, { state: "error", manual: true, message });
        await showInfo(dialog, message);
      }
      return "error";
    }

    const pending = {
      version: String(manifest.version || "").trim(),
      name: manifest?.autoUpdater?.name || `Git Leaf ${manifest.version}`,
      trigger: manual ? "manual" : "automatic",
      platform,
      state: "available",
      manifest,
    };
    if (platform === "darwin") {
      pendingMacUpdate = pending;
    } else {
      pendingWindowsUpdate = pending;
    }
    notifyUpdateTelemetry(recordUpdateState, {
      state: "available",
      trigger: pending.trigger,
      from_version: buildInfo?.version,
      to_version: pending.version || null,
    });
    await notifyUpdateStatus(showUpdateStatus, {
      state: "available",
      version: pending.version,
      message: `Git Leaf ${pending.version} 可用，点击更新后开始下载。`,
    });
    await persistAvailableUpdate(pending.version);
    await clearLegacyUpdatePreferences();

    const preferences = normalizedUpdatePreferences(getUpdatePreferences());
    if (sameVersion(preferences.updateRequestedVersion, pending.version)) {
      return startPendingDownload({ trigger: "automatic", persistIntent: false });
    }
    return "available";
  }

  async function startPendingDownload({ trigger = "manual", persistIntent = true } = {}) {
    const pending = pendingMacUpdate || pendingWindowsUpdate;
    if (!pending || !["available", "error"].includes(pending.state)) {
      return pending?.state === "downloading" ? "busy" : "unavailable";
    }
    pending.trigger = trigger;
    pending.state = "downloading";
    if (persistIntent && pending.version) {
      try {
        await saveUpdatePreferences({ updateRequestedVersion: pending.version });
      } catch (error) {
        pending.state = "error";
        const message = `无法保存更新选择，点击重试：${error?.message ?? String(error)}`;
        await notifyUpdateStatus(showUpdateStatus, {
          state: "error",
          version: pending.version,
          manual: true,
          message,
        });
        await showInfo(dialog, message);
        return "error";
      }
    }
    await notifyUpdateStatus(showUpdateStatus, {
      state: "downloading",
      version: pending.version,
      message: "正在下载并准备新版本…",
    });

    if (pending.platform === "darwin") {
      try {
        autoUpdater.setFeedURL({
          url: macAutoUpdaterFeedUrl({
            baseUrl,
            channel,
            platformKey,
            currentVersion: buildInfo?.version,
          }),
        });
        await autoUpdater.checkForUpdates();
        return "downloading";
      } catch (error) {
        pending.state = "error";
        notifyUpdateTelemetry(recordUpdateState, {
          state: "failed",
          trigger: pending.trigger,
          from_version: buildInfo?.version,
          to_version: pending.version || null,
          error_code: "network",
          stage: "download",
        });
        await notifyUpdateStatus(showUpdateStatus, {
          state: "error",
          version: pending.version,
          manual: trigger === "manual",
          message: `下载更新失败，点击重试：${error?.message ?? String(error)}`,
        });
        if (trigger === "manual") {
          await showInfo(dialog, `下载更新失败：${error?.message ?? String(error)}`);
        }
        return "error";
      }
    }

    try {
      pending.prepared = await prepareWindowsUpdate(pending.manifest);
    } catch (error) {
      pending.state = "error";
      notifyUpdateTelemetry(recordUpdateState, {
        state: "failed",
        trigger: pending.trigger,
        from_version: buildInfo?.version,
        to_version: pending.version || null,
        error_code: "copy",
        stage: "prepare",
      });
      await notifyUpdateStatus(showUpdateStatus, {
        state: "error",
        version: pending.version,
        manual: trigger === "manual",
        message: `准备更新失败，点击重试：${error?.message ?? String(error)}`,
      });
      if (trigger === "manual") {
        await showInfo(dialog, `准备更新失败：${error?.message ?? String(error)}`);
      }
      return "error";
    }
    pending.state = "downloaded";
    notifyUpdateTelemetry(recordUpdateState, {
      state: "downloaded",
      trigger: pending.trigger,
      from_version: buildInfo?.version,
      to_version: pending.version || null,
    });
    await notifyUpdateStatus(showUpdateStatus, {
      state: "downloaded",
      version: pending.version,
      message: "新版本已准备好，退出 Git Leaf 后自动安装。",
    });
    return "downloaded";
  }

  function downloadedUpdate() {
    if (pendingMacUpdate?.state === "downloaded") return pendingMacUpdate;
    if (pendingWindowsUpdate?.state === "downloaded") return pendingWindowsUpdate;
    return null;
  }

  async function recordInstallStarted(update) {
    if (!update?.version || installStartedForVersion === update.version) {
      return false;
    }
    installStartedForVersion = update.version;
    await notifyUpdateTelemetryAsync(recordUpdateState, {
      state: "install_started",
      trigger: update.trigger || "manual",
      from_version: buildInfo?.version,
      to_version: update.version,
    });
    return true;
  }

  async function clearObsoleteUpdatePreferences() {
    const preferences = normalizedUpdatePreferences(getUpdatePreferences());
    if (
      preferences.updateRequestedVersion ||
      preferences.updateAvailableVersion ||
      preferences.promptedUpdateVersion ||
      preferences.skippedUpdateVersion
    ) {
      try {
        await saveUpdatePreferences({
          updateRequestedVersion: "",
          updateAvailableVersion: "",
          promptedUpdateVersion: "",
          skippedUpdateVersion: "",
        });
      } catch {
        // Preference cleanup is best-effort after the current version is confirmed.
      }
    }
  }

  async function persistAvailableUpdate(version) {
    const preferences = normalizedUpdatePreferences(getUpdatePreferences());
    if (!version || sameVersion(preferences.updateAvailableVersion, version)) {
      return;
    }
    try {
      await saveUpdatePreferences({ updateAvailableVersion: version });
    } catch {
      // The current session can still expose the update if persistence fails.
    }
  }

  async function clearLegacyUpdatePreferences() {
    const preferences = normalizedUpdatePreferences(getUpdatePreferences());
    if (preferences.promptedUpdateVersion || preferences.skippedUpdateVersion) {
      try {
        await saveUpdatePreferences({ promptedUpdateVersion: "", skippedUpdateVersion: "" });
      } catch {
        // Legacy preferences must not hide or block an available update.
      }
    }
  }
}

async function fetchUpdateManifest({ fetchFn, baseUrl, channel, platformKey }) {
  let response;
  try {
    response = await fetchFn(updateManifestUrl({ baseUrl, channel, platformKey }));
  } catch (error) {
    throw new Error(error?.message ?? String(error));
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`latest.json 不可解析：${error?.message ?? String(error)}`);
  }
}

async function notifyUpdateStatus(showUpdateStatus, status) {
  if (typeof showUpdateStatus !== "function") {
    return;
  }

  try {
    await showUpdateStatus(status);
  } catch {
    // Update UI feedback must not block the updater state machine.
  }
}

async function showInfo(dialog, message) {
  if (!dialog?.showMessageBox) {
    return;
  }
  await dialog.showMessageBox({
    type: "info",
    buttons: ["好"],
    message,
  });
}

function normalizedUpdatePreferences(value) {
  return {
    updateAvailableVersion: typeof value?.updateAvailableVersion === "string"
      ? value.updateAvailableVersion.trim()
      : "",
    updateRequestedVersion: typeof value?.updateRequestedVersion === "string"
      ? value.updateRequestedVersion.trim()
      : "",
    skippedUpdateVersion: typeof value?.skippedUpdateVersion === "string"
      ? value.skippedUpdateVersion.trim()
      : "",
    promptedUpdateVersion: typeof value?.promptedUpdateVersion === "string"
      ? value.promptedUpdateVersion.trim()
      : "",
  };
}

function sameVersion(left, right) {
  if (!left || !right) {
    return false;
  }
  return compareAppVersions(left, right) === 0;
}

function newerVersion(left, right) {
  if (!left) return right || "";
  if (!right) return left;
  return compareAppVersions(left, right) >= 0 ? left : right;
}

function macDownloadedUpdateInfo({ pendingUpdate, releaseName, updateUrl } = {}) {
  if (pendingUpdate?.version) {
    return pendingUpdate;
  }
  const version = versionFromUpdateText(releaseName) || versionFromUpdateText(updateUrl);
  return {
    ...(version ? { version } : {}),
    ...(releaseName ? { name: String(releaseName) } : {}),
  };
}

function notifyUpdateTelemetry(recordUpdateState, update) {
  if (typeof recordUpdateState !== "function") {
    return false;
  }
  try {
    return recordUpdateState(update) !== false;
  } catch {
    return false;
  }
}

async function notifyUpdateTelemetryAsync(recordUpdateState, update) {
  if (typeof recordUpdateState !== "function") {
    return false;
  }
  try {
    return await recordUpdateState(update) !== false;
  } catch {
    return false;
  }
}

function validSemanticVersion(value) {
  if (typeof value !== "string" || value.length > 40) return false;
  const match = value.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
  );
  if (!match) return false;
  return !String(match[4] ?? "").split(".").some((identifier) =>
    /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")
  );
}

function versionFromUpdateText(value) {
  const match = String(value || "").match(/\b(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\b/);
  return match?.[1] ?? "";
}
