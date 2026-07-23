import assert from "node:assert/strict";
import test from "node:test";

import {
  findTextMatches,
  nextSearchIndex,
} from "../public/document-search.js";

test("document search finds literal text case-insensitively", () => {
  assert.deepEqual(findTextMatches("Git Leaf git leaf GIT LEAF", "git leaf"), [
    { from: 0, to: 8 },
    { from: 9, to: 17 },
    { from: 18, to: 26 },
  ]);
  assert.deepEqual(findTextMatches("a+b aab a+b", "a+b"), [
    { from: 0, to: 3 },
    { from: 8, to: 11 },
  ]);
  assert.deepEqual(findTextMatches("预览与 Live，预览可定位。", "预览"), [
    { from: 0, to: 2 },
    { from: 9, to: 11 },
  ]);
});

test("document search handles empty input, limits, and non-overlapping matches", () => {
  assert.deepEqual(findTextMatches("aaaa", "aa"), [
    { from: 0, to: 2 },
    { from: 2, to: 4 },
  ]);
  assert.deepEqual(findTextMatches("aaaa", "a", { limit: 2 }), [
    { from: 0, to: 1 },
    { from: 1, to: 2 },
  ]);
  assert.deepEqual(findTextMatches("text", ""), []);
});

test("document search navigation wraps in both directions", () => {
  assert.equal(nextSearchIndex(-1, 3, 1), 0);
  assert.equal(nextSearchIndex(-1, 3, -1), 2);
  assert.equal(nextSearchIndex(2, 3, 1), 0);
  assert.equal(nextSearchIndex(0, 3, -1), 2);
  assert.equal(nextSearchIndex(0, 0, 1), -1);
});
