export function validateMacUpdateRegressionEvidence(evidence, {
  track,
  version,
  commit,
  buildId,
} = {}) {
  if (
    evidence?.schemaVersion !== 1
    || evidence.source !== "git-leaf-macos-update-regression"
    || evidence.status !== "passed"
    || evidence.track !== track
    || evidence.platform !== "darwin-universal"
    || evidence.toVersion !== version
    || evidence.commit !== commit
    || !String(evidence.buildId || "").startsWith(String(buildId || "missing"))
    || evidence.currentUserDirectContentsWriteEnabled !== true
    || evidence.directContentsWrite !== true
    || evidence.appDirectoryInodePreserved !== true
    || evidence.privilegedShipItJobObserved !== false
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
