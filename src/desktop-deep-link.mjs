import path from "node:path";
import { normalizeGitLeafHandoffId } from "./desktop-handoff.mjs";

export const GIT_LEAF_PROTOCOL = "git-leaf";
export const GIT_LEAF_OPEN_HOST = "open";
export const GIT_LEAF_OPEN_WORKTREE_HOST = "open-worktree";
export const GIT_LEAF_OPEN_SHARED_HOST = "open-shared";
export const GIT_LEAF_HTTPS_OPEN_URL = "https://gitleaf.mangofuture.com/open";
export const GIT_LEAF_HTTPS_SHARE_URL = "https://gitleaf.mangofuture.com/share";
export const GIT_LEAF_SHARE_VERSION = "1";
export const GIT_LEAF_SHARE_TITLE_MAX_LENGTH = 100;

export function gitLeafDeepLinkUrl({
  repoRoot,
  repository,
  file = "",
  worktree = "",
  handoff = "",
  platform = process.platform,
} = {}) {
  const normalized = normalizeDeepLinkTarget({ repoRoot, repository, file, worktree, platform });
  if (!normalized) {
    throw new Error("Git Leaf deep links require a repository and a safe Markdown document path.");
  }

  const host = normalized.worktree ? GIT_LEAF_OPEN_WORKTREE_HOST : GIT_LEAF_OPEN_HOST;
  const url = new URL(`${GIT_LEAF_PROTOCOL}://${host}`);
  url.searchParams.set("repo", normalized.repoRoot || normalized.repository);
  if (normalized.file) {
    url.searchParams.set("path", normalized.file);
  }
  if (normalized.worktree) {
    url.searchParams.set("worktree", normalized.worktree);
  }
  if (handoff) {
    const normalizedHandoff = normalizeGitLeafHandoffId(handoff);
    if (!normalizedHandoff) {
      throw new Error("Git Leaf handoff ids must be safe one-time identifiers.");
    }
    url.searchParams.set("handoff", normalizedHandoff);
  }
  return url.toString();
}

export function gitLeafHttpsOpenUrl({ repository, file = "", worktree = "" } = {}) {
  const normalized = normalizeDeepLinkTarget({ repository, file, worktree });
  if (!normalized?.repository) {
    throw new Error("Git Leaf HTTPS links require a GitHub repository identity.");
  }

  const url = new URL(GIT_LEAF_HTTPS_OPEN_URL);
  url.searchParams.set("repo", normalized.repository);
  if (normalized.file) {
    url.searchParams.set("path", normalized.file);
  }
  if (normalized.worktree) {
    url.searchParams.set("worktree", normalized.worktree);
  }
  return url.toString();
}

export function gitLeafShareUrl({ repository, file, rev, title = "" } = {}) {
  const target = normalizeDeepLinkTarget({ repository, file });
  const revision = normalizeGitRevision(rev);
  if (!target?.repository || !target.file || !revision) {
    throw new Error("Git Leaf share links require a repository, document, and full revision.");
  }

  const url = new URL(GIT_LEAF_HTTPS_SHARE_URL);
  url.searchParams.set("v", GIT_LEAF_SHARE_VERSION);
  url.searchParams.set("repo", target.repository);
  url.searchParams.set("path", target.file);
  url.searchParams.set("rev", revision);
  const previewTitle = normalizeSharePreviewText(title, GIT_LEAF_SHARE_TITLE_MAX_LENGTH);
  if (previewTitle) {
    url.searchParams.set("title", previewTitle);
  }
  return url.toString();
}

function normalizeSharePreviewText(value, maxLength) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function gitLeafSharedDeepLinkUrl({ repository, file, rev, handoff = "" } = {}) {
  const shareUrl = new URL(gitLeafShareUrl({ repository, file, rev }));
  const url = new URL(`${GIT_LEAF_PROTOCOL}://${GIT_LEAF_OPEN_SHARED_HOST}`);
  for (const key of ["v", "repo", "path", "rev"]) {
    url.searchParams.set(key, shareUrl.searchParams.get(key));
  }
  if (handoff) {
    const normalizedHandoff = normalizeGitLeafHandoffId(handoff);
    if (!normalizedHandoff) {
      throw new Error("Git Leaf handoff ids must be safe one-time identifiers.");
    }
    url.searchParams.set("handoff", normalizedHandoff);
  }
  return url.toString();
}

