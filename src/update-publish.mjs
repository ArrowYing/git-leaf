import path from "node:path";

import { DEFAULT_UPDATE_BASE_URL, DEFAULT_UPDATE_CHANNEL } from "./app-updates.mjs";

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
  platformKey,
  artifactPlatformKey = platformKey,
  version,
  buildId = "",
  commit = "",
  builtAt = "",
  notes = "",
  artifacts = [],
} = {}) {
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
