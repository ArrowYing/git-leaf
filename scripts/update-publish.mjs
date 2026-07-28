import path from "node:path";

import {
  DEFAULT_UPDATE_BASE_URL,
  DEFAULT_UPDATE_CHANNEL,
} from "../src/desktop/app-updates.mjs";

export function updateMetadataRelativeDir({
  channel = DEFAULT_UPDATE_CHANNEL,
  platformKey,
} = {}) {
  return path.posix.join("git-leaf", String(channel), String(platformKey));
}

export function updateArtifactRemotePath({
  remoteRoot = "/srv/git-leaf/updates",
  channel = DEFAULT_UPDATE_CHANNEL,
  platformKey,
} = {}) {
  return path.posix.join(
    String(remoteRoot).replace(/\/+$/, ""),
    updateMetadataRelativeDir({ channel, platformKey }),
  );
}

export function buildUpdateManifest({
  appName = "Git Leaf",
  baseUrl = DEFAULT_UPDATE_BASE_URL,
  channel = DEFAULT_UPDATE_CHANNEL,
  releaseTrack,
  platformKey,
  artifactPlatformKey = platformKey,
  version,
  buildId = "",
  commit = "",
  builtAt = "",
  notes = "",
  artifacts = [],
} = {}) {
  assertPublishableReleaseTrack(releaseTrack);
  assertUpdateCoordinate("channel", channel);
  assertUpdateCoordinate("platform", platformKey);
  assertUpdateCoordinate("artifact platform", artifactPlatformKey);

  const files = {};
  for (const artifact of artifacts) {
    files[artifact.kind] = {
      name: artifact.fileName,
      url: updateArtifactUrl({
        baseUrl,
        channel,
        platformKey: artifactPlatformKey,
        fileName: artifact.fileName,
      }),
      sha256: artifact.sha256,
      size: artifact.size,
    };
  }

  const zip = files.zip;
  return {
    app: appName,
    releaseTrack,
    channel,
    platform: platformKey,
    version,
    buildId,
    commit,
    builtAt,
    publishedAt: builtAt,
    notes,
    files,
    ...(zip
      ? {
          autoUpdater: {
            url: zip.url,
            name: `${appName} ${version}`,
            notes,
            pub_date: builtAt,
          },
        }
      : {}),
  };
}

export function updateArtifactUrl({
  baseUrl = DEFAULT_UPDATE_BASE_URL,
  channel = DEFAULT_UPDATE_CHANNEL,
  platformKey,
  fileName,
} = {}) {
  return [
    String(baseUrl || DEFAULT_UPDATE_BASE_URL).replace(/\/+$/, ""),
    encodeURIComponent(channel),
    encodeURIComponent(platformKey),
    encodeURIComponent(fileName),
  ].join("/");
}

function assertPublishableReleaseTrack(value) {
  if (!["public", "internal"].includes(value)) {
    throw new Error("Update manifests require an explicit public or internal releaseTrack.");
  }
}

function assertUpdateCoordinate(label, value) {
  if (
    typeof value !== "string"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  ) {
    throw new Error(`Update manifest ${label} is invalid: ${value ?? ""}`);
  }
}
