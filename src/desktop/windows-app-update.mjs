import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import extractZip from "extract-zip";
import { compareAppVersions } from "./app-updates.mjs";

const WINDOWS_UPDATE_WAIT_ARGUMENT = "--openpeek-update-wait-pid=";
const LEGACY_WINDOWS_UPDATE_WAIT_ARGUMENT = "--git-leaf-update-wait-pid=";
const WINDOWS_UPDATE_WAIT_ARGUMENTS = [
  WINDOWS_UPDATE_WAIT_ARGUMENT,
  LEGACY_WINDOWS_UPDATE_WAIT_ARGUMENT,
];
const WINDOWS_EXECUTABLE = "OpenPeek.exe";
const activePreparations = new Map();
const activeCleanups = new Map();

export function windowsUpdateCachePaths({ localAppData, version } = {}) {
  const updateRoot = path.join(localAppData, "OpenPeek", "updates");
  const versionRoot = path.join(updateRoot, safeVersion(version));
  return {
    updateRoot,
    versionRoot,
    archivePartialPath: path.join(versionRoot, "update.zip.partial"),
    archivePath: path.join(versionRoot, "update.zip"),
    extractRoot: path.join(versionRoot, "extracted"),
    readyFile: path.join(versionRoot, "ready.json"),
  };
}

export async function prepareWindowsAppUpdate(options = {}) {
  const artifact = windowsUpdateArtifact(options.manifest);
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  if (!localAppData) {
    throw new Error("Windows update cache is unavailable because LOCALAPPDATA is missing.");
  }
  const paths = windowsUpdateCachePaths({ localAppData, version: artifact.version });
  const activeCleanup = activeCleanups.get(paths.updateRoot);
  if (activeCleanup) {
    return activeCleanup
      .catch(() => {})
      .then(() => prepareWindowsAppUpdate(options));
  }
  const identity = JSON.stringify(artifact);
  const active = activePreparations.get(paths.updateRoot);
  if (active) {
    if (active.identity === identity) {
      return active.promise;
    }
    return active.promise
      .catch(() => {})
      .then(() => prepareWindowsAppUpdate(options));
  }

  let tracked;
  tracked = prepareWindowsAppUpdateOnce({
    ...options,
    artifact,
    localAppData,
    paths,
  }).finally(() => {
    if (activePreparations.get(paths.updateRoot)?.promise === tracked) {
      activePreparations.delete(paths.updateRoot);
    }
  });
  activePreparations.set(paths.updateRoot, { identity, promise: tracked });
  return tracked;
}

async function prepareWindowsAppUpdateOnce({
  artifact,
  paths,
  fetchFn = globalThis.fetch,
  extractArchive = extractZip,
  pathExists = existsSync,
} = {}) {
  const cached = await readPreparedUpdate({ paths, artifact, pathExists });
  if (cached) {
    await pruneWindowsUpdateRoot({
      updateRoot: paths.updateRoot,
      preservedVersionRoot: paths.versionRoot,
    });
    return cached;
  }

  await rm(paths.updateRoot, { recursive: true, force: true });
  await mkdir(paths.versionRoot, { recursive: true });
  try {
    const downloaded = await downloadWindowsUpdateArchive({
      url: artifact.url,
      destination: paths.archivePartialPath,
      fetchFn,
    });
    if (downloaded.sha256 !== artifact.sha256) {
      throw new Error("Windows update SHA-256 verification failed.");
    }
    if (artifact.size > 0 && downloaded.size !== artifact.size) {
      throw new Error("Windows update file size verification failed.");
    }
    await rename(paths.archivePartialPath, paths.archivePath);
    await mkdir(paths.extractRoot, { recursive: true });
    await extractArchive(paths.archivePath, { dir: paths.extractRoot });
    const sourceRoot = await findExtractedWindowsApp(paths.extractRoot, pathExists);
    const executable = path.join(sourceRoot, WINDOWS_EXECUTABLE);
    const sourceDirectory = path.relative(paths.extractRoot, sourceRoot);
    await writeFile(paths.readyFile, `${JSON.stringify({
      version: artifact.version,
      sha256: artifact.sha256,
      sourceDirectory,
    }, null, 2)}\n`, "utf8");
    return preparedUpdate({ artifact, paths, sourceRoot, executable });
  } catch (error) {
    await rm(paths.versionRoot, { recursive: true, force: true });
    throw error;
  }
}

