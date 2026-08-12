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
  const productRenameRelease = String(evidence?.fromVersion || "").startsWith("1.")
    && String(version || "").startsWith("2.0.");
  const productRenameIdentityMatches = !productRenameRelease || (
    evidence.baselineAppIdentity?.bundleName === "Git Leaf.app"
    && evidence.baselineAppIdentity?.productName === "Git Leaf"
    && evidence.baselineAppIdentity?.executable === "Git Leaf"
    && evidence.candidateAppIdentity?.bundleName === "OpenPeek.app"
    && evidence.candidateAppIdentity?.productName === "OpenPeek"
    && evidence.candidateAppIdentity?.executable === "OpenPeek"
    && evidence.installedAppIdentity?.bundleName === "Git Leaf.app"
    && evidence.installedAppIdentity?.productName === "OpenPeek"
    && evidence.installedAppIdentity?.executable === "OpenPeek"
  );
  if (
    evidence?.schemaVersion !== 4
    || evidence.source !== "openpeek-macos-update-regression"
    || evidence.status !== "passed"
    || evidence.track !== track
    || evidence.platform !== "darwin-universal"
    || !hasValidBaselineIdentity(evidence, track)
    || evidence.toVersion !== version
    || evidence.commit !== commit
    || !String(evidence.buildId || "").startsWith(String(buildId || "missing"))
    || !["contents-bridge", "in-app-update"].includes(evidence.installMode)
    || evidence.directContentsWrite !== true
    || evidence.appDirectoryInodePreserved !== true
    || evidence.profileStatePreserved !== true
    || !productRenameIdentityMatches
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
