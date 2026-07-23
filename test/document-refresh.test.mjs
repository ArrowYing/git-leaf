import assert from "node:assert/strict";
import test from "node:test";

import { shouldReplaceDocumentHtml } from "../public/document-refresh.js";

test("shouldReplaceDocumentHtml only replaces the rendered document when content changes", () => {
  assert.equal(
    shouldReplaceDocumentHtml({ source: "# Same\n", path: "a.md" }, { source: "# Same\n", path: "a.md" }),
    false,
  );
  assert.equal(
    shouldReplaceDocumentHtml({ source: "# Old\n", path: "a.md" }, { source: "# New\n", path: "a.md" }),
    true,
  );
  assert.equal(
    shouldReplaceDocumentHtml({ source: "# Same\n", path: "a.md" }, { source: "# Same\n", path: "b.md" }),
    true,
  );
});

test("shouldReplaceDocumentHtml replaces stale preview html after source sync writes", () => {
  assert.equal(
    shouldReplaceDocumentHtml(
      { path: "a.md", source: "# New\n", html: "<h1>Old</h1>" },
      { path: "a.md", source: "# New\n", html: "<h1>New</h1>" },
    ),
    true,
  );
});
