const LEGACY_INTERNAL_STABLE_BRIDGE_VERSION = "1.11.3";

function hasValidBaselineIdentity(evidence, track) {
  const expectedStableChannel = track === "public"
    ? "stable"
    : "internal-stable";
  if (
    evidence.fromTrack === track
    && evidence.fromChannel === expectedStableChannel
  ) {
    return true;
  }
  return track === "public"
    && evidence.fromTrack === "internal"
    && evidence.fromChannel === "stable"
    && evidence.fromVersion === LEGACY_INTERNAL_STABLE_BRIDGE_VERSION
    && evidence.installMode === "contents-bridge";
}

export function validateMacUpdateRegressionEvidence(evidence, {
  track,
  version,
  commit,
  buildId,
} = {}) {
  const canonicalIdentityMatches = (
    evidence.candidateAppIdentity?.bundleName === "OpenGlance.app"
    && evidence.candidateAppIdentity?.productName === "OpenGlance"
    && evidence.candidateAppIdentity?.executable === "OpenGlance"
    && evidence.installedAppIdentity?.bundleName
      === evidence.baselineAppIdentity?.bundleName
    && evidence.installedAppIdentity?.productName === "OpenGlance"
    && evidence.installedAppIdentity?.executable === "OpenGlance"
  );
  const inAppIsolationMatches = evidence.installMode !== "in-app-update" || (
    evidence.updateActionReady === true
    && evidence.shipItLaunchAfterInstallation === false
    && evidence.installTrigger === "isolated-process-termination"
    && evidence.candidateRelaunchedWithIsolatedProfile === true
  );
  if (
    evidence?.schemaVersion !== 5
    || evidence.source !== "openglance-macos-update-regression"
    || evidence.status !== "passed"
    || evidence.track !== track
    || evidence.platform !== "darwin-universal"
    || !hasValidBaselineIdentity(evidence, track)
    || evidence.toVersion !== version
    || evidence.commit !== commit
    || !String(evidence.buildId || "").startsWith(String(buildId || "missing"))
    || !["contents-bridge", "in-app-update"].includes(evidence.installMode)
    || !inAppIsolationMatches
    || evidence.directContentsWrite !== true
    || evidence.appDirectoryInodePreserved !== true
    || evidence.profileStatePreserved !== true
    || !canonicalIdentityMatches
    || evidence.installParentWritable !== false
    || evidence.privilegedShipItJobObserved !== false
    || evidence.squirrelPolicy?.policy !== "nonprivileged-only"
    || evidence.squirrelPolicy?.privilegedHelperAllowed !== false
    || evidence.cleanup?.processesTerminated !== true
    || evidence.cleanup?.userShipItJobAbsent !== true
    || evidence.cleanup?.systemShipItJobAbsent !== true
    || evidence.cleanup?.isolatedCacheRemovedWithTemporaryRoot !== true
    || evidence.cleanup?.realProfileUnchanged !== true
    || evidence.cleanup?.realShipItCacheUnchanged !== true
    || evidence.realProfileBefore?.sha256 !== evidence.realProfileAfter?.sha256
    || evidence.realShipItCacheBefore?.sha256
      !== evidence.realShipItCacheAfter?.sha256
  ) {
    throw new Error(
      "macOS update regression evidence does not match the frozen release and mandatory cleanup contract",
    );
  }
  return evidence;
}
