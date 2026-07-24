import assert from "node:assert/strict";
import test from "node:test";

import { publishGitLeafShareLink } from "../src/git-share-publish.mjs";

const REPO = {
  id: "docs-repo",
  root: "/repos/docs-repo",
  branch: "main",
};

test("share publication can retry a failed push after the document was committed", async () => {
  let dirty = true;
  let published = false;
  let syncCalls = 0;
  let publishCalls = 0;
  const createShareLink = async () => {
    if (published) {
      return "https://gitleaf.mangofuture.com/share?v=1";
    }
    const error = new Error(dirty
      ? "当前文档还有未提交修改。"
      : "当前文档已经提交，但尚未发布到 origin/main。");
    error.code = dirty ? "document_not_committed" : "document_not_published";
    throw error;
  };
  const options = {
    repo: REPO,
    file: "docs/report.md",
    createShareLink,
    readStatus: async () => ({
      changes: dirty
        ? [{ path: "docs/report.md", status: "modified", rawStatus: " M" }]
        : [],
    }),
    syncChanges: async () => {
      syncCalls += 1;
      dirty = false;
      return {
        ok: false,
        step: "push",
        error: "远端暂时不可用。",
        agentPrompt: "retry push",
      };
    },
    publishBranch: async () => {
      publishCalls += 1;
      published = true;
      return {
        ok: true,
        publishedHead: "a".repeat(40),
      };
    },
  };

  const failed = await publishGitLeafShareLink(options);
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "push");
  assert.equal(failed.retryable, true);
  assert.equal(failed.agentPrompt, "retry push");

  const retried = await publishGitLeafShareLink(options);
  assert.equal(retried.ok, true);
  assert.equal(retried.published, true);
  assert.equal(retried.url, "https://gitleaf.mangofuture.com/share?v=1");
  assert.equal(syncCalls, 1);
  assert.equal(publishCalls, 1);
});
