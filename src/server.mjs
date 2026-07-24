import { createReadStream, watch } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUILD_INFO } from "./build-info.mjs";
import { extractTitle, renderMarkdown } from "./markdown.mjs";
import { isLocalRequestAddress } from "./network-address.mjs";
import {
  resolveExistingRepoPath,
  resolveNewDocumentPath,
  resolveOpenablePath,
  resolvePreviewPath,
  resolveRawAssetPath,
} from "./paths.mjs";
import {
  canEditRepository,
  createRepository,
  currentHead,
  currentBranchOrFallback,
  githubBlobRoot,
} from "./repositories.mjs";
import {
  ensureWorktreeBranch,
  listGitWorktrees,
  worktreeDisplayPath,
} from "./git-worktrees.mjs";
import { buildFileTree } from "./tree.mjs";
import {
  frontmatterDocumentProfile,
  frontmatterFacetsPayload,
  frontmatterFilterProfile,
} from "./frontmatter-facets.mjs";
import {
  gitStatusPayload,
  runGitCommand,
  syncSelectedFiles,
} from "./git-sync.mjs";
import { createGitLeafShareLink } from "./git-leaf-open-link.mjs";
import { publishGitLeafShareLink } from "./git-share-publish.mjs";
import { sourceLinesFromMarkdown } from "../public/line-selection.js";

