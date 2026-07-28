import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { markdownLanguage } from "@codemirror/lang-markdown";

import { fileTypeForPath, isMarkdownPath } from "./file-types.mjs";
import { isExternalCommandExit } from "./external-command.mjs";
import { repositoryChangesFromPorcelain, runGitCommand } from "./git-sync.mjs";
import { resolveRelativeRepoLink, toPosixPath } from "./paths.mjs";
import { listRepositoryFiles } from "./tree.mjs";

const GITKEEP_FILENAME = ".gitkeep";

const FILE_OPERATION_MESSAGES = Object.freeze({
  en: Object.freeze({
    pathRequired: "Choose a repository file or directory.",
    pathInvalid: "The path is not a safe repository-relative path.",
    pathOutside: "The path must stay inside the current repository.",
    fileUnavailable: "The file is no longer available: {path}",
    fileRegularOnly: "Only regular files can be renamed or deleted.",
    directoryUnavailable: "The directory is no longer available: {path}",
    directoryOnly: "Choose a directory.",
    directoryNotEmpty: "Only empty folders can be deleted. This folder contains other files or folders.",
    placeholderModified: "The folder placeholder is not empty, so the folder was not deleted.",
    nameRequired: "Enter a name.",
    nameInvalid: "The name contains characters that are not supported by the system.",
    nameReserved: "This name is reserved by the system.",
    nameUnchanged: "The new name is the same as the current name.",
    targetConflict: "An item with this name already exists: {path}",
    folderIgnored: "This folder would be ignored by Git because {path} is ignored. Choose another location or update .gitignore first.",
    stalePreview: "The file or its references changed while the confirmation was open. Review the latest state and try again.",
    deleteNeedsConfirmation: "The current file contents are not recoverable from Git. Confirm the deletion again.",
  }),
  "zh-CN": Object.freeze({
    pathRequired: "请选择仓库中的文件或文件夹。",
    pathInvalid: "路径不是安全的仓库相对路径。",
    pathOutside: "路径必须位于当前仓库内。",
    fileUnavailable: "文件已不存在：{path}",
    fileRegularOnly: "只能重命名或删除普通文件。",
    directoryUnavailable: "文件夹已不存在：{path}",
    directoryOnly: "请选择一个文件夹。",
    directoryNotEmpty: "只能删除空文件夹；此文件夹中仍有其他文件或文件夹。",
    placeholderModified: "文件夹占位文件已有内容，因此没有删除该文件夹。",
    nameRequired: "请输入名称。",
    nameInvalid: "名称包含系统不支持的字符。",
    nameReserved: "该名称为系统保留名称。",
    nameUnchanged: "新名称与当前名称相同。",
    targetConflict: "同名项目已经存在：{path}",
    folderIgnored: "Git 会忽略这个文件夹，因为 {path} 已被忽略。请换一个位置，或先调整 .gitignore。",
    stalePreview: "确认期间文件或引用已经变化。请查看最新状态后重试。",
    deleteNeedsConfirmation: "当前文件内容无法从 Git 恢复，请再次确认删除。",
  }),
});

export async function previewRepositoryDirectoryCreation({
  repoRoot,
  parentPath = "",
  name = "",
  locale = "en",
  gitRunner = runGitCommand,
} = {}) {
  const root = await realpath(repoRoot);
  const parent = await resolveExistingDirectory(root, parentPath, locale);
  const directoryName = normalizeEntryName(name, locale);
  const absolutePath = path.join(parent.absolutePath, directoryName);
  assertInsideRoot(root, absolutePath, locale);
  const relativePath = toPosixPath(path.relative(root, absolutePath));
  await assertPathMissing(absolutePath, relativePath, locale);

  const markerPath = path.posix.join(relativePath, GITKEEP_FILENAME);
  if (await gitPathIsIgnored(root, markerPath, gitRunner)) {
    throw operationError(locale, "folderIgnored", {
      statusCode: 409,
      code: "folder_marker_ignored",
      values: { path: markerPath },
    });
  }

  return {
    path: relativePath,
    markerPath,
    name: directoryName,
  };
}

