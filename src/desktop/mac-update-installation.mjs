import { desktopUpdatesEnabled } from "./development-handoff.mjs";

export const SQUIRREL_DIRECT_CONTENTS_WRITE_KEY =
  "SquirrelMacEnableDirectContentsWrite";

export function configureMacUpdateInstallation({
  platform = process.platform,
  isPackaged = false,
  buildInfo,
  systemPreferences,
  log = console.log,
} = {}) {
  if (
    platform !== "darwin"
    || !isPackaged
    || !desktopUpdatesEnabled({
      buildInfo,
      isPackaged,
      platform,
    })
  ) {
    return { configured: false, reason: "not-official-packaged-mac" };
  }
  if (typeof systemPreferences?.setUserDefault !== "function") {
    throw new Error("macOS update installation requires Electron systemPreferences");
  }

  systemPreferences.setUserDefault(
    SQUIRREL_DIRECT_CONTENTS_WRITE_KEY,
    "boolean",
    true,
  );
  const stored = systemPreferences.getUserDefault?.(
    SQUIRREL_DIRECT_CONTENTS_WRITE_KEY,
    "boolean",
  );
  if (stored !== undefined && stored !== true) {
    throw new Error(
      `Could not enable ${SQUIRREL_DIRECT_CONTENTS_WRITE_KEY} for the current user`,
    );
  }

  log(
    `[Git Leaf updates] Enabled ${SQUIRREL_DIRECT_CONTENTS_WRITE_KEY} for user-owned App updates.`,
  );
  return { configured: true };
}
