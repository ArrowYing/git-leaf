import { releaseTrackForBuildInfo } from "../build-info.mjs";
import { normalizeDevelopmentHandoffReceipt } from "./development-handoff.mjs";

export const DEFAULT_UPDATE_BASE_URL = "https://updates.mangofuture.com/git-leaf";
export const DEFAULT_UPDATE_CHANNEL = "stable";
export const INTERNAL_UPDATE_CHANNEL = "internal-stable";

export function compareAppVersions(left, right) {
  const leftParts = versionCore(left).split(".").map(numericPart);
  const rightParts = versionCore(right).split(".").map(numericPart);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }
  return 0;
}

export function isAppVersionNewer(candidateVersion, currentVersion) {
  return compareAppVersions(candidateVersion, currentVersion) > 0;
}

export function appUpdatePlatformKey({
  platform = process.platform,
  arch = process.arch,
} = {}) {
  if (platform === "darwin") {
    return "darwin-universal";
  }
  return `${platform}-${arch}`;
}

export function updateChannelForReleaseTrack(releaseTrack) {
  if (releaseTrack === "public") {
    return DEFAULT_UPDATE_CHANNEL;
  }
  if (releaseTrack === "internal") {
    return INTERNAL_UPDATE_CHANNEL;
  }
  return "";
}

export function updateChannelForBuildInfo(buildInfo) {
  return updateChannelForReleaseTrack(releaseTrackForBuildInfo(buildInfo));
}

export function updateManifestIdentityError(manifest, {
  releaseTrack,
  channel,
  platformKey,
} = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return "更新清单格式无效。";
  }
  if (manifest.releaseTrack !== releaseTrack) {
    return "更新清单的发行轨道与当前构建不匹配。";
  }
  if (manifest.channel !== channel) {
    return "更新清单的更新通道与当前构建不匹配。";
  }
  if (manifest.platform !== platformKey) {
    return "更新清单的平台与当前构建不匹配。";
  }
  return "";
}

export function updateManifestUrl({
  baseUrl = DEFAULT_UPDATE_BASE_URL,
  channel = DEFAULT_UPDATE_CHANNEL,
  platformKey = appUpdatePlatformKey(),
} = {}) {
  return [
    normalizeBaseUrl(baseUrl),
    encodeURIComponent(channel),
    encodeURIComponent(platformKey),
    "latest.json",
  ].join("/");
}

export function macAutoUpdaterFeedUrl({
  baseUrl = DEFAULT_UPDATE_BASE_URL,
  channel = DEFAULT_UPDATE_CHANNEL,
  platformKey = appUpdatePlatformKey({ platform: "darwin" }),
  currentVersion,
  handoff,
} = {}) {
  const feedUrl = [
    normalizeBaseUrl(baseUrl),
    encodeURIComponent(channel),
    encodeURIComponent(platformKey),
    "releases",
    encodeURIComponent(versionCore(currentVersion)),
  ].join("/");
  const receipt = normalizeDevelopmentHandoffReceipt(handoff);
  if (
    !receipt
    || receipt.channel !== channel
    || receipt.platform !== platformKey
  ) {
    return feedUrl;
  }
  const query = new URLSearchParams({
    transition: receipt.kind,
    targetVersion: receipt.version,
    targetBuildId: receipt.buildId,
    targetCommit: receipt.commit,
  });
  return `${feedUrl}?${query}`;
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_UPDATE_BASE_URL).replace(/\/+$/, "");
}

function versionCore(value) {
  return String(value || "0")
    .trim()
    .replace(/^v/i, "")
    .split("+")[0]
    .split("-")[0] || "0";
}

function numericPart(value) {
  const parsed = Number.parseInt(String(value || "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
