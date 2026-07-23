import { gitLeafHttpsOpenUrl, gitLeafShareUrl } from "./desktop-deep-link.mjs";
import { isExternalCommandExit, runExternalCommand } from "./external-command.mjs";
import { listGitWorktrees } from "./git-worktrees.mjs";
import { extractTitle } from "./markdown.mjs";
import { githubRepositoryIdentityFromRemote } from "./repositories.mjs";

export async function createGitLeafOpenLink({
  repoRoot,
  file,
  readOrigin = defaultReadOrigin,
  listWorktrees = listGitWorktrees,
} = {}) {
  if (!repoRoot) {
    throw new Error("A Git repository root is required.");
  }

  const repository = githubRepositoryIdentityFromRemote(await readOrigin(repoRoot));
  if (!repository) {
    throw new Error("The repository must have a GitHub origin before creating a shareable link.");
  }

  const worktrees = await listWorktrees(repoRoot);
  const currentWorktree = worktrees.find((worktree) => worktree.current);
  if (!currentWorktree) {
    throw new Error("Could not identify the current Git worktree.");
  }

  return gitLeafHttpsOpenUrl({
    repository,
    file,
    ...(currentWorktree.primary ? {} : { worktree: currentWorktree.id }),
  });
}

export async function createGitLeafShareLink({
  repoRoot,
  file,
  readOrigin,
  listWorktrees: readWorktrees = listGitWorktrees,
  gitRunner = defaultGitRunner,
} = {}) {
  if (!repoRoot) {
    throw shareLinkError("repository_required", "需要先打开一个 Git 仓库。");
  }

  const worktrees = await readWorktrees(repoRoot);
  const currentWorktree = worktrees.find((worktree) => worktree.current);
  if (!currentWorktree?.primary) {
    throw shareLinkError("primary_required", "分享链接只支持主工作区。");
  }
  if (currentWorktree.branch !== "main") {
    throw shareLinkError("main_required", "分享链接只支持主工作区的 main 分支。");
  }

  const origin = readOrigin
    ? await readOrigin(repoRoot)
    : (await gitRunner(repoRoot, ["remote", "get-url", "origin"])).stdout.trim();
  const repository = githubRepositoryIdentityFromRemote(origin);
  if (!repository) {
    throw shareLinkError("github_origin_required", "当前仓库没有可识别的 GitHub origin。");
  }

  const status = await gitRunner(repoRoot, [
    "-c",
    "core.quotePath=false",
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    file,
  ]);
  if (status.stdout.trim()) {
    throw shareLinkError("document_not_committed", "当前文档还有未提交修改，请先同步当前文档。");
  }

  const revisionResult = await gitRunner(repoRoot, ["log", "-1", "--format=%H", "--", file]);
  const rev = revisionResult.stdout.trim().toLowerCase();
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(rev)) {
    throw shareLinkError("document_not_committed", "当前文档还没有提交记录，请先同步当前文档。");
  }

  try {
    await gitRunner(repoRoot, ["merge-base", "--is-ancestor", rev, "refs/remotes/origin/main"]);
  } catch (error) {
    if (isExternalCommandExit(error, 1)) {
      throw shareLinkError("document_not_published", "当前文档已经提交，但尚未发布到 origin/main。");
    }
    throw error;
  }

  let publishedSource = "";
  try {
    publishedSource = (await gitRunner(repoRoot, ["show", `${rev}:${file}`])).stdout;
  } catch {
    // Preview metadata is optional and must not block an otherwise valid share link.
  }
  return gitLeafShareUrl({
    repository,
    file,
    rev,
    title: extractTitle(publishedSource, file),
  });
}

function shareLinkError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function defaultReadOrigin(repoRoot) {
  const { stdout } = await runExternalCommand("git", ["remote", "get-url", "origin"], {
    cwd: repoRoot,
  });
  return stdout.trim();
}

async function defaultGitRunner(cwd, args) {
  return runExternalCommand("git", args, { cwd });
}
