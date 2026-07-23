import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeWorkbenchSessions,
  serializeWorkbenchSession,
  workbenchSessionForLaunch,
  workbenchSessionForRepo,
} from "../public/workbench-session.js";

test("workbench sessions normalize tabs, active path, tree viewport, and focus", () => {
  assert.deepEqual(
    normalizeWorkbenchSessions({
      "docs-repo": {
        tabs: [
          { path: "AGENTS.md" },
          { path: "docs/repo-structure.md" },
          { path: "AGENTS.md" },
          { path: "/absolute.md" },
          { path: "../outside.md" },
        ],
        activeTabPath: "missing.md",
        treeScrollTop: 42.7,
        treeFocus: {
          itemType: "directory",
          path: "docs",
        },
      },
      empty: {
        tabs: [],
      },
      invalid: {
        tabs: "AGENTS.md",
      },
    }),
    {
      "docs-repo": {
        tabs: [
          { path: "AGENTS.md" },
          { path: "docs/repo-structure.md" },
        ],
        activeTabPath: "AGENTS.md",
        treeScrollTop: 43,
        treeFocus: {
          itemType: "directory",
          path: "docs",
        },
      },
      empty: {
        tabs: [],
        activeTabPath: "",
      },
    },
  );
});

test("serializeWorkbenchSession keeps an explicit empty tab set", () => {
  assert.deepEqual(
    serializeWorkbenchSession({
      tabs: [],
      activeTabPath: "",
      treeScrollTop: 0,
      treeFocus: null,
    }),
    {
      tabs: [],
      activeTabPath: "",
      treeScrollTop: 0,
    },
  );
});

test("workbenchSessionForRepo returns a normalized repo session", () => {
  const sessions = normalizeWorkbenchSessions({
    "content-repo": {
      tabs: [{ path: "README.md" }],
      activeTabPath: "README.md",
    },
  });

  assert.deepEqual(workbenchSessionForRepo(sessions, "content-repo"), {
    tabs: [{ path: "README.md" }],
    activeTabPath: "README.md",
  });
  assert.equal(workbenchSessionForRepo(sessions, "docs-repo"), null);
});

test("an explicitly requested launch document overrides the restored active tab", () => {
  const sessions = normalizeWorkbenchSessions({
    "company-docs": {
      tabs: [{ path: "company/report.md" }, { path: "README.md" }],
      activeTabPath: "company/report.md",
    },
  });

  assert.deepEqual(
    workbenchSessionForLaunch(sessions, "company-docs", "AGENTS.md"),
    {
      tabs: [
        { path: "company/report.md" },
        { path: "README.md" },
        { path: "AGENTS.md" },
      ],
      activeTabPath: "AGENTS.md",
    },
  );
});

test("an explicitly requested existing tab becomes active without duplication", () => {
  const sessions = normalizeWorkbenchSessions({
    "company-docs": {
      tabs: [{ path: "AGENTS.md" }, { path: "README.md" }],
      activeTabPath: "README.md",
    },
  });

  assert.deepEqual(
    workbenchSessionForLaunch(sessions, "company-docs", "AGENTS.md"),
    {
      tabs: [{ path: "AGENTS.md" }, { path: "README.md" }],
      activeTabPath: "AGENTS.md",
    },
  );
});