const APP_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_ROOT = path.join(APP_ROOT, "public");
const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const CONTENT_TYPES = new Map([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".css", "text/css; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".gif", "image/gif"],
  [".htm", "text/html; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".yaml", "text/yaml; charset=utf-8"],
  [".yml", "text/yaml; charset=utf-8"],
]);
const IMAGE_ASSET_EXTENSIONS = new Map([
  ["image/avif", ".avif"],
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

export function createPreviewServer({
  repoRoot,
  initialFile,
  toolVersionMonitor = null,
  restartSelf = null,
  gitRunner = runGitCommand,
  repository = createRepository({ repoRoot, initialFile }),
  desktopPreferences = null,
  saveDesktopPreferences = null,
  recordTelemetryActions = null,
}) {
  const assetVersion = String(Date.now());
  const serverContext = {
    repoRoot,
    initialFile,
    assetVersion,
    toolVersionMonitor,
    restartSelf,
    gitRunner,
    repository,
    desktopPreferences,
    saveDesktopPreferences,
    recordTelemetryActions,
  };
  const server = http.createServer(async (request, response) => {
    try {
      await handleRequest(request, response, serverContext);
    } catch (error) {
      sendJson(response, error.statusCode ?? 500, {
        error: error instanceof Error ? error.message : "Unknown preview error",
      });
    }
  });
  server.updateDesktopPreferences = (preferences) => {
    serverContext.desktopPreferences = preferences && typeof preferences === "object"
      ? { ...preferences }
      : null;
  };
  return server;
}

async function handleRequest(request, response, context) {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method !== "GET" && request.method !== "POST") {
    sendText(response, 405, "Method Not Allowed");
    return;
  }

  if (requestUrl.pathname === "/") {
    const repo = await requestRepository(requestUrl, context);
    const html = await readFile(path.join(PUBLIC_ROOT, "index.html"), "utf8");
    sendHtml(
      response,
      html
        .replace(
          "__GIT_LEAF_INITIAL_FILE__",
          JSON.stringify(context.initialFile?.relativePath ?? ""),
        )
        .replace(
          "__GIT_LEAF_INITIAL_REPO__",
          JSON.stringify(repo.id),
        )
        .replace(
          "__GIT_LEAF_WORKTREE_ID__",
          JSON.stringify(repo.worktreeId ?? repo.id),
        )
        .replaceAll(
          "__GIT_LEAF_ASSET_VERSION__",
          encodeURIComponent(context.assetVersion),
        )
        .replace(
          "__GIT_LEAF_CAN_EDIT__",
          JSON.stringify(canEditRequest(request, context)),
        )
        .replace(
          "__GIT_LEAF_DESKTOP_PREFERENCES__",
          JSON.stringify(context.desktopPreferences ?? null),
        )
        .replace(
          "__GIT_LEAF_TELEMETRY_ENABLED__",
          JSON.stringify(typeof context.recordTelemetryActions === "function"),
        ),
    );
    return;
  }

  if (requestUrl.pathname === "/api/health") {
    const toolStatus = await toolStatusPayload(context, {
      force: requestUrl.searchParams.get("check") === "1",
    });
    sendJson(response, 200, {
      app: "git-leaf",
      repoRoot: context.repoRoot,
      initialFile: context.initialFile?.relativePath ?? "",
      toolFingerprint: toolStatus.toolFingerprint,
      stale: toolStatus.stale,
      buildInfo: BUILD_INFO,
    });
    return;
  }

  if (
    requestUrl.pathname === "/app.js" ||
    requestUrl.pathname === "/styles.css" ||
    requestUrl.pathname === "/image-preview.js" ||
    requestUrl.pathname === "/line-selection.js" ||
    requestUrl.pathname === "/agent-context.js" ||
    requestUrl.pathname === "/layout.js" ||
    requestUrl.pathname === "/overflow-tooltip.js" ||
    requestUrl.pathname === "/outline.js" ||
    requestUrl.pathname === "/tree-refresh.js" ||
    requestUrl.pathname === "/document-refresh.js" ||
    requestUrl.pathname === "/chart-tooltip.js" ||
    requestUrl.pathname === "/source-sync.js" ||
    requestUrl.pathname === "/source-split.js" ||
    requestUrl.pathname === "/mode-preference.js" ||
    requestUrl.pathname === "/theme-preference.js" ||
    requestUrl.pathname === "/settings-preferences.js" ||
    requestUrl.pathname === "/file-tree-visibility.js" ||
    requestUrl.pathname === "/content-dependencies.js" ||
    requestUrl.pathname === "/document-tabs.js" ||
    requestUrl.pathname === "/document-search.js" ||
    requestUrl.pathname === "/keyboard-shortcuts.js" ||
    requestUrl.pathname === "/help-content.js" ||
    requestUrl.pathname === "/frontmatter-filters.js" ||
    requestUrl.pathname === "/frontmatter-edit.js" ||
    requestUrl.pathname === "/git-sync-ui.js" ||
    requestUrl.pathname === "/update-ui.js" ||
    requestUrl.pathname === "/tree-state.js" ||
    requestUrl.pathname === "/workbench-session.js" ||
    requestUrl.pathname === "/workbench-startup.js" ||
    requestUrl.pathname === "/telemetry.js" ||
    requestUrl.pathname === "/source-editor.bundle.js"
  ) {
    await sendPublicFile(response, requestUrl.pathname.slice(1));
    return;
  }

  if (requestUrl.pathname === "/api/repos") {
    const isLocalRequest = canEditRequest(request, context);
    requireLocalRequest(request, context);
    const requestedRepo = await requestRepository(requestUrl, context);
    const repositories = [{
      ...publicRepository(requestedRepo),
      canEdit: canEditRepository({ repo: requestedRepo, isLocalRequest }),
    }];
    sendJson(response, 200, {
      currentRepo: requestedRepo.id,
      repositories,
      branch: requestedRepo.branch,
      canEdit: canEditRepository({ repo: requestedRepo, isLocalRequest }),
    });
    return;
  }

  if (requestUrl.pathname === "/api/worktrees") {
    requireLocalRequest(request, context);
    const repo = await requestRepository(requestUrl, context);
    const worktrees = await listGitWorktrees(repo.root);
    sendJson(response, 200, {
      repository: repo.name,
      currentWorktreeId: repo.worktreeId,
      canSwitch: context.desktopPreferences !== null,
      worktrees: worktrees.filter((worktree) => worktree.available).map(publicWorktree),
    });
    return;
  }

  if (requestUrl.pathname === "/api/tree") {
    const repo = await localRequestRepository(request, requestUrl, context);
    const tree = await buildFileTree(repo.root);
    const frontmatterProfile = await frontmatterFilterProfile(repo.root);
    sendJson(response, 200, {
      repo: repo.id,
      branch: repo.branch,
      detached: repo.detached,
      canEdit: canEditRepository({ repo, isLocalRequest: canEditRequest(request, context) }),
      frontmatterAllowedKeys: frontmatterProfile.allowedKeys,
      tree,
    });
    return;
  }

  if (requestUrl.pathname === "/api/frontmatter-facets") {
    const repo = await localRequestRepository(request, requestUrl, context);
    sendJson(response, 200, {
      repo: repo.id,
      branch: repo.branch,
      detached: repo.detached,
      canEdit: canEditRepository({ repo, isLocalRequest: canEditRequest(request, context) }),
      ...(await frontmatterFacetsPayload(repo.root)),
    });
    return;
  }

  if (requestUrl.pathname === "/api/git-status") {
    requireLocalRequest(request, context);
    const repo = await requestRepository(requestUrl, context);
    sendJson(response, 200, {
      ...(await gitStatusPayload({ repo, gitRunner: context.gitRunner })),
      canEdit: canEditRepository({ repo, isLocalRequest: canEditRequest(request, context) }),
    });
    return;
  }

  if (requestUrl.pathname === "/api/share-link") {
    requireLocalRequest(request, context);
    const repo = await requestRepository(requestUrl, context);
    const file = documentFileFromRequest(requestUrl, repo);
    try {
      if (request.method === "POST") {
        requireEditableRequest(request, context, repo);
        const payload = await publishGitLeafShareLink({
          repo,
          file,
          gitRunner: context.gitRunner,
        });
        sendJson(response, payload.ok ? 200 : 409, payload);
        return;
      }
      sendJson(response, 200, {
        url: await createGitLeafShareLink({
          repoRoot: repo.root,
          file,
          gitRunner: context.gitRunner,
        }),
      });
    } catch (error) {
      sendJson(response, 409, {
        error: error instanceof Error ? error.message : "无法生成分享链接。",
        code: typeof error?.code === "string" ? error.code : "share_unavailable",
      });
    }
    return;
  }

  if (requestUrl.pathname === "/api/git-sync") {
    let repo = await requestRepository(requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const branchState = await ensureRepositoryWriteBranch(repo, context);
    repo = branchState.repo;
    const body = await readJsonRequest(request);
    const payload = await syncSelectedFiles({
      repo,
      files: body.files,
      note: body.note,
      allChanges: body.allChanges === true,
      gitRunner: context.gitRunner,
    });
    sendJson(response, payload.ok ? 200 : 409, {
      ...payload,
      ...branchStatePayload(branchState),
    });
    return;
  }

  if (requestUrl.pathname === "/api/tool-status") {
    requireLocalRequest(request, context);
    sendJson(
      response,
      200,
      await toolStatusPayload(context, {
        force: requestUrl.searchParams.get("force") === "1",
      }),
    );
    return;
  }

  if (requestUrl.pathname === "/api/preferences") {
    requireLocalRequest(request, context);
    if (request.method === "GET") {
      sendJson(response, 200, {
        available: typeof context.saveDesktopPreferences === "function",
        preferences: context.desktopPreferences ?? {},
      });
      return;
    }
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    if (typeof context.saveDesktopPreferences !== "function") {
      sendJson(response, 503, { available: false, preferences: {} });
      return;
    }
    const preferences = await context.saveDesktopPreferences(await readJsonRequest(request));
    context.desktopPreferences = preferences;
    sendJson(response, 200, {
      available: true,
      preferences,
    });
    return;
  }

  if (requestUrl.pathname === "/api/telemetry") {
    requireLocalRequest(request, context);
    if (request.method !== "POST" || typeof context.recordTelemetryActions !== "function") {
      sendText(response, 404, "Not Found");
      return;
    }
    const body = await readJsonRequest(request);
    if (!exactObjectKeys(body, ["actions"]) || !Array.isArray(body.actions) || body.actions.length < 1 || body.actions.length > 50) {
      sendJson(response, 400, { accepted: 0 });
      return;
    }
    const accepted = await context.recordTelemetryActions(body.actions);
    if (!Number.isInteger(accepted) || accepted !== body.actions.length) {
      sendJson(response, 400, { accepted: 0 });
      return;
    }
    sendJson(response, 202, { accepted });
    return;
  }

  if (requestUrl.pathname === "/api/restart") {
    requireLocalRequest(request, context);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    if (!context.restartSelf) {
      sendJson(response, 503, { restarting: false });
      return;
    }
    await context.restartSelf();
    sendJson(response, 200, { restarting: true });
    return;
  }

  if (requestUrl.pathname === "/api/document") {
    let repo = await localRequestRepository(request, requestUrl, context);
    const file = documentFileFromRequest(requestUrl, repo);
    if (request.method === "POST") {
      requireEditableRequest(request, context, repo);
      let branchState = { repo, created: false };
      sendJson(response, 200, {
        ...(await writeDocumentPayload(repo, file, request, {
          beforeWrite: async () => {
            branchState = await ensureRepositoryWriteBranch(repo, context);
            repo = branchState.repo;
            return repo;
          },
        })),
        ...branchStatePayload(branchState),
      });
      return;
    }
    const isLocalRequest = canEditRequest(request, context);
    sendJson(
      response,
      200,
      await documentPayload(repo, file, {
        includeSource: canEditRepository({ repo, isLocalRequest }),
        canEdit: canEditRepository({ repo, isLocalRequest }),
      }),
    );
    return;
  }

  if (requestUrl.pathname === "/api/create-document") {
    let repo = await localRequestRepository(request, requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const body = await readJsonRequest(request);
    const documentPath = await resolveNewDocumentPath(repo.root, body);
    try {
      await stat(documentPath.absolutePath);
      throw newDocumentConflictError();
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    const branchState = await ensureRepositoryWriteBranch(repo, context);
    repo = branchState.repo;
    const payload = await createDocumentPayload(repo, documentPath);
    sendJson(response, 201, {
      ...payload,
      ...branchStatePayload(branchState),
    });
    return;
  }

  if (requestUrl.pathname === "/api/rename-document") {
    let repo = await localRequestRepository(request, requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const file = documentFileFromRequest(requestUrl, repo);
    let branchState = { repo, created: false };
    sendJson(response, 200, {
      ...(await renameDocumentPayload(repo, file, request, {
        beforeWrite: async () => {
          branchState = await ensureRepositoryWriteBranch(repo, context);
          repo = branchState.repo;
          return repo;
        },
      })),
      ...branchStatePayload(branchState),
    });
    return;
  }

  if (requestUrl.pathname === "/api/link-target") {
    const repo = await localRequestRepository(request, requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "GET") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const file = documentFileFromRequest(requestUrl, repo);
    sendJson(
      response,
      200,
      await linkTargetPayload({
        currentRepo: repo,
        file,
        rawTarget: requestUrl.searchParams.get("target") ?? "",
      }),
    );
    return;
  }

  if (requestUrl.pathname === "/api/link-title") {
    const repo = await requestRepository(requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "GET") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    sendJson(response, 200, await externalLinkTitlePayload(requestUrl.searchParams.get("url") ?? ""));
    return;
  }

  if (requestUrl.pathname === "/api/image-assets") {
    let repo = await localRequestRepository(request, requestUrl, context);
    requireEditableRequest(request, context, repo);
    if (request.method !== "POST") {
      sendText(response, 405, "Method Not Allowed");
      return;
    }
    const file = documentFileFromRequest(requestUrl, repo);
    let branchState = { repo, created: false };
    sendJson(response, 200, {
      ...(await writeImageAssetPayload(repo, file, request, {
        beforeWrite: async () => {
          branchState = await ensureRepositoryWriteBranch(repo, context);
          repo = branchState.repo;
          return repo;
        },
      })),
      ...branchStatePayload(branchState),
    });
    return;
  }

  if (requestUrl.pathname === "/api/watch") {
    const repo = await localRequestRepository(request, requestUrl, context);
    const file = documentFileFromRequest(requestUrl, repo);
    await streamDocumentWatch(request, response, repo, file, context);
    return;
  }

  if (requestUrl.pathname === "/api/document-status") {
    const repo = await localRequestRepository(request, requestUrl, context);
    const file = documentFileFromRequest(requestUrl, repo);
    sendJson(
      response,
      200,
      await documentStatusPayload(repo, file, {
        canEdit: canEditRepository({
          repo,
          isLocalRequest: canEditRequest(request, context),
        }),
      }),
    );
    return;
  }

  if (requestUrl.pathname === "/api/open-source") {
    const repo = await localRequestRepository(request, requestUrl, context);
    requireEditableRequest(request, context, repo);
    const file = documentFileFromRequest(requestUrl, repo);
    const documentPath = await resolveOpenablePath(repo.root, file);
    openSourceFile(documentPath.absolutePath);
    sendJson(response, 200, {
      path: documentPath.relativePath,
      opened: true,
    });
    return;
  }

  if (requestUrl.pathname === "/api/reveal-path") {
    const repo = await localRequestRepository(request, requestUrl, context);
    requireEditableRequest(request, context, repo);
    const targetPath = requestUrl.searchParams.get("path") ?? "";
    const target = await resolveExistingRepoPath(repo.root, targetPath);
    revealPathInFileManager(target.absolutePath, target.fileStat.isDirectory());
    sendJson(response, 200, {
      path: target.relativePath,
      revealed: true,
    });
    return;
  }

  if (requestUrl.pathname === "/raw") {
    const repo = await localRequestRepository(request, requestUrl, context);
    const file = requestUrl.searchParams.get("file");
    if (!file) {
      sendText(response, 400, "Missing file query parameter");
      return;
    }
    const asset = await resolveRawAssetPath(repo.root, file);
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES.get(asset.extension) ?? "application/octet-stream",
    });
    createReadStream(asset.absolutePath).pipe(response);
    return;
  }

  sendText(response, 404, "Not Found");
}

async function toolStatusPayload(context, options = {}) {
  if (!context.toolVersionMonitor) {
    return {
      toolFingerprint: "",
      startupFingerprint: "",
      stale: false,
    };
  }

  const status = await context.toolVersionMonitor.checkForUpdate(options);
  return {
    toolFingerprint: status.fingerprint,
    startupFingerprint: status.startupFingerprint,
    stale: status.stale,
  };
}

function canEditRequest(request, context) {
  return isLocalRequestAddress(request.socket.remoteAddress);
}

function documentFileFromRequest(requestUrl, repo) {
  const file = requestUrl.searchParams.get("file") || repo.defaultFile || "";
  if (file) {
    return file;
  }

  const error = new Error("No document selected.");
  error.statusCode = 400;
  throw error;
}

async function requestRepository(requestUrl, context) {
  const repoId = requestUrl.searchParams.get("repo") || context.repository.id;
  if (repoId !== context.repository.id) {
    const notFound = new Error(`Repository is not available: ${repoId}`);
    notFound.statusCode = 404;
    throw notFound;
  }
  return withRuntimeBranch(context.repository);
}

async function localRequestRepository(request, requestUrl, context) {
  requireLocalRequest(request, context);
  const repo = await requestRepository(requestUrl, context);
  return repo;
}

function publicRepository(repo) {
  return {
    id: repo.id,
    name: repo.name,
    defaultFile: repo.defaultFile,
    branch: repo.branch,
    detached: repo.detached,
    worktreeId: repo.worktreeId,
    worktreeName: repo.worktreeName,
    canEdit: true,
  };
}

function publicWorktree(worktree) {
  return {
    id: worktree.id,
    name: worktree.name,
    primary: worktree.primary,
    root: worktree.root,
    displayRoot: worktreeDisplayPath(worktree.root),
    head: worktree.head,
    branch: worktree.branch,
    detached: worktree.detached,
    current: worktree.current,
    locked: worktree.locked,
    prunable: worktree.prunable,
    available: worktree.available,
  };
}

async function withRuntimeBranch(repo) {
  const branch = await currentBranchOrFallback(repo);
  const head = await currentHead(repo.root).catch(() => repo.head ?? "");
  return {
    ...repo,
    branch,
    detached: !branch,
    head,
    githubBlobRoot: await githubBlobRoot(repo.root, branch || head) ?? repo.githubBlobRoot,
  };
}

async function ensureRepositoryWriteBranch(repo, context) {
  if (repo.branch && !repo.detached) {
    return { repo, created: false };
  }
  const result = await ensureWorktreeBranch(repo.root);
  if (!result.created) {
    return { repo: { ...repo, branch: result.branch, detached: false }, created: false };
  }

  const nextRepo = {
    ...repo,
    branch: result.branch,
    detached: false,
    githubBlobRoot: await githubBlobRoot(repo.root, result.branch) ?? repo.githubBlobRoot,
  };
  context.repository = { ...context.repository, ...nextRepo };
  return { repo: nextRepo, branch: result.branch, created: true };
}

function branchStatePayload(branchState) {
  return {
    branch: branchState.repo.branch,
    branchCreated: branchState.created,
  };
}

function requireEditableRequest(request, context, repo) {
  if (canEditRepository({ repo, isLocalRequest: canEditRequest(request, context) })) {
    requireTrustedLocalBrowserRequest(request);
    return;
  }

  const error = new Error("Editing is only available from the local Git Leaf app.");
  error.statusCode = 403;
  throw error;
}

function requireLocalRequest(request, context) {
  if (canEditRequest(request, context)) {
    requireTrustedLocalBrowserRequest(request);
    return;
  }

  const error = new Error("This Git Leaf action is only available from the local machine.");
  error.statusCode = 403;
  throw error;
}

function requireTrustedLocalBrowserRequest(request) {
  const fetchSite = String(request.headers["sec-fetch-site"] ?? "").toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    const error = new Error("This local session action cannot be requested from another site.");
    error.statusCode = 403;
    throw error;
  }

  const origin = request.headers.origin;
  if (!origin) {
    return;
  }

  let requestOrigin = "";
  try {
    requestOrigin = new URL(origin).origin;
  } catch {
    const error = new Error("Invalid request origin for this local session.");
    error.statusCode = 403;
    throw error;
  }

  if (requestOrigin !== localRequestOrigin(request)) {
    const error = new Error("This local session action cannot be requested from another origin.");
    error.statusCode = 403;
    throw error;
  }
}

function localRequestOrigin(request) {
  return `http://${request.headers.host ?? "127.0.0.1"}`;
}

export async function documentPayload(repo, file, { includeSource = true, canEdit = true } = {}) {
  const documentPath = await resolveOpenablePath(repo.root, file);
  const fileStat = documentPath.fileStat;
  const basePayload = {
    repo: repo.id,
    branch: repo.branch,
    detached: repo.detached,
    worktreeId: repo.worktreeId,
    canEdit: canEdit && documentPath.editable,
    editable: documentPath.editable,
    kind: documentPath.kind,
    extension: documentPath.extension,
    path: documentPath.relativePath,
    title: path.posix.basename(documentPath.relativePath),
    sourceHash: fileFingerprint(fileStat),
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    githubUrl: repo.githubBlobRoot
      ? `${repo.githubBlobRoot}/${encodeURI(documentPath.relativePath)}`
      : null,
  };

  if (documentPath.kind !== "markdown") {
    const payload = {
      ...basePayload,
      title: path.posix.basename(documentPath.relativePath),
      sourceLines: [],
      frontmatterProfile: { enabled: false, fields: [] },
    };
    if (documentPath.text) {
      Object.assign(payload, await textPreviewPayload(documentPath, fileStat));
    }
    if (documentPath.kind === "html" && fileStat.size <= TEXT_PREVIEW_MAX_BYTES) {
      payload.dependencySource = await readFile(documentPath.absolutePath, "utf8");
    }
    return payload;
  }

  const source = await readFile(documentPath.absolutePath, "utf8");
  const html = renderMarkdown(source, {
    currentFile: documentPath.relativePath,
    currentRepo: repo.id,
  });

  const payload = {
    ...basePayload,
    canEdit,
    path: documentPath.relativePath,
    title: extractTitle(source, documentPath.relativePath),
    html,
    sourceHash: hashSource(source),
    sourceLines: sourceLinesFromMarkdown(source),
    mtimeMs: fileStat.mtimeMs,
    frontmatterProfile: await frontmatterDocumentProfile(repo.root, documentPath.relativePath, source),
  };

  if (includeSource) {
    payload.source = source;
    payload.repoRoot = repo.root;
    payload.absolutePath = documentPath.absolutePath;
  }

  return payload;
}

async function documentStatusPayload(repo, file, { canEdit = true } = {}) {
  const documentPath = await resolveOpenablePath(repo.root, file);
  const fileStat = documentPath.fileStat;
  const sourceHash = documentPath.editable
    ? hashSource(await readFile(documentPath.absolutePath, "utf8"))
    : fileFingerprint(fileStat);
  return {
    repo: repo.id,
    branch: repo.branch,
    canEdit: canEdit && documentPath.editable,
    editable: documentPath.editable,
    kind: documentPath.kind,
    path: documentPath.relativePath,
    mtimeMs: fileStat.mtimeMs,
    sourceHash,
  };
}

async function textPreviewPayload(documentPath, fileStat) {
  if (fileStat.size > TEXT_PREVIEW_MAX_BYTES) {
    return {
      text: "",
      textTruncated: true,
      textLimitBytes: TEXT_PREVIEW_MAX_BYTES,
    };
  }

  const rawText = await readFile(documentPath.absolutePath, "utf8");
  if (documentPath.kind !== "json") {
    return {
      text: rawText,
      textTruncated: false,
      textLimitBytes: TEXT_PREVIEW_MAX_BYTES,
    };
  }

  try {
    return {
      text: `${JSON.stringify(JSON.parse(rawText), null, 2)}\n`,
      textTruncated: false,
      textLimitBytes: TEXT_PREVIEW_MAX_BYTES,
    };
  } catch {
    return {
      text: rawText,
      parseError: "JSON 解析失败，已按原始文本显示。",
      textTruncated: false,
      textLimitBytes: TEXT_PREVIEW_MAX_BYTES,
    };
  }
}

async function writeDocumentPayload(repo, file, request, { beforeWrite = async () => repo } = {}) {
  const documentPath = await resolveOpenablePath(repo.root, file);
  if (!documentPath.editable) {
    const error = new Error("Only Markdown and MDX documents can be edited.");
    error.statusCode = 400;
    throw error;
  }
  const body = await readJsonRequest(request);
  if (typeof body.source !== "string") {
    const error = new Error("source must be a string");
    error.statusCode = 400;
    throw error;
  }

  repo = await beforeWrite();
  await writeFile(documentPath.absolutePath, body.source, "utf8");
  const fileStat = await stat(documentPath.absolutePath);
  return {
    path: documentPath.relativePath,
    mtimeMs: fileStat.mtimeMs,
    sourceHash: hashSource(body.source),
  };
}

async function createDocumentPayload(repo, documentPath) {
  try {
    await writeFile(documentPath.absolutePath, `# ${documentPath.title}\n\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw newDocumentConflictError();
    }
    throw error;
  }
  return documentPayload(repo, documentPath.relativePath);
}

function newDocumentConflictError() {
  const conflict = new Error("同名文档已经存在，请换一个名称。");
  conflict.statusCode = 409;
  return conflict;
}

async function renameDocumentPayload(repo, file, request, { beforeWrite = async () => repo } = {}) {
  const documentPath = await resolvePreviewPath(repo.root, file);
  const body = await readJsonRequest(request);
  if (body.extension !== ".mdx") {
    const error = new Error("Only .mdx rename is supported.");
    error.statusCode = 400;
    throw error;
  }

  if (!/\.md$/i.test(documentPath.relativePath)) {
    const error = new Error("Only .md files can be renamed to .mdx.");
    error.statusCode = 400;
    throw error;
  }

  const targetRelativePath = documentPath.relativePath.replace(/\.md$/i, ".mdx");
  const targetAbsolutePath = path.join(repo.root, ...targetRelativePath.split("/"));
  try {
    await stat(targetAbsolutePath);
    const error = new Error(`Target document already exists: ${targetRelativePath}`);
    error.statusCode = 409;
    throw error;
  } catch (error) {
    if (error?.statusCode) {
      throw error;
    }
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  repo = await beforeWrite();
  await rename(documentPath.absolutePath, targetAbsolutePath);
  return documentPayload(repo, targetRelativePath);
}

async function writeImageAssetPayload(repo, file, request, { beforeWrite = async () => repo } = {}) {
  const documentPath = await resolvePreviewPath(repo.root, file);
  const body = await readJsonRequest(request);
  const image = imageBufferFromDataUrl(body.dataUrl);
  const extension = IMAGE_ASSET_EXTENSIONS.get(image.mimeType);
  if (!extension) {
    const error = new Error(`Unsupported image type: ${image.mimeType}`);
    error.statusCode = 400;
    throw error;
  }

  repo = await beforeWrite();
  const assetDir = path.join(path.dirname(documentPath.absolutePath), "_assets");
  await mkdir(assetDir, { recursive: true });
  const filename = imageAssetFilename(documentPath.relativePath, image.buffer, extension);
  const absolutePath = path.join(assetDir, filename);
  await writeFile(absolutePath, image.buffer);

  return {
    path: posixJoin(posixDirname(documentPath.relativePath), "_assets", filename),
    src: `_assets/${filename}`,
    tag: `<img src="_assets/${filename}" alt="" width="760">`,
    mimeType: image.mimeType,
    bytes: image.buffer.byteLength,
  };
}

async function linkTargetPayload({ currentRepo, file, rawTarget }) {
  const currentDocument = await resolvePreviewPath(currentRepo.root, file);
  const gitLeafTarget = gitLeafDocumentUrlTarget(rawTarget);
  if (gitLeafTarget?.repo && gitLeafTarget.repo !== currentRepo.id) {
    const error = new Error(`Repository is not available: ${gitLeafTarget.repo}`);
    error.statusCode = 404;
    throw error;
  }
  const targetRepo = currentRepo;
  const targetDocument = await resolveFirstPreviewPath(
    targetRepo.root,
    gitLeafTarget
      ? [repoRootDocumentInput(gitLeafTarget.file)]
      : documentLinkTargetInputs(currentRepo.root, currentDocument.relativePath, rawTarget),
  );
  const source = await readFile(targetDocument.absolutePath, "utf8");
  const suffix = gitLeafTarget?.suffix ?? "";
  const href = documentLinkHref(currentDocument.relativePath, targetDocument.relativePath, suffix);
  const title = extractTitle(source, targetDocument.relativePath);
  return {
    repo: targetRepo.id,
    path: targetDocument.relativePath,
    title,
    href,
    markdown: `[${escapeMarkdownLinkText(title)}](${href})`,
  };
}

async function resolveFirstPreviewPath(repoRoot, candidates) {
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return await resolvePreviewPath(repoRoot, candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Target document is not available.");
}

function documentLinkTargetInputs(repoRoot, currentRelativePath, rawTarget) {
  const target = String(rawTarget ?? "").trim();
  if (!target) {
    const error = new Error("target is required");
    error.statusCode = 400;
    throw error;
  }

  const [pathPart] = splitTargetSuffix(target);
  const normalized = pathPart.replaceAll("\\", "/");
  if (path.isAbsolute(pathPart)) {
    const relative = path.relative(repoRoot, pathPart);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      return [relative];
    }
    const rootRelativeCandidate = normalized.replace(/^\/+/, "");
    if (rootRelativeCandidate) {
      return [rootRelativeCandidate];
    }
  }

  if (normalized.startsWith("/")) {
    return [normalized.replace(/^\/+/, "")];
  }

  if (normalized.startsWith("./") || normalized.startsWith("../")) {
    return [path.posix.normalize(path.posix.join(path.posix.dirname(currentRelativePath), normalized))];
  }

  return [
    path.posix.normalize(path.posix.join(path.posix.dirname(currentRelativePath), normalized)),
    normalized,
  ];
}

function gitLeafDocumentUrlTarget(rawTarget) {
  try {
    const url = new URL(String(rawTarget ?? "").trim());
    const file = url.searchParams.get("file") ?? "";
    if (!/^https?:$/i.test(url.protocol) || !/\.mdx?$/i.test(file)) {
      return null;
    }

    return {
      repo: url.searchParams.get("repo") ?? "",
      file,
      suffix: url.hash || "",
    };
  } catch {
    return null;
  }
}

function repoRootDocumentInput(rawFile) {
  const file = String(rawFile ?? "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!file) {
    const error = new Error("target file is required");
    error.statusCode = 400;
    throw error;
  }
  return file;
}

function documentLinkHref(currentRelativePath, targetRelativePath, suffix = "") {
  const currentDir = path.posix.dirname(currentRelativePath);
  const relative = path.posix.relative(currentDir, targetRelativePath) || path.posix.basename(targetRelativePath);
  const normalizedRelative = relative.startsWith(".") ? relative : `./${relative}`;
  const parts = normalizedRelative
    .split("/")
    .filter((part) => part && part !== ".");
  const upLevels = parts.filter((part) => part === "..").length;
  const downLevels = parts.length - upLevels;
  const isNearby = upLevels === 0
    ? downLevels <= 2
    : upLevels <= 1 && downLevels <= 2;
  return isNearby
    ? encodeURI(normalizedRelative) + suffix
    : `/${encodeURI(targetRelativePath)}${suffix}`;
}

function splitTargetSuffix(target) {
  const hashIndex = target.indexOf("#");
  const queryIndex = target.indexOf("?");
  const indexes = [hashIndex, queryIndex].filter((index) => index >= 0);
  if (indexes.length === 0) {
    return [target, ""];
  }
  const splitIndex = Math.min(...indexes);
  return [target.slice(0, splitIndex), target.slice(splitIndex)];
}

function escapeMarkdownLinkText(value) {
  return String(value ?? "").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

async function externalLinkTitlePayload(rawUrl) {
  const url = String(rawUrl ?? "").trim();
  if (!/^https?:\/\//i.test(url)) {
    const error = new Error("url must be an http(s) URL");
    error.statusCode = 400;
    throw error;
  }

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(3500),
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.3,*/*;q=0.1",
        "User-Agent": "Git Leaf/0.1 link-title",
      },
    });
    if (!response.ok) {
      return { url, title: "" };
    }
    const text = await responseTextLimited(response, 256_000);
    return {
      url: response.url || url,
      title: titleFromHtml(text),
    };
  } catch {
    return { url, title: "" };
  }
}

async function responseTextLimited(response, limit) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    return (await response.text()).slice(0, limit);
  }

  const chunks = [];
  let size = 0;
  while (size < limit) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    const chunk = value.slice(0, Math.max(0, limit - size));
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  reader.releaseLock();
  return new TextDecoder("utf8").decode(Buffer.concat(chunks));
}

function titleFromHtml(html) {
  const source = String(html ?? "");
  const ogTitle = source.match(/<meta\s+[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i) ??
    source.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:title["'][^>]*>/i);
  const title = ogTitle?.[1] ?? source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  return decodeHtmlEntities(title).replace(/\s+/g, " ").trim().slice(0, 180);
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function streamDocumentWatch(request, response, repo, file, context) {
  const documentPath = await resolveOpenablePath(repo.root, file);
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  response.flushHeaders?.();

  let changeTimer = null;
  let closed = false;
  const sendChange = async () => {
    if (closed) {
      return;
    }
    try {
      const currentRepo = await withRuntimeBranch(repo);
      const payload = await documentStatusPayload(currentRepo, documentPath.relativePath, {
        canEdit: canEditRepository({
          repo: currentRepo,
          isLocalRequest: canEditRequest(request, context),
        }),
      });
      response.write(`event: change\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (error) {
      response.write(
        `event: error\ndata: ${JSON.stringify({
          error: error instanceof Error ? error.message : "Unable to read changed document",
        })}\n\n`,
      );
    }
  };
  const watcher = watch(documentPath.absolutePath, { persistent: false }, () => {
    if (changeTimer) {
      clearTimeout(changeTimer);
    }
    changeTimer = setTimeout(sendChange, 40);
  });

  request.on("close", () => {
    closed = true;
    if (changeTimer) {
      clearTimeout(changeTimer);
    }
    watcher.close();
  });
}

function readJsonRequest(request) {
  if (!isJsonRequest(request)) {
    const error = new Error("JSON request body must use application/json.");
    error.statusCode = 415;
    throw error;
  }

  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function isJsonRequest(request) {
  return String(request.headers["content-type"] ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase() === "application/json";
}

function exactObjectKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const expected = new Set(expectedKeys);
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}

function hashSource(source) {
  return createHash("sha256").update(source).digest("hex");
}

function fileFingerprint(fileStat) {
  return createHash("sha256")
    .update(`${fileStat.size}:${fileStat.mtimeMs}`)
    .digest("hex");
}

function imageBufferFromDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") {
    const error = new Error("dataUrl must be a string");
    error.statusCode = 400;
    throw error;
  }

  const match = dataUrl.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    const error = new Error("Image payload must be a base64 data URL.");
    error.statusCode = 400;
    throw error;
  }

  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], "base64"),
  };
}

