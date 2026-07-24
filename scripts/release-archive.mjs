import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  releaseArtifactFileName,
  releaseBuildId,
} from "./release-shared.mjs";

const ARTIFACT_SPECS = [
  {
    kind: "dmg",
    platform: "darwin-universal",
    extension: "dmg",
  },
  {
    kind: "zip",
    platform: "darwin-universal",
    extension: "zip",
  },
  {
    kind: "zip",
    platform: "win32-x64",
    extension: "zip",
  },
];

const METADATA_SPECS = [
  {
    platform: "darwin-universal",
    fileNames: ["latest.json", "releases.json", "sha256sums.txt"],
  },
  {
    platform: "darwin-arm64",
    fileNames: ["latest.json", "releases.json"],
  },
  {
    platform: "win32-x64",
    fileNames: ["latest.json", "sha256sums.txt"],
  },
];

export function releaseArchiveLayout(state, { channel } = {}) {
  assertReleaseArchiveState(state, channel);
  const archiveRelativePath = path.posix.join(
    "dist",
    "releases",
    `v${state.version}`,
  );
  const archiveRoot = path.join(
    state.sourceRoot,
    ...archiveRelativePath.split("/"),
  );
  const metadataRelativeRoot = path.posix.join(
    "updates",
    "git-leaf",
    channel,
  );
  const sourceMetadataRoot = path.join(
    state.worktreePath,
    "dist",
    ...metadataRelativeRoot.split("/"),
  );

  const artifacts = ARTIFACT_SPECS.map((spec) => {
    const fileName = releaseArtifactFileName({
      version: state.version,
      releaseTrack: state.track,
      platformKey: spec.platform,
      extension: spec.extension,
    });
    return {
      ...spec,
      fileName,
      sourcePath: path.join(state.worktreePath, "dist", fileName),
      archiveRelativePath: fileName,
    };
  });
  const metadata = METADATA_SPECS.flatMap(({ platform, fileNames }) => (
    fileNames.map((fileName) => ({
      platform,
      fileName,
      sourcePath: path.join(sourceMetadataRoot, platform, fileName),
      archiveRelativePath: path.posix.join(metadataRelativeRoot, platform, fileName),
    }))
  ));

  return {
    channel,
    archiveRelativePath,
    archiveRoot,
    sourceMetadataRoot,
    artifacts,
    metadata,
  };
}

export function archiveReleaseOutputs(
  state,
  {
    channel,
    now = () => new Date(),
  } = {},
) {
  const layout = releaseArchiveLayout(state, { channel });
  const manifests = readAndValidateManifests(state, layout);
  const expectedArtifacts = validateSourceArtifacts(state, layout, manifests);
  const expectedMetadata = layout.metadata.map((entry) => ({
    ...entry,
    ...fileFingerprint(entry.sourcePath),
  }));
  validateChecksumFiles(layout, expectedArtifacts);

  const archivedAt = now().toISOString();
  if (existsSync(layout.archiveRoot)) {
    validateArchiveContents(layout.archiveRoot, {
      expectedArtifacts,
      expectedMetadata,
    });
    return archiveDescriptor(state, layout, {
      archivedAt,
      expectedArtifacts,
      expectedMetadata,
    });
  }

  const archiveParent = path.dirname(layout.archiveRoot);
  mkdirSync(archiveParent, { recursive: true });
  const temporaryRoot = mkdtempSync(
    path.join(archiveParent, `.v${state.version}.tmp-`),
  );
  try {
    for (const artifact of expectedArtifacts) {
      copyFileSync(
        artifact.sourcePath,
        archivePath(temporaryRoot, artifact.archiveRelativePath),
      );
    }
    for (const metadata of expectedMetadata) {
      const destination = archivePath(temporaryRoot, metadata.archiveRelativePath);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(metadata.sourcePath, destination);
    }
    writeFileSync(
      path.join(temporaryRoot, "SHA256SUMS"),
      releaseChecksumText(expectedArtifacts),
      "utf8",
    );
    validateArchiveContents(temporaryRoot, {
      expectedArtifacts,
      expectedMetadata,
    });
    try {
      renameSync(temporaryRoot, layout.archiveRoot);
    } catch (error) {
      if (!existsSync(layout.archiveRoot)) {
        throw error;
      }
      validateArchiveContents(layout.archiveRoot, {
        expectedArtifacts,
        expectedMetadata,
      });
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }

  return archiveDescriptor(state, layout, {
    archivedAt,
    expectedArtifacts,
    expectedMetadata,
  });
}

function assertReleaseArchiveState(state, channel) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Release archive requires release state");
  }
  if (!path.isAbsolute(String(state.sourceRoot || ""))) {
    throw new Error("Release archive requires an absolute sourceRoot");
  }
  if (!path.isAbsolute(String(state.worktreePath || ""))) {
    throw new Error("Release archive requires an absolute worktreePath");
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(state.version || ""))) {
    throw new Error(`Release archive version is invalid: ${state.version || "missing"}`);
  }
  if (!["public", "internal"].includes(state.track)) {
    throw new Error(`Release archive track is invalid: ${state.track || "missing"}`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(channel || ""))) {
    throw new Error(`Release archive channel is invalid: ${channel || "missing"}`);
  }
  if (!/^[a-f0-9]{40}$/.test(String(state.commit || ""))) {
    throw new Error("Release archive requires the frozen 40-character commit");
  }
  if (!String(state.buildId || "").trim()) {
    throw new Error("Release archive requires the frozen build ID");
  }
}