export function windowsPreparedUpdateLaunch({
  prepared,
  currentProcessId = process.pid,
  args = process.argv.slice(1),
  spawnProcess = spawn,
} = {}) {
  if (!prepared?.executable) {
    throw new Error("Prepared Windows update executable is missing.");
  }
  const launchArgs = [
    `${WINDOWS_UPDATE_WAIT_ARGUMENT}${currentProcessId}`,
    ...withoutWindowsUpdateArguments(args),
  ];
  const child = spawnProcess(prepared.executable, launchArgs, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref?.();
  return { status: "launched", executable: prepared.executable };
}

export async function cleanupWindowsUpdateCache({
  localAppData = process.env.LOCALAPPDATA,
  currentVersion = "",
} = {}) {
  if (!localAppData) {
    return false;
  }
  const updateRoot = path.join(localAppData, "OpenPeek", "updates");
  const activeCleanup = activeCleanups.get(updateRoot);
  if (activeCleanup) {
    return activeCleanup;
  }
  const activePreparation = activePreparations.get(updateRoot);
  if (activePreparation) {
    return activePreparation.promise
      .catch(() => {})
      .then(() => cleanupWindowsUpdateCache({ localAppData, currentVersion }));
  }

  let tracked;
  tracked = cleanupWindowsUpdateCacheOnce({
    updateRoot,
    currentVersion,
  }).finally(() => {
    if (activeCleanups.get(updateRoot) === tracked) {
      activeCleanups.delete(updateRoot);
    }
  });
  activeCleanups.set(updateRoot, tracked);
  return tracked;
}

async function cleanupWindowsUpdateCacheOnce({ updateRoot, currentVersion }) {
  try {
    if (!currentVersion) {
      await rm(updateRoot, { recursive: true, force: true });
      return true;
    }
    if (!validSemanticVersion(currentVersion)) {
      return false;
    }
    const entries = await readdir(updateRoot, { withFileTypes: true });
    const preservedName = entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => validSemanticVersion(entry.name))
      .filter((entry) => compareAppVersions(entry.name, currentVersion) > 0)
      .map((entry) => entry.name)
      .sort(compareVersionDirectoryNames)
      .at(-1) || "";
    const removals = entries
      .filter((entry) => entry.name !== preservedName)
      .map((entry) => rm(path.join(updateRoot, entry.name), {
        recursive: true,
        force: true,
      }));
    const results = await Promise.allSettled(removals);
    return results.every((result) => result.status === "fulfilled");
  } catch (error) {
    return error?.code === "ENOENT";
  }
}

async function pruneWindowsUpdateRoot({ updateRoot, preservedVersionRoot }) {
  const resolvedRoot = path.resolve(updateRoot);
  const resolvedPreserved = path.resolve(preservedVersionRoot);
  if (path.dirname(resolvedPreserved) !== resolvedRoot) {
    throw new Error("Invalid Windows update cache path.");
  }
  const entries = await readdir(resolvedRoot, { withFileTypes: true });
  await Promise.all(entries
    .map((entry) => path.join(resolvedRoot, entry.name))
    .filter((entryPath) => entryPath !== resolvedPreserved)
    .map((entryPath) => rm(entryPath, { recursive: true, force: true })));
}

