import assert from "node:assert/strict";
import test from "node:test";

import { referencedLocalPaths, resolveLocalReference } from "../public/content-dependencies.js";

test("content dependencies resolve markdown, HTML, and CSS references relative to the document", () => {
  assert.deepEqual(
    [...referencedLocalPaths([
      "![Cover](../assets/cover.png)",
      "[Prototype](./prototype.html)",
      '<script src="./prototype.js"></script>',
      "background: url('../assets/paper texture.webp')",
    ].join("\n"), "docs/brief/index.md")],
    [
      "docs/assets/cover.png",
      "docs/brief/prototype.html",
      "docs/brief/prototype.js",
      "docs/assets/paper texture.webp",
    ],
  );
});

test("external, data, and in-document references are ignored", () => {
  assert.deepEqual(
    [...referencedLocalPaths("[Web](https://example.com) ![Inline](data:image/png,x) [Section](#intro)")],
    [],
  );
  assert.equal(resolveLocalReference("../../../../AGENTS.md", "docs/deep/page.md"), "AGENTS.md");
});