function readAndValidateManifests(state, layout) {
  const manifests = Object.fromEntries([
    "darwin-universal",
    "darwin-arm64",
    "win32-x64",
  ].map((platform) => {
    const manifestPath = path.join(
      layout.sourceMetadataRoot,
      platform,
      "latest.json",
    );
    const manifest = readJson(manifestPath);
    validateManifestIdentity(manifest, {
      state,
      channel: layout.channel,
      platform,
      manifestPath,
    });
    return [platform, manifest];
  }));

  for (const platform of ["darwin-universal", "darwin-arm64"]) {
    const releasesPath = path.join(
      layout.sourceMetadataRoot,
      platform,
      "releases.json",
    );
    const releases = readJson(releasesPath);
    const matchingRelease = Array.isArray(releases?.releases)
      ? releases.releases.find((entry) => entry?.version === state.version)
      : null;
    if (
      releases?.current !== state.version
      || !matchingRelease
      || !isDeepStrictEqual(matchingRelease, manifests[platform])
    ) {
      throw new Error(
        `Release archive history does not match latest manifest: ${releasesPath}`,
      );
    }
  }

  if (!isDeepStrictEqual(
    manifests["darwin-arm64"].files,
    manifests["darwin-universal"].files,
  )) {
    throw new Error(
      "Release archive darwin-arm64 migration manifest does not reference the universal artifacts",
    );
  }
  return manifests;
}

function validateManifestIdentity(manifest, {
  state,
  channel,
  platform,
  manifestPath,
}) {
  const expectedBuildId = releaseBuildId({
    buildId: state.buildId,
    releaseTrack: state.track,
  });
  if (
    !manifest
    || typeof manifest !== "object"
    || Array.isArray(manifest)
    || manifest.version !== state.version
    || manifest.releaseTrack !== state.track
    || manifest.channel !== channel
    || manifest.platform !== platform
    || manifest.commit !== state.commit.slice(0, 12)
    || manifest.buildId !== expectedBuildId
  ) {
    throw new Error(
      `Release archive manifest identity does not match the frozen release: ${manifestPath}`,
    );
  }

  const zipFile = manifest.files?.zip;
  const artifactPlatform = platform === "darwin-arm64"
    ? "darwin-universal"
    : platform;
  if (
    !zipFile
    || manifest.autoUpdater?.url !== zipFile.url
    || !isHttpsUrlForArtifact(zipFile.url, {
      channel,
      platform: artifactPlatform,
      fileName: zipFile.name,
    })
  ) {
    throw new Error(
      `Release archive auto-updater URL does not match its stable ZIP artifact: ${manifestPath}`,
    );
  }
}

function validateSourceArtifacts(state, layout, manifests) {
  return layout.artifacts.map((artifact) => {
    const manifest = manifests[artifact.platform];
    const manifestFile = manifest?.files?.[artifact.kind];
    if (
      !manifestFile
      || manifestFile.name !== artifact.fileName
      || !/^[a-f0-9]{64}$/.test(String(manifestFile.sha256 || ""))
      || !Number.isSafeInteger(manifestFile.size)
      || manifestFile.size <= 0
      || !isHttpsUrlForArtifact(manifestFile.url, {
        channel: layout.channel,
        platform: artifact.platform,
        fileName: artifact.fileName,
      })
    ) {
      throw new Error(
        `Release archive manifest is missing the expected ${artifact.platform} ${artifact.kind}`,
      );
    }
    const fingerprint = fileFingerprint(artifact.sourcePath);
    if (
      fingerprint.sha256 !== manifestFile.sha256
      || fingerprint.size !== manifestFile.size
    ) {
      throw new Error(
        `Release archive artifact does not match its stable manifest: ${artifact.sourcePath}`,
      );
    }
    return {
      ...artifact,
      url: manifestFile.url,
      ...fingerprint,
    };
  });
}