export async function createRepositoryDirectory({
  repoRoot,
  parentPath = "",
  name = "",
  locale = "en",
  gitRunner = runGitCommand,
  managedPlaceholders = null,
} = {}) {
  const preview = await previewRepositoryDirectoryCreation({
    repoRoot,
    parentPath,
    name,
    locale,
    gitRunner,
  });
  const root = await realpath(repoRoot);
  const absolutePath = path.join(root, ...preview.path.split("/"));
  const markerAbsolutePath = path.join(absolutePath, GITKEEP_FILENAME);

  await mkdir(absolutePath);
  try {
    await writeFile(markerAbsolutePath, "", { encoding: "utf8", flag: "wx" });
  } catch (error) {
    await rmdir(absolutePath).catch(() => {});
    throw error;
  }
  managedPlaceholders?.add(managedPlaceholderKey(root, preview.markerPath));
  return preview;
}

export async function cleanupManagedDirectoryPlaceholder({
  repoRoot,
  createdPath,
  gitRunner = runGitCommand,
  managedPlaceholders = null,
} = {}) {
  if (!(managedPlaceholders instanceof Set)) {
    return false;
  }
  let placeholderKey = "";
  try {
    const directoryPath = path.posix.dirname(normalizeRelativePath(createdPath, {
      allowEmpty: false,
      locale: "en",
    }));
    const markerPath = path.posix.join(directoryPath, GITKEEP_FILENAME);
    const root = await realpath(repoRoot);
    placeholderKey = managedPlaceholderKey(root, markerPath);
    if (!managedPlaceholders.has(placeholderKey)) {
      return false;
    }
    const markerAbsolutePath = path.join(root, ...markerPath.split("/"));
    const markerStat = await lstat(markerAbsolutePath);
    if (!markerStat.isFile() || markerStat.size !== 0) {
      managedPlaceholders.delete(placeholderKey);
      return false;
    }
    const status = await gitRunner(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      gitLiteralPathspec(markerPath),
    ]);
    const [change] = repositoryChangesFromPorcelain(status.stdout);
    if (change?.path !== markerPath || change.rawStatus !== "??") {
      managedPlaceholders.delete(placeholderKey);
      return false;
    }
    await unlink(markerAbsolutePath);
    managedPlaceholders.delete(placeholderKey);
    return true;
  } catch {
    if (placeholderKey) {
      managedPlaceholders.delete(placeholderKey);
    }
    return false;
  }
}

export async function previewRepositoryFileRename(options = {}) {
  return publicRenamePreview(await buildRepositoryFileRenamePreview(options));
}

