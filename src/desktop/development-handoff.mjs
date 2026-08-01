import {
  isOfficialDistribution,
  releaseTrackForBuildInfo,
} from "../build-info.mjs";
import { isAppVersionNewer } from "./app-updates.mjs";

export const DEVELOPMENT_HANDOFF_KIND = "dev-to-internal";
export const DEVELOPMENT_HANDOFF_RELEASE_TRACK = "internal";
export const DEVELOPMENT_HANDOFF_CHANNEL = "internal-stable";
export const DEVELOPMENT_HANDOFF_PLATFORM = "darwin-universal";

const SEMANTIC_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const BUILD_ID = /^[0-9A-Za-z._-]{1,256}$/;
const COMMIT = /^[0-9a-f]{7,64}$/i;

export function developmentHandoffTarget({
  buildInfo,
  isPackaged = false,
  platform = process.platform,
} = {}) {
  if (
    !isPackaged
    || platform !== "darwin"
    || buildInfo?.dev !== true
    || buildInfo?.distribution !== "source"
    || buildInfo?.releaseTrack !== "source"
  ) {
    return null;
  }
  return {
    kind: DEVELOPMENT_HANDOFF_KIND,
    releaseTrack: DEVELOPMENT_HANDOFF_RELEASE_TRACK,
    channel: DEVELOPMENT_HANDOFF_CHANNEL,
    platform: DEVELOPMENT_HANDOFF_PLATFORM,
  };
}

export function desktopUpdatesEnabled(options = {}) {
  return isOfficialDistribution(options.buildInfo)
    || Boolean(developmentHandoffTarget(options));
}

export function developmentHandoffVersionAvailable({
  currentVersion,
  targetVersion,
} = {}) {
  return isAppVersionNewer(targetVersion, currentVersion);
}

export function developmentHandoffReceiptForManifest({ manifest } = {}) {
  return normalizeDevelopmentHandoffReceipt({
    kind: DEVELOPMENT_HANDOFF_KIND,
    version: manifest?.version,
    buildId: manifest?.buildId,
    commit: manifest?.commit,
    releaseTrack: manifest?.releaseTrack,
    channel: manifest?.channel,
    platform: manifest?.platform,
  });
}

export function normalizeDevelopmentHandoffReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const receipt = {
    kind: identityString(value.kind),
    version: identityString(value.version),
    buildId: identityString(value.buildId),
    commit: identityString(value.commit),
    releaseTrack: identityString(value.releaseTrack),
    channel: identityString(value.channel),
    platform: identityString(value.platform),
  };
  if (
    receipt.kind !== DEVELOPMENT_HANDOFF_KIND
    || receipt.releaseTrack !== DEVELOPMENT_HANDOFF_RELEASE_TRACK
    || receipt.channel !== DEVELOPMENT_HANDOFF_CHANNEL
    || receipt.platform !== DEVELOPMENT_HANDOFF_PLATFORM
    || !SEMANTIC_VERSION.test(receipt.version)
    || !BUILD_ID.test(receipt.buildId)
    || !COMMIT.test(receipt.commit)
  ) {
    return null;
  }
  return receipt;
}

export function sameDevelopmentHandoffReceipt(left, right) {
  const normalizedLeft = normalizeDevelopmentHandoffReceipt(left);
  const normalizedRight = normalizeDevelopmentHandoffReceipt(right);
  return Boolean(
    normalizedLeft
    && normalizedRight
    && [
      "kind",
      "version",
      "buildId",
      "commit",
      "releaseTrack",
      "channel",
      "platform",
    ].every((field) => normalizedLeft[field] === normalizedRight[field])
  );
}

export function developmentHandoffReceiptMatchesBuild({
  receipt,
  buildInfo,
  platformKey,
} = {}) {
  const normalized = normalizeDevelopmentHandoffReceipt(receipt);
  return Boolean(
    normalized
    && isOfficialDistribution(buildInfo)
    && releaseTrackForBuildInfo(buildInfo) === DEVELOPMENT_HANDOFF_RELEASE_TRACK
    && platformKey === normalized.platform
    && identityString(buildInfo?.version) === normalized.version
    && identityString(buildInfo?.buildId) === normalized.buildId
    && identityString(buildInfo?.commit) === normalized.commit
  );
}

function identityString(value) {
  return typeof value === "string" && value.trim().length <= 256
    ? value.trim()
    : "";
}
