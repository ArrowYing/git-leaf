import assert from "node:assert/strict";
import test from "node:test";

import {
  addAgentContextItem,
  agentContextItemLabel,
  agentContextLineCount,
  agentContextScopeKey,
  createAgentContextItem,
  formatAgentContextMarkdown,
  readAgentContextItems,
  removeAgentContextItem,
  writeAgentContextItems,
} from "../public/agent-context.js";

function exampleItem(overrides = {}) {
  return createAgentContextItem({
    repoId: "repo-1",
    repoName: "git-leaf",
    worktreeId: "worktree-1",
    worktreeName: "main checkout",
    branch: "main",
    revision: "0123456789abcdef",
    path: "architecture.md",
    selectedLines: [69, 67, 68],
    sourceLines: [
      { number: 67, text: "OpenPeek is Git-native." },
      { number: 68, text: "" },
      { number: 69, text: "Agents receive source context." },
    ],
    ...overrides,
  });
}

test("agent context items preserve selected source lines and replace duplicate ranges", () => {
  const original = exampleItem();
  const replacement = exampleItem({
    revision: "fedcba9876543210",
    sourceLines: [
      { number: 67, text: "Updated line." },
      { number: 68, text: "" },
      { number: 69, text: "Updated context." },
    ],
  });
  const items = addAgentContextItem(addAgentContextItem([], original), replacement);

  assert.equal(items.length, 1);
  assert.equal(items[0].revision, "fedcba9876543210");
  assert.deepEqual(items[0].selectedLines, [67, 68, 69]);
  assert.equal(items[0].sourceLines[0].text, "Updated line.");
});

test("agent context baskets remove individual items and count selected lines", () => {
  const first = exampleItem();
  const second = exampleItem({ path: "README.md", selectedLines: [9, 10] });
  const items = addAgentContextItem([first], second);

  assert.equal(agentContextLineCount(items), 5);
  assert.deepEqual(removeAgentContextItem(items, first.id).map((item) => item.path), ["README.md"]);
});

test("agent context item labels prioritize the file name without exposing its path", () => {
  const item = exampleItem({
    path: "research/projects/teacher-policy-learning-system.mdx",
    selectedLines: [43, 44, 45],
  });

  assert.equal(agentContextItemLabel(item), "teacher-policy-learning-system · L43–45");
  assert.doesNotMatch(agentContextItemLabel(item), /research|projects|\.mdx/);
});

test("agent context markdown keeps source passages quoted with attribution outside", () => {
  const output = formatAgentContextMarkdown([
    exampleItem(),
    exampleItem({
      path: "README.md",
      selectedLines: [9, 10],
      sourceLines: [
        { number: 9, text: "People read shared context." },
        { number: 10, text: "Agents edit the same files." },
      ],
    }),
  ]);

  assert.equal(output, `# Agent Context

Repository: git-leaf
Worktree: main checkout
Branch: main
Revision: 0123456789abcdef

> 67 | OpenPeek is Git-native.
> 68 |
> 69 | Agents receive source context.

Source: architecture.md:L67-L69

> 9 | People read shared context.
> 10 | Agents edit the same files.

Source: README.md:L9-L10` + "\n\n");
  assert.doesNotMatch(output, /Codex|Claude|Cursor/);
});

test("agent context session storage is isolated by repository and worktree", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  const primaryScope = agentContextScopeKey({ repoId: "repo-1", worktreeId: "primary" });
  const featureScope = agentContextScopeKey({ repoId: "repo-1", worktreeId: "feature" });

  assert.equal(writeAgentContextItems({ storage, scopeKey: primaryScope, items: [exampleItem()] }), true);
  assert.equal(readAgentContextItems({ storage, scopeKey: primaryScope }).length, 1);
  assert.deepEqual(readAgentContextItems({ storage, scopeKey: featureScope }), []);
});

test("invalid or unavailable session storage fails closed", () => {
  const brokenStorage = {
    getItem() {
      return "not json";
    },
    setItem() {
      throw new Error("blocked");
    },
  };

  assert.deepEqual(readAgentContextItems({ storage: brokenStorage, scopeKey: "scope" }), []);
  assert.equal(writeAgentContextItems({ storage: brokenStorage, scopeKey: "scope", items: [exampleItem()] }), false);
  assert.equal(createAgentContextItem({ path: "README.md", selectedLines: [] }), null);
});