export function windowsUpdateWaitProcessId(args = []) {
  const argument = args.find((value) => WINDOWS_UPDATE_WAIT_ARGUMENTS.some(
    (prefix) => String(value).startsWith(prefix),
  ));
  const prefix = WINDOWS_UPDATE_WAIT_ARGUMENTS.find((candidate) => (
    String(argument || "").startsWith(candidate)
  )) || WINDOWS_UPDATE_WAIT_ARGUMENT;
  const processId = Number.parseInt(String(argument || "").slice(prefix.length), 10);
  return Number.isInteger(processId) && processId > 0 ? processId : null;
}

export function withoutWindowsUpdateArguments(args = []) {
  return args.filter((argument) => !WINDOWS_UPDATE_WAIT_ARGUMENTS.some(
    (prefix) => String(argument).startsWith(prefix),
  ));
}

async function downloadWindowsUpdateArchive({ url, destination, fetchFn }) {
  const response = await fetchFn(url);
  if (!response?.ok) {
    throw new Error(`Windows update download failed: HTTP ${response?.status ?? "unknown"}`);
  }
  if (!response.body) {
    throw new Error("Windows update download returned an empty response.");
  }
  const hash = createHash("sha256");
  let size = 0;
  const digest = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  const readable = typeof response.body.getReader === "function"
    ? Readable.fromWeb(response.body)
    : response.body;
  await pipeline(readable, digest, createWriteStream(destination));
  return { sha256: hash.digest("hex"), size };
}

async function readPreparedUpdate({ paths, artifact, pathExists }) {
  try {
    const ready = JSON.parse(await readFile(paths.readyFile, "utf8"));
    if (ready.version !== artifact.version || ready.sha256 !== artifact.sha256) {
      return null;
    }
    const sourceRoot = safeExtractedSourceRoot(paths.extractRoot, ready.sourceDirectory);
    const executable = path.join(sourceRoot, WINDOWS_EXECUTABLE);
    if (!pathExists(executable)) {
      return null;
    }
    return preparedUpdate({ artifact, paths, sourceRoot, executable });
  } catch {
    return null;
  }
}

async function findExtractedWindowsApp(extractRoot, pathExists) {
  if (pathExists(path.join(extractRoot, WINDOWS_EXECUTABLE))) {
    return extractRoot;
  }
  const entries = await readdir(extractRoot, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(extractRoot, entry.name))
    .filter((candidate) => pathExists(path.join(candidate, WINDOWS_EXECUTABLE)));
  if (candidates.length !== 1) {
    throw new Error("Windows update archive does not contain one complete OpenPeek app directory.");
  }
  return candidates[0];
}

function safeExtractedSourceRoot(extractRoot, sourceDirectory) {
  const resolvedRoot = path.resolve(extractRoot);
  const resolvedSource = path.resolve(extractRoot, String(sourceDirectory || "."));
  if (resolvedSource !== resolvedRoot && !resolvedSource.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Invalid Windows update cache path.");
  }
  return resolvedSource;
}

function windowsUpdateArtifact(manifest) {
  const version = String(manifest?.version || "").trim();
  const file = manifest?.files?.zip;
  const url = String(file?.url || "").trim();
  const sha256 = String(file?.sha256 || "").trim().toLowerCase();
  const size = Number(file?.size || 0);
  if (!version || !url || !/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(size) || size < 0) {
    throw new Error("Windows update manifest is missing a valid ZIP artifact.");
  }
  return { version, url, sha256, size };
}

function preparedUpdate({ artifact, paths, sourceRoot, executable }) {
  return {
    version: artifact.version,
    sha256: artifact.sha256,
    archivePath: paths.archivePath,
    sourceRoot,
    executable,
  };
}

function safeVersion(value) {
  const version = String(value || "").trim();
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) {
    throw new Error("Invalid Windows update version.");
  }
  return version;
}

function validSemanticVersion(value) {
  if (typeof value !== "string" || value.length > 40) return false;
  const match = value.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
  );
  if (!match) return false;
  return !String(match[4] ?? "").split(".").some((identifier) =>
    /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")
  );
}

function compareVersionDirectoryNames(left, right) {
  return compareAppVersions(left, right) || left.localeCompare(right, "en");
}