function imageAssetFilename(documentRelativePath, buffer, extension) {
  const basename = path.posix.basename(
    documentRelativePath,
    path.posix.extname(documentRelativePath),
  );
  const stem = sanitizeAssetStem(basename) || "image";
  const timestamp = new Date()
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .replace("Z", "");
  const digest = createHash("sha256").update(buffer).digest("hex").slice(0, 8);
  return `${stem}-${timestamp}-${digest}${extension}`;
}

function sanitizeAssetStem(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function posixDirname(value) {
  const dirname = path.posix.dirname(value);
  return dirname === "." ? "" : dirname;
}

function posixJoin(...parts) {
  return parts.filter(Boolean).join("/");
}

function openSourceFile(absolutePath) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", absolutePath] : [absolutePath];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function revealPathInFileManager(absolutePath, isDirectory) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer"
        : "xdg-open";
  const args = process.platform === "darwin"
    ? isDirectory ? [absolutePath] : ["-R", absolutePath]
    : process.platform === "win32"
      ? isDirectory ? [absolutePath] : ["/select,", absolutePath]
      : [isDirectory ? absolutePath : path.dirname(absolutePath)];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function sendPublicFile(response, relativePath) {
  const absolutePath = path.join(PUBLIC_ROOT, relativePath);
  const extension = path.extname(absolutePath);
  const body = await readFile(absolutePath);
  response.writeHead(200, {
    "Content-Type": CONTENT_TYPES.get(extension) ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendHtml(response, body) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(body);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}