export function parseGitLeafDeepLink(value, { platform = process.platform } = {}) {
  if (typeof value !== "string" || !value.startsWith(`${GIT_LEAF_PROTOCOL}:`)) {
    return null;
  }

  try {
    const url = new URL(value);
    const isRepositoryOpen = url.hostname === GIT_LEAF_OPEN_HOST;
    const isWorktreeOpen = url.hostname === GIT_LEAF_OPEN_WORKTREE_HOST;
    const isSharedOpen = url.hostname === GIT_LEAF_OPEN_SHARED_HOST;
    if (
      url.protocol !== `${GIT_LEAF_PROTOCOL}:`
      || (!isRepositoryOpen && !isWorktreeOpen && !isSharedOpen)
    ) {
      return null;
    }
    if (isSharedOpen) {
      return parseSharedDeepLink(url);
    }
    const handoffValue = url.searchParams.get("handoff") ?? "";
    const handoff = normalizeGitLeafHandoffId(handoffValue);
    if (handoffValue && !handoff) {
      return null;
    }
    const target = normalizeDeepLinkTarget({
      repoRoot: url.searchParams.get("repo") ?? "",
      repository: url.searchParams.get("repo") ?? "",
      file: url.searchParams.get("path") ?? "",
      worktree: url.searchParams.get("worktree") ?? "",
      platform,
    });
    if (!target) {
      return isRepositoryOpen
        && handoff
        && !url.searchParams.get("repo")
        && !url.searchParams.get("path")
        && !url.searchParams.get("worktree")
        ? { repoRoot: "", file: "", handoff }
        : null;
    }
    if (isWorktreeOpen !== Boolean(target.worktree)) {
      return null;
    }
    return {
      ...target,
      ...(handoff ? { handoff } : {}),
    };
  } catch {
    return null;
  }
}

function parseSharedDeepLink(url) {
  const version = singleSearchParam(url, "v");
  const repository = singleSearchParam(url, "repo");
  const file = singleSearchParam(url, "path");
  const revisionValue = singleSearchParam(url, "rev");
  const handoffValue = singleSearchParam(url, "handoff");
  if ([version, repository, file, revisionValue, handoffValue].includes(null)) {
    return null;
  }
  if (version !== GIT_LEAF_SHARE_VERSION) {
    return null;
  }
  const target = normalizeDeepLinkTarget({ repository, file });
  const rev = normalizeGitRevision(revisionValue);
  const handoff = handoffValue ? normalizeGitLeafHandoffId(handoffValue) : "";
  if (!target?.repository || !target.file || !rev || (handoffValue && !handoff)) {
    return null;
  }
  const allowedKeys = new Set(["v", "repo", "path", "rev", "handoff"]);
  if ([...url.searchParams.keys()].some((key) => !allowedKeys.has(key))) {
    return null;
  }
  return {
    repository: target.repository,
    file: target.file,
    rev,
    share: true,
    ...(handoff ? { handoff } : {}),
  };
}

function singleSearchParam(url, key) {
  const values = url.searchParams.getAll(key);
  return values.length <= 1 ? values[0] ?? "" : null;
}

export function gitLeafDeepLinkFromArgs(args = [], options = {}) {
  for (const arg of args) {
    const parsed = parseGitLeafDeepLink(arg, options);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function normalizeDeepLinkTarget({ repoRoot, repository, file, worktree, platform }) {
  const cleanRepoRoot = typeof repoRoot === "string" ? repoRoot.trim() : "";
  const cleanRepository = normalizeRepositoryIdentity(repository);
  const cleanFile = typeof file === "string" ? file.trim().replaceAll("\\", "/") : "";
  const requestedWorktree = typeof worktree === "string" ? worktree.trim() : "";
  const cleanWorktree = normalizeGitLeafWorktreeId(requestedWorktree);
  const platformPath = platform === "win32" ? path.win32 : path.posix;

  const hasLocalRepository = cleanRepoRoot
    && platformPath.isAbsolute(cleanRepoRoot)
    && !cleanRepoRoot.includes("\0");
  if (!hasLocalRepository && !cleanRepository) {
    return null;
  }
  if ((requestedWorktree && !cleanWorktree) || (hasLocalRepository && cleanWorktree)) {
    return null;
  }
  if (!cleanFile) {
    return hasLocalRepository
      ? { repoRoot: cleanRepoRoot, file: "" }
      : {
          repository: cleanRepository,
          file: "",
          ...(cleanWorktree ? { worktree: cleanWorktree } : {}),
        };
  }
  if (
    path.posix.isAbsolute(cleanFile) ||
    path.win32.isAbsolute(cleanFile) ||
    cleanFile.includes("\0")
  ) {
    return null;
  }

  const normalizedFile = path.posix.normalize(cleanFile);
  if (
    normalizedFile === ".." ||
    normalizedFile.startsWith("../") ||
    !/\.mdx?$/i.test(normalizedFile)
  ) {
    return null;
  }

  return {
    ...(hasLocalRepository
      ? { repoRoot: cleanRepoRoot }
      : { repository: cleanRepository }),
    file: normalizedFile,
    ...(cleanWorktree ? { worktree: cleanWorktree } : {}),
  };
}

export function normalizeGitLeafWorktreeId(value) {
  const cleanValue = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-f0-9]{16}$/.test(cleanValue) ? cleanValue : "";
}

export function normalizeGitRevision(value) {
  const cleanValue = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(cleanValue) ? cleanValue : "";
}

function normalizeRepositoryIdentity(value) {
  const cleanValue = typeof value === "string"
    ? value.trim().replace(/\.git$/i, "").toLowerCase()
    : "";
  return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(cleanValue) ? cleanValue : "";
}
