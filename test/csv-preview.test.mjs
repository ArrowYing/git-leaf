import assert from "node:assert/strict";
import test from "node:test";

import { csvMarkdownDocumentLink, parseCsvRows } from "../public/csv-preview.js";

test("CSV parsing preserves quoted cells used by the read-only table preview", () => {
  assert.deepEqual(
    parseCsvRows('name,note\nAlice,"one, two"\nBob,"said ""hello"""\n'),
    [
      ["name", "note"],
      ["Alice", "one, two"],
      ["Bob", 'said "hello"'],
    ],
  );
});

test("a full CSV cell Markdown link can target a repository document", () => {
  assert.deepEqual(
    csvMarkdownDocumentLink("[曾蔚](../teachers/411cfdc9-0ff4-4b75-9af6-0858c30b59f6.md)"),
    {
      text: "曾蔚",
      href: "../teachers/411cfdc9-0ff4-4b75-9af6-0858c30b59f6.md",
    },
  );
  assert.deepEqual(
    csvMarkdownDocumentLink("[Review](./review.mdx?mode=preview#decision)"),
    { text: "Review", href: "./review.mdx?mode=preview#decision" },
  );
});

test("CSV link rendering rejects partial, external, and non-document destinations", () => {
  for (const value of [
    "Open [teacher](./teacher.md)",
    "[Website](https://example.com/teacher.md)",
    "[Unsafe](javascript:alert.md)",
    "[Image](./teacher.png)",
    "[Absolute](/teachers/teacher.md)",
    "[Network](//example.com/teacher.md)",
  ]) {
    assert.equal(csvMarkdownDocumentLink(value), null);
  }
});
