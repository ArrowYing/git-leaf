import {
  gitStatusPayload,
  publishCurrentBranch,
  syncSelectedFiles,
} from "./git-sync.mjs";
import { createGitLeafShareLink } from "./git-leaf-open-link.mjs";

const PUBLISHABLE_SHARE_ERRORS = new Set([
  "document_not_committed",
  "document_not_published",
]);

export async function publishGitLeafShareLink({
  repo,
  file,
  gitRunner,
  createShareLink = createGitLeafShareLink,
  readStatus = gitStatusPayload,
  syncChanges = syncSelectedFiles,
  publishBranch = publishCurrentBranch,
} = {}) {
  const shareLinkOptions = {
    repoRoot: repo.root,
    file,
    gitRunner,
  };

  try {
    return {
      ok: true,
      url: await createShareLink(shareLinkOptions),
      published: false,
    };
  } catch (error) {
    if (!PUBLISHABLE_SHARE_ERRORS.has(error?.code)) {
      throw error;
    }
  }

  let publication;
  try {
    const status = await readStatus({ repo, gitRunner });
    const changes = Array.isArray(status.changes) ? status.changes : [];
    publication = changes.length > 0
      ? await syncChanges({
        repo,
        allChanges: true,
        gitRunner,
      })
      : await publishBranch({
        repo,
        files: [file],
        gitRunner,
      });
  } catch (error) {
    return {
      ok: false,
      code: "share_publish_failed",
      step: typeof error?.step === "string" ? error.step : "publish",
      error: error instanceof Error ? error.message : "无法完成远端发布。",
      retryable: true,
    };
  }

  if (!publication.ok) {
    return {
      ...publication,
      code: "share_publish_failed",
      retryable: true,
    };
  }

  try {
    return {
      ...publication,
      ok: true,
      url: await createShareLink(shareLinkOptions),
      published: true,
    };
  } catch (error) {
    return {
      ...publication,
      ok: false,
      code: typeof error?.code === "string" ? error.code : "share_publish_failed",
      step: error?.code === "document_not_committed"
        ? "workspace changed"
        : "verify publication",
      error: error instanceof Error ? error.message : "远端发布后仍无法生成分享链接。",
      retryable: true,
    };
  }
}
