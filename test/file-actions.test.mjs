import assert from "node:assert/strict";
import test from "node:test";

import { githubFileUrl } from "../public/file-actions.js";

test("githubFileUrl targets the selected repository file and encodes every path segment", () => {
  assert.equal(
    githubFileUrl(
      "https://github.com/ExampleOrg/docs-repo/blob/main",
      "guides/中文 #1.md",
    ),
    "https://github.com/ExampleOrg/docs-repo/blob/main/guides/%E4%B8%AD%E6%96%87%20%231.md",
  );
});

test("githubFileUrl rejects absent, non-GitHub, and unsafe targets", () => {
  assert.equal(githubFileUrl("", "README.md"), "");
  assert.equal(githubFileUrl("https://example.com/repo/blob/main", "README.md"), "");
  assert.equal(githubFileUrl("https://github.com/ExampleOrg/docs-repo/blob/main", ""), "");
  assert.equal(githubFileUrl("https://github.com/ExampleOrg/docs-repo/blob/main", "/README.md"), "");
  assert.equal(githubFileUrl("https://github.com/ExampleOrg/docs-repo/blob/main", "../README.md"), "");
});
