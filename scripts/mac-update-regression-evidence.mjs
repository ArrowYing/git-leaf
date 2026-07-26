export function validateMacUpdateRegressionEvidence(evidence, {
  track,
  version,
  commit,
  buildId,
} = {}) {
  if (
    evidence?.schemaVersion !== 2
    || evidence.source !== "git-leaf-macos-update-regression"
    || evidence.status !== "passed"
    || evidence.track !== track
    || evidence.platform !== "darwin-universal"
    || evidence.toVersion !== version
    || evidence.commit !== commit
    || !String(evidence.buildId || "").startsWith(String(buildId || "missing"))
    || !["contents-bridge", "in-app-update"].includes(evidence.installMode)
    || evidence.directContentsWrite !== true
    || evidence.appDirectoryInodePreserved !== true
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
