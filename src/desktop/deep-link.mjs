import { normalizeGitLeafHandoffId } from "./handoff.mjs";
import {
  GIT_LEAF_SHARE_VERSION,
  gitLeafShareUrl,
  normalizeGitLeafLinkTarget as normalizeDeepLinkTarget,
  normalizeGitRevision,
} from "../server/hosted-links.mjs";

export {
  GIT_LEAF_HTTPS_OPEN_URL,
  GIT_LEAF_HTTPS_SHARE_URL,
  GIT_LEAF_SHARE_TITLE_MAX_LENGTH,
  GIT_LEAF_SHARE_VERSION,
  gitLeafHttpsOpenUrl,
  gitLeafShareUrl,
  normalizeGitLeafWorktreeId,
  normalizeGitRevision,
} from "../server/hosted-links.mjs";

export const GIT_LEAF_PROTOCOL = "git-leaf";
export const GIT_LEAF_OPEN_HOST = "open";
export const GIT_LEAF_OPEN_WORKTREE_HOST = "open-worktree";
export const GIT_LEAF_OPEN_SHARED_HOST = "open-shared";

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