async function buildRepositoryFileRenamePreview({
  repoRoot,
  filePath,
  name,
  locale = "en",
} = {}) {
  const source = await resolveRegularFile(repoRoot, filePath, locale);
  const targetName = normalizeEntryName(name, locale);
  if (targetName === path.posix.basename(source.relativePath)) {
    throw operationError(locale, "nameUnchanged", {
      code: "file_name_unchanged",
    });
  }

  const targetRelativePath = path.posix.join(
    path.posix.dirname(source.relativePath),
    targetName,
  ).replace(/^\.\//, "");
  const targetAbsolutePath = path.join(source.root, ...targetRelativePath.split("/"));
  await assertRenameTargetAvailable({
    source,
    targetAbsolutePath,
    targetRelativePath,
    locale,
  });

  const contentHash = await hashFile(source.absolutePath);
  const referencePlan = await createReferencePlan({
    repoRoot: source.root,
    targetPath: source.relativePath,
    replacementPath: targetRelativePath,
  });
  const fingerprint = operationFingerprint({
    operation: "rename",
    path: source.relativePath,
    targetPath: targetRelativePath,
    entry: entryFingerprint(source.fileStat),
    contentHash,
    references: referencePlan.files.map(referenceFingerprint),
  });

  return {
    path: source.relativePath,
    targetPath: targetRelativePath,
    name: targetName,
    fingerprint,
    referenceCount: referencePlan.referenceCount,
    referenceFileCount: referencePlan.files.length,
    referenceFiles: referencePlan.files.map((file) => file.path),
    _source: source,
    _referencePlan: referencePlan,
  };
}

export async function renameRepositoryFile({
  repoRoot,
  filePath,
  name,
  fingerprint = "",
  locale = "en",
} = {}) {
  const preview = await buildRepositoryFileRenamePreview({
    repoRoot,
    filePath,
    name,
    locale,
  });
  assertCurrentFingerprint(preview.fingerprint, fingerprint, locale);

  const source = preview._source;
  const targetAbsolutePath = path.join(source.root, ...preview.targetPath.split("/"));
  const writtenReferences = [];
  let renamed = false;
  try {
    await rename(source.absolutePath, targetAbsolutePath);
    renamed = true;
    for (const reference of preview._referencePlan.files) {
      const referenceEntry = await resolveRegularFile(
        source.root,
        reference.path === source.relativePath
          ? preview.targetPath
          : reference.path,
        locale,
      );
      const referenceAbsolutePath = referenceEntry.absolutePath;
      const currentSource = await readFile(referenceAbsolutePath, "utf8");
      if (hashText(currentSource) !== reference.sourceHash) {
        throw operationError(locale, "stalePreview", {
          statusCode: 409,
          code: "file_operation_stale",
        });
      }
      await writeFile(referenceAbsolutePath, reference.rewrittenSource, "utf8");
      writtenReferences.push({ ...reference, absolutePath: referenceAbsolutePath });
    }
  } catch (error) {
    for (const reference of writtenReferences.reverse()) {
      await writeFile(reference.absolutePath, reference.source, "utf8").catch(() => {});
    }
    if (renamed) {
      await rename(targetAbsolutePath, source.absolutePath).catch(() => {});
    }
    throw error;
  }

  return publicRenamePreview(preview);
}

export async function previewRepositoryDelete(options = {}) {
  return publicDeletePreview(await buildRepositoryDeletePreview(options));
}

async function buildRepositoryDeletePreview({
  repoRoot,
  targetPath,
  locale = "en",
  gitRunner = runGitCommand,
} = {}) {
  const entry = await resolveDeletableEntry(repoRoot, targetPath, locale);
  if (entry.kind === "directory") {
    const directory = await inspectDeletableDirectory(entry, locale);
    const fingerprint = operationFingerprint({
      operation: "delete-directory",
      path: entry.relativePath,
      entry: entryFingerprint(entry.fileStat),
      markerHash: directory.markerHash,
    });
    return {
      path: entry.relativePath,
      kind: "directory",
      fingerprint,
      recoverableByGit: true,
      requiresUnrecoverableConfirmation: false,
      referenceCount: 0,
      referenceFileCount: 0,
      referenceFiles: [],
      placeholderOnly: directory.hasPlaceholder,
      _entry: entry,
      _directory: directory,
    };
  }

  const contentHash = await hashFile(entry.absolutePath);
  const recoverability = await fileGitRecoverability({
    root: entry.root,
    relativePath: entry.relativePath,
    gitRunner,
  });
  const referencePlan = await createReferencePlan({
    repoRoot: entry.root,
    targetPath: entry.relativePath,
  });
  const fingerprint = operationFingerprint({
    operation: "delete-file",
    path: entry.relativePath,
    entry: entryFingerprint(entry.fileStat),
    contentHash,
    gitStatus: recoverability.rawStatus,
    tracked: recoverability.tracked,
    references: referencePlan.files.map(referenceFingerprint),
  });
  return {
    path: entry.relativePath,
    kind: "file",
    fingerprint,
    recoverableByGit: recoverability.recoverable,
    requiresUnrecoverableConfirmation: !recoverability.recoverable,
    recoverabilityReason: recoverability.reason,
    referenceCount: referencePlan.referenceCount,
    referenceFileCount: referencePlan.files.length,
    referenceFiles: referencePlan.files.map((file) => file.path),
    _entry: entry,
  };
}

export async function deleteRepositoryPath({
  repoRoot,
  targetPath,
  fingerprint = "",
  confirmUnrecoverable = false,
  locale = "en",
  gitRunner = runGitCommand,
  managedPlaceholders = null,
} = {}) {
  const preview = await buildRepositoryDeletePreview({
    repoRoot,
    targetPath,
    locale,
    gitRunner,
  });
  assertCurrentFingerprint(preview.fingerprint, fingerprint, locale);
  if (preview.requiresUnrecoverableConfirmation && confirmUnrecoverable !== true) {
    throw operationError(locale, "deleteNeedsConfirmation", {
      statusCode: 409,
      code: "file_delete_unrecoverable_confirmation_required",
    });
  }

  if (preview.kind === "file") {
    await unlink(preview._entry.absolutePath);
    managedPlaceholders?.delete(managedPlaceholderKey(
      preview._entry.root,
      preview.path,
    ));
  } else {
    const markerPath = path.join(preview._entry.absolutePath, GITKEEP_FILENAME);
    let markerRemoved = false;
    if (preview._directory.hasPlaceholder) {
      await unlink(markerPath);
      markerRemoved = true;
    }
    try {
      await rmdir(preview._entry.absolutePath);
    } catch (error) {
      if (markerRemoved) {
        await writeFile(markerPath, "", { encoding: "utf8", flag: "wx" }).catch(() => {});
      }
      throw operationError(locale, "directoryNotEmpty", {
        statusCode: 409,
        code: "directory_not_empty",
        cause: error,
      });
    }
    managedPlaceholders?.delete(managedPlaceholderKey(
      preview._entry.root,
      path.posix.join(preview.path, GITKEEP_FILENAME),
    ));
  }

  return publicDeletePreview(preview);
}

export function rewriteMarkdownRepositoryReferences({
  source = "",
  sourcePath,
  targetPath,
  replacementPath = "",
} = {}) {
  const text = String(source);
  const replacements = [];
  const protectedCodeRanges = [];
  const syntaxTree = markdownLanguage.parser.parse(text);
  syntaxTree.iterate({
    enter(node) {
      if (node.name === "CodeBlock" || node.name === "FencedCode" || node.name === "InlineCode") {
        protectedCodeRanges.push({ from: node.from, to: node.to });
      }
      if (node.name === "URL") {
        addReferenceReplacement({
          sourcePath,
          targetPath,
          replacementPath,
          destination: text.slice(node.from, node.to),
          from: node.from,
          to: node.to,
          replacements,
          angleWrapped: true,
        });
        return;
      }
      if (node.name === "HTMLBlock" || node.name === "HTMLTag") {
        collectHtmlReferenceReplacements({
          source: text,
          from: node.from,
          to: node.to,
          sourcePath,
          targetPath,
          replacementPath,
          replacements,
        });
      }
    },
  });
  collectReferenceDefinitionReplacements({
    source: text,
    sourcePath,
    targetPath,
    replacementPath,
    protectedCodeRanges,
    replacements,
  });

  const unique = uniqueNonOverlappingReplacements(replacements);
  let rewrittenSource = text;
  for (const replacement of [...unique].sort((left, right) => right.from - left.from)) {
    rewrittenSource = `${rewrittenSource.slice(0, replacement.from)}${replacement.value}${rewrittenSource.slice(replacement.to)}`;
  }
  return {
    referenceCount: unique.length,
    rewrittenSource,
    replacements: unique,
  };
}

function publicRenamePreview(preview) {
  return {
    path: preview.path,
    targetPath: preview.targetPath,
    name: preview.name,
    fingerprint: preview.fingerprint,
    referenceCount: preview.referenceCount,
    referenceFileCount: preview.referenceFileCount,
    referenceFiles: preview.referenceFiles,
  };
}

function publicDeletePreview(preview) {
  return {
    path: preview.path,
    kind: preview.kind,
    fingerprint: preview.fingerprint,
    recoverableByGit: preview.recoverableByGit,
    requiresUnrecoverableConfirmation: preview.requiresUnrecoverableConfirmation,
    ...(preview.recoverabilityReason
      ? { recoverabilityReason: preview.recoverabilityReason }
      : {}),
    referenceCount: preview.referenceCount,
    referenceFileCount: preview.referenceFileCount,
    referenceFiles: preview.referenceFiles,
    ...(preview.kind === "directory"
      ? { placeholderOnly: preview.placeholderOnly }
      : {}),
  };
}

async function createReferencePlan({ repoRoot, targetPath, replacementPath = "" }) {
  const targetKind = fileTypeForPath(targetPath)?.kind;
  if (targetKind !== "markdown" && targetKind !== "image") {
    return { referenceCount: 0, files: [] };
  }

  const files = [];
  let referenceCount = 0;
  const repositoryFiles = await listRepositoryFiles(repoRoot);
  for (const file of repositoryFiles) {
    if (file.kind !== "markdown" || !isMarkdownPath(file.path)) {
      continue;
    }
    let source;
    try {
      source = await readFile(path.join(repoRoot, ...file.path.split("/")), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    const result = rewriteMarkdownRepositoryReferences({
      source,
      sourcePath: file.path,
      targetPath,
      replacementPath,
    });
    if (result.referenceCount === 0) {
      continue;
    }
    referenceCount += result.referenceCount;
    files.push({
      path: file.path,
      source,
      sourceHash: hashText(source),
      rewrittenSource: result.rewrittenSource,
      replacements: result.replacements,
      referenceCount: result.referenceCount,
    });
  }
  return { referenceCount, files };
}

function collectReferenceDefinitionReplacements({
  source,
  sourcePath,
  targetPath,
  replacementPath,
  protectedCodeRanges,
  replacements,
}) {
  const definitionPattern = /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*(?:<([^>\n]+)>|([^\s\n]+))/gm;
  for (const match of source.matchAll(definitionPattern)) {
    const destination = match[1] ?? match[2] ?? "";
    const destinationOffset = match.index + match[0].indexOf(destination);
    const from = destinationOffset;
    const to = from + destination.length;
    if (protectedCodeRanges.some((range) => from < range.to && to > range.from)) {
      continue;
    }
    addReferenceReplacement({
      sourcePath,
      targetPath,
      replacementPath,
      destination,
      from,
      to,
      replacements,
    });
  }
}

function collectHtmlReferenceReplacements({
  source,
  from,
  to,
  sourcePath,
  targetPath,
  replacementPath,
  replacements,
}) {
  const html = source.slice(from, to);
  const attributePattern = /\b(?:href|src)\s*=\s*(["'])([\s\S]*?)\1/gi;
  for (const match of html.matchAll(attributePattern)) {
    const destination = match[2];
    const destinationOffset = match.index + match[0].indexOf(destination);
    addReferenceReplacement({
      sourcePath,
      targetPath,
      replacementPath,
      destination,
      from: from + destinationOffset,
      to: from + destinationOffset + destination.length,
      replacements,
    });
  }
}

function addReferenceReplacement({
  sourcePath,
  targetPath,
  replacementPath,
  destination,
  from,
  to,
  replacements,
  angleWrapped = false,
}) {
  const parsed = parseReferenceDestination(destination, { angleWrapped });
  if (!parsed || repositoryTargetPath(sourcePath, parsed.value) !== targetPath) {
    return;
  }
  replacements.push({
    from,
    to,
    value: replacementPath
      ? formatReplacementDestination({
          sourcePath,
          replacementPath,
          original: parsed,
        })
      : destination,
  });
}

function parseReferenceDestination(destination, { angleWrapped = false } = {}) {
  const raw = String(destination);
  const wrapped = angleWrapped && raw.startsWith("<") && raw.endsWith(">");
  const value = wrapped ? raw.slice(1, -1) : raw;
  if (!value || value.startsWith("#")) {
    return null;
  }
  const [pathPart, suffix] = splitDestinationSuffix(value);
  if (!pathPart) {
    return null;
  }
  return { raw, value, pathPart, suffix, wrapped };
}

function repositoryTargetPath(sourcePath, destination) {
  try {
    const resolved = resolveRelativeRepoLink(sourcePath, destination);
    if (resolved === destination && (
      /^[a-z][a-z0-9+.-]*:/i.test(destination) ||
      destination.startsWith("//")
    )) {
      return "";
    }
    const [resolvedPath] = splitDestinationSuffix(resolved);
    return decodeURI(resolvedPath).replace(/^\/+/, "");
  } catch {
    return "";
  }
}

function formatReplacementDestination({ sourcePath, replacementPath, original }) {
  const originalPath = original.pathPart;
  let nextPath;
  if (originalPath.startsWith("/")) {
    nextPath = `/${encodeRepositoryLinkPath(replacementPath)}`;
  } else {
    const sourceDirectory = path.posix.dirname(sourcePath);
    const relative = path.posix.relative(sourceDirectory, replacementPath) ||
      path.posix.basename(replacementPath);
    nextPath = encodeRepositoryLinkPath(relative);
    if (originalPath.startsWith("./") && !nextPath.startsWith(".")) {
      nextPath = `./${nextPath}`;
    }
  }
  const value = `${nextPath}${original.suffix}`;
  return original.wrapped ? `<${value}>` : value;
}

function encodeRepositoryLinkPath(value) {
  return encodeURI(value)
    .replaceAll("#", "%23")
    .replaceAll("?", "%3F");
}

function uniqueNonOverlappingReplacements(replacements) {
  const sorted = [...replacements].sort((left, right) => (
    left.from - right.from || left.to - right.to
  ));
  const unique = [];
  for (const replacement of sorted) {
    const previous = unique.at(-1);
    if (
      previous &&
      previous.from === replacement.from &&
      previous.to === replacement.to
    ) {
      continue;
    }
    if (previous && replacement.from < previous.to) {
      continue;
    }
    unique.push(replacement);
  }
  return unique;
}

function splitDestinationSuffix(destination) {
  const hashIndex = destination.indexOf("#");
  const queryIndex = destination.indexOf("?");
  const indexes = [hashIndex, queryIndex].filter((index) => index >= 0);
  if (indexes.length === 0) {
    return [destination, ""];
  }
  const splitIndex = Math.min(...indexes);
  return [destination.slice(0, splitIndex), destination.slice(splitIndex)];
}

async function resolveRegularFile(repoRoot, filePath, locale) {
  const entry = await resolveDeletableEntry(repoRoot, filePath, locale);
  if (entry.kind !== "file") {
    throw operationError(locale, "fileRegularOnly", {
      code: "regular_file_required",
    });
  }
  return entry;
}

async function resolveDeletableEntry(repoRoot, inputPath, locale) {
  const root = await realpath(repoRoot);
  const relativePath = normalizeRelativePath(inputPath, { locale });
  const absolutePath = path.join(root, ...relativePath.split("/"));
  assertInsideRoot(root, absolutePath, locale);
  let entryStat;
  try {
    entryStat = await lstat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw operationError(locale, "fileUnavailable", {
        statusCode: 404,
        code: "file_unavailable",
        values: { path: relativePath },
        cause: error,
      });
    }
    throw error;
  }
  const kind = entryStat.isFile()
    ? "file"
    : entryStat.isDirectory()
      ? "directory"
      : "";
  if (!kind) {
    throw operationError(locale, "fileRegularOnly", {
      code: "regular_file_required",
    });
  }
  const physicalPath = await realpath(absolutePath);
  assertInsideRoot(root, physicalPath, locale);
  if (physicalPath !== absolutePath) {
    throw operationError(locale, "pathInvalid", {
      code: "file_path_symlinked",
    });
  }
  return {
    root,
    absolutePath,
    relativePath,
    fileStat: entryStat,
    kind,
  };
}

async function resolveExistingDirectory(root, inputPath, locale) {
  const relativePath = normalizeRelativePath(inputPath, {
    allowEmpty: true,
    locale,
  });
  const absolutePath = relativePath
    ? path.join(root, ...relativePath.split("/"))
    : root;
  assertInsideRoot(root, absolutePath, locale);
  let directoryStat;
  try {
    directoryStat = await lstat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw operationError(locale, "directoryUnavailable", {
        statusCode: 404,
        code: "directory_unavailable",
        values: { path: relativePath },
        cause: error,
      });
    }
    throw error;
  }
  if (!directoryStat.isDirectory()) {
    throw operationError(locale, "directoryOnly", {
      code: "directory_required",
    });
  }
  const physicalPath = await realpath(absolutePath);
  assertInsideRoot(root, physicalPath, locale);
  if (physicalPath !== absolutePath) {
    throw operationError(locale, "pathInvalid", {
      code: "file_path_symlinked",
    });
  }
  return { root, absolutePath, relativePath, fileStat: directoryStat };
}

async function inspectDeletableDirectory(entry, locale) {
  const entries = await readdir(entry.absolutePath, { withFileTypes: true });
  if (entries.length === 0) {
    return { hasPlaceholder: false, markerHash: "" };
  }
  if (entries.length !== 1 || entries[0].name !== GITKEEP_FILENAME || !entries[0].isFile()) {
    throw operationError(locale, "directoryNotEmpty", {
      statusCode: 409,
      code: "directory_not_empty",
    });
  }
  const markerPath = path.join(entry.absolutePath, GITKEEP_FILENAME);
  const markerStat = await lstat(markerPath);
  if (!markerStat.isFile() || markerStat.size !== 0) {
    throw operationError(locale, "placeholderModified", {
      statusCode: 409,
      code: "directory_placeholder_modified",
    });
  }
  return {
    hasPlaceholder: true,
    markerHash: await hashFile(markerPath),
  };
}

async function assertRenameTargetAvailable({
  source,
  targetAbsolutePath,
  targetRelativePath,
  locale,
}) {
  let targetStat;
  try {
    targetStat = await lstat(targetAbsolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
  const sameEntry = targetStat.dev === source.fileStat.dev &&
    targetStat.ino === source.fileStat.ino;
  const caseOnlyRename = source.relativePath.toLowerCase() ===
    targetRelativePath.toLowerCase();
  if (sameEntry && caseOnlyRename) {
    return;
  }
  throw operationError(locale, "targetConflict", {
    statusCode: 409,
    code: "file_target_conflict",
    values: { path: targetRelativePath },
  });
}

async function assertPathMissing(absolutePath, relativePath, locale) {
  try {
    await lstat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw operationError(locale, "targetConflict", {
    statusCode: 409,
    code: "file_target_conflict",
    values: { path: relativePath },
  });
}

async function gitPathIsIgnored(root, relativePath, gitRunner) {
  try {
    await gitRunner(root, [
      "check-ignore",
      "--no-index",
      "-q",
      "--",
      gitLiteralPathspec(relativePath),
    ]);
    return true;
  } catch (error) {
    if (isExternalCommandExit(error, 1)) {
      return false;
    }
    throw error;
  }
}

async function fileGitRecoverability({ root, relativePath, gitRunner }) {
  try {
    const status = await gitRunner(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      gitLiteralPathspec(relativePath),
    ]);
    const changes = repositoryChangesFromPorcelain(status.stdout);
    const change = changes.find((candidate) => candidate.path === relativePath);
    if (change?.rawStatus === "??") {
      return {
        recoverable: false,
        reason: "untracked",
        tracked: false,
        rawStatus: "??",
      };
    }

    let tracked = true;
    try {
      await gitRunner(root, [
        "ls-files",
        "--error-unmatch",
        "--",
        gitLiteralPathspec(relativePath),
      ]);
    } catch (error) {
      if (isExternalCommandExit(error, 1)) {
        tracked = false;
      } else {
        throw error;
      }
    }
    if (!tracked) {
      return {
        recoverable: false,
        reason: "untracked",
        tracked: false,
        rawStatus: change?.rawStatus ?? "",
      };
    }

    const worktreeStatus = change?.rawStatus?.[1] ?? " ";
    if (worktreeStatus !== " ") {
      return {
        recoverable: false,
        reason: "unstaged",
        tracked: true,
        rawStatus: change?.rawStatus ?? "",
      };
    }
    const indexHash = (await gitRunner(root, [
      "rev-parse",
      "--verify",
      `:${gitLiteralPathspec(relativePath)}`,
    ])).stdout.trim();
    const worktreeHash = (await gitRunner(root, [
      "hash-object",
      `--path=${relativePath}`,
      "--",
      gitLiteralPathspec(relativePath),
    ])).stdout.trim();
    const recoverable = Boolean(indexHash) && indexHash === worktreeHash;
    return {
      recoverable,
      reason: recoverable ? "git" : "unstaged",
      tracked: true,
      rawStatus: change?.rawStatus ?? "",
    };
  } catch {
    return {
      recoverable: false,
      reason: "unknown",
      tracked: false,
      rawStatus: "",
    };
  }
}

function normalizeRelativePath(value, { allowEmpty = false, locale = "en" } = {}) {
  const raw = String(value ?? "").replaceAll("\\", "/");
  if (allowEmpty && (!raw || raw === ".")) {
    return "";
  }
  if (!raw) {
    throw operationError(locale, "pathRequired", {
      code: "file_path_required",
    });
  }
  const parts = raw.split("/");
  if (
    path.posix.isAbsolute(raw) ||
    path.win32.isAbsolute(raw) ||
    parts.some((part) => (
      !part ||
      part === "." ||
      part === ".." ||
      part.toLowerCase() === ".git"
    ))
  ) {
    throw operationError(locale, "pathInvalid", {
      code: "file_path_invalid",
    });
  }
  return raw;
}

function gitLiteralPathspec(relativePath) {
  return `./${relativePath}`;
}

function managedPlaceholderKey(root, markerPath) {
  return `${root}\0${markerPath}`;
}

function normalizeEntryName(value, locale) {
  const name = String(value ?? "").trim();
  if (!name) {
    throw operationError(locale, "nameRequired", {
      code: "file_name_required",
    });
  }
  if (
    /[\u0000-\u001f<>:"/\\|?*]/.test(name) ||
    /[. ]$/.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw operationError(locale, "nameInvalid", {
      code: "file_name_invalid",
    });
  }
  if (
    name.toLowerCase() === ".git" ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)
  ) {
    throw operationError(locale, "nameReserved", {
      code: "file_name_reserved",
    });
  }
  return name;
}

function assertInsideRoot(root, absolutePath, locale) {
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw operationError(locale, "pathOutside", {
      code: "file_path_outside_repository",
    });
  }
}

function assertCurrentFingerprint(current, expected, locale) {
  if (!expected || current !== expected) {
    throw operationError(locale, "stalePreview", {
      statusCode: 409,
      code: "file_operation_stale",
    });
  }
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function operationFingerprint(value) {
  return hashText(JSON.stringify(value));
}

function referenceFingerprint(reference) {
  return {
    path: reference.path,
    sourceHash: reference.sourceHash,
    replacements: reference.replacements.map(({ from, to, value }) => ({
      from,
      to,
      value,
    })),
  };
}

function entryFingerprint(fileStat) {
  return {
    dev: fileStat.dev,
    ino: fileStat.ino,
    mode: fileStat.mode,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
  };
}

function operationError(locale, key, {
  statusCode = 400,
  code = "file_operation_invalid",
  values = {},
  cause,
} = {}) {
  const messages = FILE_OPERATION_MESSAGES[
    String(locale || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en"
  ];
  const template = messages[key] ?? FILE_OPERATION_MESSAGES.en[key] ?? key;
  const message = template.replace(/\{([a-zA-Z]+)\}/g, (_match, name) => (
    values[name] == null ? "" : String(values[name])
  ));
  const error = new Error(message, cause ? { cause } : undefined);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
