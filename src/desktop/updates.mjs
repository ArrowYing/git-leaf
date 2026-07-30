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
} from "./app-updates.mjs";
import {
  isOfficialDistribution,
  releaseTrackForBuildInfo,
} from "../build-info.mjs";
import { createDesktopTranslator } from "./localization.mjs";
import {
  developmentHandoffReceiptForManifest,
  developmentHandoffTarget,
  normalizeDevelopmentHandoffReceipt,
  sameDevelopmentHandoffReceipt,
} from "./development-handoff.mjs";

const DEFAULT_UPDATE_TRANSLATE = createDesktopTranslator({ language: "en" });

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
  getDevelopmentHandoff = () => null,
  saveDevelopmentHandoff = async () => {
    throw new Error("Development handoff persistence is unavailable.");
  },
  prepareDevelopmentHandoffUpdate = async () => {
    throw new Error("Development handoff update preparation is unavailable.");
  },
  launchDevelopmentHandoffUpdate = () => {
    throw new Error("Development handoff update launch is unavailable.");
  },
  recordUpdateState = () => {},
  prepareWindowsUpdate = async () => {
    throw new Error("Windows update preparation is unavailable.");
  },
  launchWindowsUpdate = () => {
    throw new Error("Windows update launch is unavailable.");
  },
  requestQuitForUpdate = async () => {},
  translate = DEFAULT_UPDATE_TRANSLATE,
} = {}) {
  const text = translatedText(translate);
  let isChecking = false;
  let pendingMacErrorTimer = null;
  let pendingMacError = null;
  let pendingMacErrorManual = false;
  let pendingMacUpdate = null;
  let pendingWindowsUpdate = null;
  let installStartedForVersion = "";
  const platformKey = appUpdatePlatformKey({ platform, arch });
  const handoffTarget = developmentHandoffTarget({
    buildInfo,
    isPackaged,
    platform,
    arch,
  });
  const releaseTrack = handoffTarget?.releaseTrack
    || releaseTrackForBuildInfo(buildInfo);
  const releaseTrackChannel = handoffTarget?.channel
    || updateChannelForBuildInfo(buildInfo);
  const channel = isPackaged
    ? releaseTrackChannel
    : configuredChannel
      || environment.GIT_LEAF_UPDATE_CHANNEL
      || releaseTrackChannel
      || DEFAULT_UPDATE_CHANNEL;

  async function showUpdateInfo(key, { values = {}, detail = "" } = {}) {
    await showInfo(dialog, text(key, values), {
      buttonLabel: text("common.ok"),
      detail,
    });
  }

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
          message: text("updates.packageUnavailable"),
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
        message: text("updates.downloading"),
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
        message: text("updates.downloaded"),
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
      if (handoffTarget) {
        const handoff = normalizeDevelopmentHandoffReceipt(
          getDevelopmentHandoff(),
        );
        if (
          !handoff
          || !sameDevelopmentHandoffTarget(handoff, handoffTarget)
          || compareAppVersions(handoff.version, buildInfo?.version) < 0
        ) {
          return false;
        }
        if (platform !== "darwin") {
          return false;
        }
        pendingMacUpdate = {
          version: handoff.version,
          trigger: "automatic",
          platform,
          state: "available",
          restored: true,
          handoff,
        };
        await notifyUpdateStatus(showUpdateStatus, {
          state: "available",
          version: handoff.version,
          message: availableUpdateMessage({
            text,
            version: handoff.version,
            handoff: true,
          }),
        });
        return true;
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
        message: text("updates.availableVersion", { version }),
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
        if (update.handoff) {
          launchDevelopmentHandoffUpdate(update.prepared);
          return false;
        }
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
    if (handoffTarget) {
      return "";
    }
    if (buildInfo?.dev === true) {
      if (manual) {
        await showUpdateInfo("updates.disabledDevBuild");
      }
      return "disabled";
    }
    if (!isOfficialDistribution(buildInfo)) {
      if (manual) {
        await showUpdateInfo("updates.disabledSourceBuild");
      }
      return "disabled";
    }
    if (!releaseTrackChannel) {
      if (manual) {
        await showUpdateInfo("updates.disabledNoTrack");
      }
      return "disabled";
    }
    if (!isPackaged && process.env.GIT_LEAF_ENABLE_UPDATES !== "1") {
      if (manual) {
        await showUpdateInfo("updates.disabledDevelopmentMode");
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
            message: text("updates.checkIncomplete"),
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
        message: text("updates.downloadFailedRetry"),
        detail: errorDetail(currentError),
      });
      if (currentManual) {
        await showUpdateInfo("updates.downloadFailed", {
          detail: errorDetail(currentError),
        });
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
        await showUpdateInfo("updates.unsupportedPlatform");
      }
      return "unsupported";
    }
    clearPendingMacUpdateError();
    if (manual) {
      await notifyUpdateStatus(showUpdateStatus, {
        state: "checking",
        message: text("updates.checking"),
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
          message: text("updates.checkFailed"),
          detail: errorDetail(error),
        });
        await showUpdateInfo("updates.checkFailed", {
          detail: errorDetail(error),
        });
      }
      return "error";
    }

    const identityError = updateManifestIdentityError(manifest, {
      releaseTrack,
      channel,
      platformKey,
    });
    if (identityError) {
      const messageKey = updateManifestIdentityMessageKey(manifest, {
        releaseTrack,
        channel,
        platformKey,
      });
      const message = text(messageKey);
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
          message,
        });
        await showUpdateInfo(messageKey);
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
      const message = text("updates.manifestVersionInvalid");
      if (manual) {
        await notifyUpdateStatus(showUpdateStatus, { state: "error", manual: true, message });
        await showUpdateInfo("updates.manifestVersionInvalid");
      }
      return "error";
    }

    const handoff = handoffTarget
      ? developmentHandoffReceiptForManifest({ manifest })
      : null;
    if (handoffTarget && !handoff) {
      notifyUpdateTelemetry(recordUpdateState, {
        state: "failed",
        trigger: manual ? "manual" : "automatic",
        from_version: buildInfo?.version,
        error_code: "manifest",
        stage: "check",
      });
      const message = text("updates.manifestInvalid");
      if (manual) {
        await notifyUpdateStatus(showUpdateStatus, {
          state: "error",
          manual: true,
          message,
        });
        await showUpdateInfo("updates.manifestInvalid");
      }
      return "error";
    }

    const versionAvailable = handoffTarget
      ? compareAppVersions(manifest.version, buildInfo?.version) >= 0
      : isAppVersionNewer(manifest.version, buildInfo?.version);
    if (!versionAvailable) {
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
          message: text("updates.current"),
        });
        await showUpdateInfo("updates.current");
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
      const message = text("updates.packageUrlMissing");
      if (manual) {
        await notifyUpdateStatus(showUpdateStatus, { state: "error", manual: true, message });
        await showUpdateInfo("updates.packageUrlMissing");
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
      ...(handoff ? { handoff } : {}),
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
      message: availableUpdateMessage({
        text,
        version: pending.version,
        handoff: Boolean(pending.handoff),
      }),
    });
    if (!pending.handoff) {
      await persistAvailableUpdate(pending.version);
    }
    await clearLegacyUpdatePreferences();

    if (
      pending.handoff
      && sameDevelopmentHandoffReceipt(
        getDevelopmentHandoff(),
        pending.handoff,
      )
    ) {
      return startPendingDownload({
        trigger: "automatic",
        persistIntent: false,
      });
    }
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
    if (persistIntent && pending.handoff) {
      try {
        await saveDevelopmentHandoff(pending.handoff);
      } catch (error) {
        pending.state = "error";
        const message = text("updates.saveChoiceFailedRetry");
        await notifyUpdateStatus(showUpdateStatus, {
          state: "error",
          version: pending.version,
          manual: true,
          message,
          detail: errorDetail(error),
        });
        await showUpdateInfo("updates.saveChoiceFailed", {
          detail: errorDetail(error),
        });
        return "error";
      }
    } else if (persistIntent && pending.version) {
      try {
        await saveUpdatePreferences({ updateRequestedVersion: pending.version });
      } catch (error) {
        pending.state = "error";
        const message = text("updates.saveChoiceFailedRetry");
        await notifyUpdateStatus(showUpdateStatus, {
          state: "error",
          version: pending.version,
          manual: true,
          message,
          detail: errorDetail(error),
        });
        await showUpdateInfo("updates.saveChoiceFailed", {
          detail: errorDetail(error),
        });
        return "error";
      }
    }
    await notifyUpdateStatus(showUpdateStatus, {
      state: "downloading",
      version: pending.version,
      message: text("updates.downloading"),
    });

    if (pending.platform === "darwin") {
      if (pending.handoff) {
        try {
          pending.prepared = await prepareDevelopmentHandoffUpdate({
            manifest: pending.manifest,
            handoff: pending.handoff,
          });
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
            message: text("updates.prepareFailedRetry"),
            detail: errorDetail(error),
          });
          if (trigger === "manual") {
            await showUpdateInfo("updates.prepareFailed", {
              detail: errorDetail(error),
            });
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
          message: text("updates.downloaded"),
        });
        return "downloaded";
      }
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
          message: text("updates.downloadFailedRetry"),
          detail: errorDetail(error),
        });
        if (trigger === "manual") {
          await showUpdateInfo("updates.downloadFailed", {
            detail: errorDetail(error),
          });
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
        message: text("updates.prepareFailedRetry"),
        detail: errorDetail(error),
      });
      if (trigger === "manual") {
        await showUpdateInfo("updates.prepareFailed", {
          detail: errorDetail(error),
        });
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
      message: text("updates.downloaded"),
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
    throw new Error(`Could not parse latest.json: ${error?.message ?? String(error)}`);
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

async function showInfo(dialog, message, {
  buttonLabel = "OK",
  detail = "",
} = {}) {
  if (!dialog?.showMessageBox) {
    return;
  }
  await dialog.showMessageBox({
    type: "info",
    buttons: [buttonLabel],
    message,
    ...(detail ? { detail: String(detail) } : {}),
  });
}

function translatedText(translate) {
  const candidate = typeof translate === "function" ? translate : DEFAULT_UPDATE_TRANSLATE;
  return (key, values = {}) => {
    try {
      const message = candidate(key, values);
      if (typeof message === "string" && message) {
        return message;
      }
    } catch {
      // A caller-provided translator must not break the updater state machine.
    }
    return DEFAULT_UPDATE_TRANSLATE(key, values);
  };
}

function errorDetail(error) {
  return error?.message ?? String(error);
}

function updateManifestIdentityMessageKey(manifest, {
  releaseTrack,
  channel,
  platformKey,
} = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return "updates.manifestInvalid";
  }
  if (manifest.releaseTrack !== releaseTrack) {
    return "updates.manifestTrackMismatch";
  }
  if (manifest.channel !== channel) {
    return "updates.manifestChannelMismatch";
  }
  if (manifest.platform !== platformKey) {
    return "updates.manifestPlatformMismatch";
  }
  return "updates.manifestInvalid";
}

function availableUpdateMessage({ text, version, handoff = false } = {}) {
  return handoff
    ? text("updates.handoffAvailableVersion", { version })
    : text("updates.availableVersion", { version });
}

function sameDevelopmentHandoffTarget(receipt, target) {
  return Boolean(
    receipt
    && target
    && receipt.kind === target.kind
    && receipt.releaseTrack === target.releaseTrack
    && receipt.channel === target.channel
    && receipt.platform === target.platform
  );
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