function validateChecksumFiles(layout, expectedArtifacts) {
  for (const platform of ["darwin-universal", "win32-x64"]) {
    const checksumPath = path.join(
      layout.sourceMetadataRoot,
      platform,
      "sha256sums.txt",
    );
    const checksums = parseChecksumFile(checksumPath);
    const platformArtifacts = expectedArtifacts.filter(
      (artifact) => artifact.platform === platform,
    );
    if (checksums.size !== platformArtifacts.length) {
      throw new Error(
        `Release archive checksum inventory does not match the stable manifest: ${checksumPath}`,
      );
    }
    for (const artifact of platformArtifacts) {
      if (checksums.get(artifact.fileName) !== artifact.sha256) {
        throw new Error(
          `Release archive checksum does not match ${artifact.fileName}: ${checksumPath}`,
        );
      }
    }
  }
}

function validateArchiveContents(archiveRoot, {
  expectedArtifacts,
  expectedMetadata,
}) {
  const expectedRelativePaths = [
    ...expectedArtifacts.map((entry) => entry.archiveRelativePath),
    ...expectedMetadata.map((entry) => entry.archiveRelativePath),
    "SHA256SUMS",
  ].sort();
  const actualRelativePaths = listRelativeFiles(archiveRoot).sort();
  if (!isDeepStrictEqual(actualRelativePaths, expectedRelativePaths)) {
    throw new Error(
      `Release archive contains an unexpected file inventory: ${archiveRoot}`,
    );
  }

  for (const artifact of expectedArtifacts) {
    assertFingerprint(
      archivePath(archiveRoot, artifact.archiveRelativePath),
      artifact,
    );
  }
  for (const metadata of expectedMetadata) {
    assertFingerprint(
      archivePath(archiveRoot, metadata.archiveRelativePath),
      metadata,
    );
  }
  const checksumPath = path.join(archiveRoot, "SHA256SUMS");
  if (readFileSync(checksumPath, "utf8") !== releaseChecksumText(expectedArtifacts)) {
    throw new Error(`Release archive SHA256SUMS does not match: ${checksumPath}`);
  }
}

function archiveDescriptor(state, layout, {
  archivedAt,
  expectedArtifacts,
  expectedMetadata,
}) {
  return {
    path: layout.archiveRelativePath,
    channel: layout.channel,
    archivedAt,
    artifacts: expectedArtifacts.map((artifact) => ({
      kind: artifact.kind,
      platform: artifact.platform,
      path: path.posix.join(layout.archiveRelativePath, artifact.archiveRelativePath),
      sha256: artifact.sha256,
      size: artifact.size,
      url: artifact.url,
    })),
    metadata: expectedMetadata.map((metadata) => ({
      platform: metadata.platform,
      fileName: metadata.fileName,
      path: path.posix.join(layout.archiveRelativePath, metadata.archiveRelativePath),
      sha256: metadata.sha256,
      size: metadata.size,
    })),
    checksumPath: path.posix.join(layout.archiveRelativePath, "SHA256SUMS"),
  };
}

function releaseChecksumText(artifacts) {
  return `${artifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.fileName}`)
    .join("\n")}\n`;
}

function parseChecksumFile(filePath) {
  const checksums = new Map();
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^([a-f0-9]{64})  ([^/\\]+)$/);
    if (!match || checksums.has(match[2])) {
      throw new Error(`Release archive checksum file is invalid: ${filePath}`);
    }
    checksums.set(match[2], match[1]);
  }
  return checksums;
}

function fileFingerprint(filePath) {
  let stats;
  try {
    stats = statSync(filePath);
  } catch (error) {
    throw new Error(`Release archive file is missing: ${filePath}`, { cause: error });
  }
  if (!stats.isFile()) {
    throw new Error(`Release archive path is not a file: ${filePath}`);
  }

  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const file = openSync(filePath, "r");
  try {
    for (;;) {
      const bytesRead = readSync(file, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(file);
  }
  return {
    sha256: hash.digest("hex"),
    size: stats.size,
  };
}

function assertFingerprint(filePath, expected) {
  const actual = fileFingerprint(filePath);
  if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) {
    throw new Error(`Release archive copy does not match its source: ${filePath}`);
  }
}

function listRelativeFiles(rootDir, relativeDir = "") {
  const absoluteDir = archivePath(rootDir, relativeDir);
  const files = [];
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRelativeFiles(rootDir, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Release archive contains an unsupported entry: ${relativePath}`);
    }
  }
  return files;
}

function archivePath(rootDir, relativePath) {
  return path.join(rootDir, ...String(relativePath).split("/").filter(Boolean));
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Release archive JSON is invalid: ${filePath}`, { cause: error });
  }
}

function isHttpsUrlForArtifact(value, {
  channel,
  platform,
  fileName,
}) {
  try {
    const url = new URL(value);
    const pathSegments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
    const expectedSuffix = ["git-leaf", channel, platform, fileName];
    return url.protocol === "https:"
      && url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === ""
      && isDeepStrictEqual(
        pathSegments.slice(-expectedSuffix.length),
        expectedSuffix,
      );
  } catch {
    return false;
  }
}
