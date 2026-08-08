import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OFFICIAL_MAC_SHIPIT_JOB_LABEL = "com.mangofuture.gitleaf.ShipIt";

export function macUpdateCachePaths({
  homeDir,
  jobLabel = OFFICIAL_MAC_SHIPIT_JOB_LABEL,
} = {}) {
  const resolvedHome = requiredDirectory(homeDir, "homeDir");
  const safeJobLabel = requiredJobLabel(jobLabel);
  const updateRoot = path.join(
    resolvedHome,
    "Library",
    "Caches",
    safeJobLabel,
  );
  return {
    updateRoot,
    stateFile: path.join(updateRoot, "ShipItState.plist"),
  };
}

export async function pruneObsoleteMacUpdatePackages({
  homeDir,
  jobLabel = OFFICIAL_MAC_SHIPIT_JOB_LABEL,
  readFileFn = readFile,
  readdirFn = readdir,
  removeFn = rm,
} = {}) {
  if (!homeDir) {
    return { preserved: "", removed: [], complete: false };
  }
  const paths = macUpdateCachePaths({ homeDir, jobLabel });
  let preserved = await stagedUpdateDirectory({
    paths,
    readFileFn,
  });
  if (!preserved) {
    return { preserved: "", removed: [], complete: false };
  }

  let entries;
  try {
    entries = await readdirFn(paths.updateRoot, { withFileTypes: true });
  } catch {
    return { preserved, removed: [], complete: false };
  }
  const staleDirectories = entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => entry.name.startsWith("update."))
    .map((entry) => path.join(paths.updateRoot, entry.name));
  const removed = [];
  let complete = true;
  for (const staleDirectory of staleDirectories) {
    const current = await stagedUpdateDirectory({ paths, readFileFn });
    if (!current || staleDirectory === current) {
      preserved = current;
      if (!current) {
        complete = false;
      }
      continue;
    }
    preserved = current;
    try {
      await removeFn(staleDirectory, { recursive: true, force: true });
      removed.push(staleDirectory);
    } catch {
      complete = false;
      // Keep pruning other known cache entries; a later check or download retries.
    }
  }
  return { preserved, removed, complete };
}

async function stagedUpdateDirectory({ paths, readFileFn }) {
  let request;
  try {
    request = JSON.parse(await readFileFn(paths.stateFile, "utf8"));
  } catch {
    return "";
  }
  let updateBundlePath;
  try {
    const updateBundleUrl = new URL(String(request?.updateBundleURL || ""));
    if (updateBundleUrl.protocol !== "file:") {
      return "";
    }
    updateBundlePath = fileURLToPath(updateBundleUrl);
  } catch {
    return "";
  }
  const stagedDirectory = path.resolve(path.dirname(updateBundlePath));
  if (
    path.dirname(stagedDirectory) !== path.resolve(paths.updateRoot)
    || !path.basename(stagedDirectory).startsWith("update.")
  ) {
    return "";
  }
  return stagedDirectory;
}

function requiredDirectory(value, label) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) {
    throw new Error(`${label} is required.`);
  }
  return path.resolve(candidate);
}

function requiredJobLabel(value) {
  const label = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/.test(label)) {
    throw new Error("Invalid macOS ShipIt job label.");
  }
  return label;
}
