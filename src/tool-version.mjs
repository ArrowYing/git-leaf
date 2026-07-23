import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_APP_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_MIN_CHECK_INTERVAL_MS = 30_000;
const RUNTIME_ENTRIES = [
  "package.json",
  "package-lock.json",
  "desktop",
  "src",
  "public",
];

export async function createToolVersionMonitor({
  appRoot = DEFAULT_APP_ROOT,
  now = () => Date.now(),
  minCheckIntervalMs = DEFAULT_MIN_CHECK_INTERVAL_MS,
} = {}) {
  const startup = await toolFingerprint({ appRoot });
  let current = startup;
  let lastCheckedAt = 0;

  return {
    startupFingerprint: startup.fingerprint,
    async checkForUpdate({ force = false } = {}) {
      const currentTime = now();
      if (!force && currentTime - lastCheckedAt < minCheckIntervalMs) {
        return statusPayload(startup, current);
      }
      lastCheckedAt = currentTime;

      const nextStatFingerprint = await toolStatFingerprint({ appRoot });
      if (nextStatFingerprint.fingerprint === current.statFingerprint) {
        return statusPayload(startup, current);
      }

      current = await toolFingerprint({ appRoot });
      return statusPayload(startup, current);
    },
  };
}

export async function toolFingerprint({ appRoot = DEFAULT_APP_ROOT } = {}) {
  const files = await runtimeFiles(appRoot);
  const hash = createHash("sha256");

  for (const file of files) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(await readFile(file.absolutePath));
    hash.update("\0");
  }

  const statHash = await toolStatFingerprint({ appRoot, files });
  return {
    fingerprint: hash.digest("hex"),
    statFingerprint: statHash.fingerprint,
    files: files.map((file) => file.relativePath),
  };
}

async function toolStatFingerprint({ appRoot = DEFAULT_APP_ROOT, files = null } = {}) {
  const runtimeFileList = files ?? (await runtimeFiles(appRoot));
  const hash = createHash("sha256");

  for (const file of runtimeFileList) {
    const fileStat = await stat(file.absolutePath);
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(String(fileStat.size));
    hash.update("\0");
    hash.update(String(fileStat.mtimeMs));
    hash.update("\0");
  }

  return {
    fingerprint: hash.digest("hex"),
  };
}

async function runtimeFiles(appRoot) {
  const files = [];
  for (const entry of RUNTIME_ENTRIES) {
    await collectRuntimeFiles(path.resolve(appRoot, entry), appRoot, files);
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function collectRuntimeFiles(absolutePath, appRoot, files) {
  let fileStat;
  try {
    fileStat = await stat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  if (fileStat.isDirectory()) {
    const entries = await readdir(absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".DS_Store") {
        continue;
      }
      await collectRuntimeFiles(path.join(absolutePath, entry.name), appRoot, files);
    }
    return;
  }

  if (!fileStat.isFile()) {
    return;
  }

  files.push({
    absolutePath,
    relativePath: path.relative(appRoot, absolutePath),
  });
}

function statusPayload(startup, current) {
  return {
    fingerprint: current.fingerprint,
    startupFingerprint: startup.fingerprint,
    stale: current.fingerprint !== startup.fingerprint,
  };
}
