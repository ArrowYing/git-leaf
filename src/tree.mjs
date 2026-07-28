import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import { fileTypeForPath, isMarkdownPath } from "./file-types.mjs";
import { externalCommandState, runExternalCommand } from "./external-command.mjs";
import { toPosixPath } from "./paths.mjs";

export async function buildMarkdownTree(repoRoot) {
  const files = await listRepositoryFiles(repoRoot);
  return treeFromFiles(files.filter((file) => isMarkdownPath(file.path)));
}

export async function buildFileTree(repoRoot) {
  return treeFromFiles(await listRepositoryFiles(repoRoot));
}

export async function listRepositoryFiles(repoRoot) {
  try {
    return await listGitWorktreeFiles(repoRoot);
  } catch (error) {
    if (externalCommandState(error) === "invalid_context") {
      return listFilesystemFiles(repoRoot);
    }
    throw error;
  }
}

async function listGitWorktreeFiles(repoRoot) {
  const [trackedResult, untrackedResult, stagedResult] = await Promise.all([
    runGit(repoRoot, ["ls-files", "--cached", "-z"]),
    runGit(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
    runGit(repoRoot, ["ls-files", "--stage", "-z"]),
  ]);
  const stagedModes = stageModesFromOutput(stagedResult.stdout);
  const paths = new Set([
    ...nulPaths(trackedResult.stdout),
    ...nulPaths(untrackedResult.stdout),
  ]);
  const files = [];
  for (const relativePath of paths) {
    const absolutePath = path.join(repoRoot, ...relativePath.split("/"));
    let fileStat;
    try {
      fileStat = await lstat(absolutePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    const mode = stagedModes.get(relativePath) ?? "";
    if (mode === "160000") {
      files.push(fileRecord(relativePath, "submodule"));
      continue;
    }
    if (fileStat.isSymbolicLink()) {
      files.push(fileRecord(relativePath, "symlink"));
      continue;
    }
    if (fileStat.isFile()) {
      files.push(fileRecord(relativePath, "", { size: fileStat.size }));
    }
  }
  return files;
}

async function listFilesystemFiles(repoRoot) {
  const files = [];
  await scanFilesystemDirectory(repoRoot, repoRoot, files);
  return files;
}

async function scanFilesystemDirectory(repoRoot, directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    const relativePath = toPosixPath(path.relative(repoRoot, absolutePath));
    if (entry.isDirectory()) {
      await scanFilesystemDirectory(repoRoot, absolutePath, files);
    } else if (entry.isSymbolicLink()) {
      files.push(fileRecord(relativePath, "symlink"));
    } else if (entry.isFile()) {
      const options = entry.name === ".gitkeep"
        ? { size: (await lstat(absolutePath)).size }
        : {};
      files.push(fileRecord(relativePath, "", options));
    }
  }
}

function fileRecord(relativePath, forcedKind = "", { size = null } = {}) {
  const normalizedPath = toPosixPath(relativePath);
  const placeholder = !forcedKind &&
    size === 0 &&
    path.posix.basename(normalizedPath) === ".gitkeep";
  const fileType = fileTypeForPath(normalizedPath);
  return {
    path: normalizedPath,
    kind: forcedKind || (placeholder ? "placeholder" : fileType?.kind) || "unknown",
    ...(placeholder ? { placeholder: true } : {}),
  };
}

function treeFromFiles(files) {
  const root = directoryBuilder("");
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }
    let directory = root;
    for (const name of parts.slice(0, -1)) {
      if (!directory.directories.has(name)) {
        directory.directories.set(name, directoryBuilder(name));
      }
      directory = directory.directories.get(name);
    }
    const name = parts.at(-1);
    directory.files.set(name, {
      type: "file",
      name,
      path: file.path,
      kind: file.kind,
      ...(file.placeholder ? { placeholder: true } : {}),
    });
  }
  return finalizeDirectory(root);
}

function directoryBuilder(name) {
  return { name, directories: new Map(), files: new Map() };
}

function finalizeDirectory(directory) {
  return sortNodes([
    ...directory.files.values(),
    ...[...directory.directories.values()].map((child) => {
      const children = finalizeDirectory(child);
      const placeholderOnly = children.length === 1 &&
        children[0].type === "file" &&
        children[0].placeholder === true;
      return {
        type: "directory",
        name: child.name,
        children,
        ...(placeholderOnly ? { placeholderOnly: true } : {}),
      };
    }),
  ]);
}

function sortNodes(nodes) {
  return nodes.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "file" ? -1 : 1;
    }
    if (left.type === "directory") {
      const leftUnderscoreRank = left.name.startsWith("_") ? 1 : 0;
      const rightUnderscoreRank = right.name.startsWith("_") ? 1 : 0;
      if (leftUnderscoreRank !== rightUnderscoreRank) {
        return leftUnderscoreRank - rightUnderscoreRank;
      }
    }
    return left.name.localeCompare(right.name, "zh-Hans-CN");
  });
}

function stageModesFromOutput(output) {
  const modes = new Map();
  for (const record of String(output ?? "").split("\0").filter(Boolean)) {
    const match = record.match(/^(\d+)\s+[0-9a-f]+\s+\d+\t([\s\S]+)$/);
    if (match) {
      modes.set(toPosixPath(match[2]), match[1]);
    }
  }
  return modes;
}

function nulPaths(output) {
  return String(output ?? "")
    .split("\0")
    .map((value) => toPosixPath(value))
    .filter(Boolean);
}

function runGit(cwd, args) {
  return runExternalCommand("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
}
