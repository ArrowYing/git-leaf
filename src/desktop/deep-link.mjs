import { normalizeOpenPeekHandoffId } from "./handoff.mjs";
import {
  OPENPEEK_LEGACY_PROTOCOL,
  OPENPEEK_PROTOCOL,
  OPENPEEK_SUPPORTED_PROTOCOLS,
  isOpenPeekProtocol,
} from "../product-identity.mjs";
import {
  OPENPEEK_SHARE_VERSION,
  openPeekShareUrl,
  normalizeOpenPeekLinkTarget as normalizeDeepLinkTarget,
  normalizeGitRevision,
} from "../server/hosted-links.mjs";

export {
  OPENPEEK_HTTPS_OPEN_URL,
  OPENPEEK_HTTPS_SHARE_URL,
  OPENPEEK_SHARE_TITLE_MAX_LENGTH,
  OPENPEEK_SHARE_VERSION,
  openPeekHttpsOpenUrl,
  openPeekShareUrl,
  normalizeOpenPeekWorktreeId,
  normalizeGitRevision,
} from "../server/hosted-links.mjs";

export {
  OPENPEEK_LEGACY_PROTOCOL,
  OPENPEEK_PROTOCOL,
  OPENPEEK_SUPPORTED_PROTOCOLS,
};
export const OPENPEEK_OPEN_HOST = "open";
export const OPENPEEK_OPEN_WORKTREE_HOST = "open-worktree";
export const OPENPEEK_OPEN_SHARED_HOST = "open-shared";

export function openPeekDeepLinkUrl({
  repoRoot,
  repository,
  file = "",
  worktree = "",
  handoff = "",
  platform = process.platform,
} = {}) {
  const normalized = normalizeDeepLinkTarget({ repoRoot, repository, file, worktree, platform });
  if (!normalized) {
    throw new Error("OpenPeek deep links require a repository and a safe Markdown document path.");
  }

  const host = normalized.worktree ? OPENPEEK_OPEN_WORKTREE_HOST : OPENPEEK_OPEN_HOST;
  const url = new URL(`${OPENPEEK_PROTOCOL}://${host}`);
  url.searchParams.set("repo", normalized.repoRoot || normalized.repository);
  if (normalized.file) {
    url.searchParams.set("path", normalized.file);
  }
  if (normalized.worktree) {
    url.searchParams.set("worktree", normalized.worktree);
  }
  if (handoff) {
    const normalizedHandoff = normalizeOpenPeekHandoffId(handoff);
    if (!normalizedHandoff) {
      throw new Error("OpenPeek handoff ids must be safe one-time identifiers.");
    }
    url.searchParams.set("handoff", normalizedHandoff);
  }
  return url.toString();
}

export function openPeekSharedDeepLinkUrl({ repository, file, rev, handoff = "" } = {}) {
  const shareUrl = new URL(openPeekShareUrl({ repository, file, rev }));
  const url = new URL(`${OPENPEEK_PROTOCOL}://${OPENPEEK_OPEN_SHARED_HOST}`);
  for (const key of ["v", "repo", "path", "rev"]) {
    url.searchParams.set(key, shareUrl.searchParams.get(key));
  }
  if (handoff) {
    const normalizedHandoff = normalizeOpenPeekHandoffId(handoff);
    if (!normalizedHandoff) {
      throw new Error("OpenPeek handoff ids must be safe one-time identifiers.");
    }
    url.searchParams.set("handoff", normalizedHandoff);
  }
  return url.toString();
}

export function parseOpenPeekDeepLink(value, { platform = process.platform } = {}) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    const isRepositoryOpen = url.hostname === OPENPEEK_OPEN_HOST;
    const isWorktreeOpen = url.hostname === OPENPEEK_OPEN_WORKTREE_HOST;
    const isSharedOpen = url.hostname === OPENPEEK_OPEN_SHARED_HOST;
    if (
      !isOpenPeekProtocol(url.protocol)
      || (!isRepositoryOpen && !isWorktreeOpen && !isSharedOpen)
    ) {
      return null;
    }
    if (isSharedOpen) {
      return parseSharedDeepLink(url);
    }
    const handoffValue = url.searchParams.get("handoff") ?? "";
    const handoff = normalizeOpenPeekHandoffId(handoffValue);
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
  if (version !== OPENPEEK_SHARE_VERSION) {
    return null;
  }
  const target = normalizeDeepLinkTarget({ repository, file });
  const rev = normalizeGitRevision(revisionValue);
  const handoff = handoffValue ? normalizeOpenPeekHandoffId(handoffValue) : "";
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

export function openPeekDeepLinkFromArgs(args = [], options = {}) {
  for (const arg of args) {
    const parsed = parseOpenPeekDeepLink(arg, options);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}
