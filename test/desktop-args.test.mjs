import assert from "node:assert/strict";
import test from "node:test";

import { parseDesktopArgs } from "../src/desktop-args.mjs";

test("parseDesktopArgs reads repository and file launch arguments", () => {
  assert.deepEqual(
    parseDesktopArgs(["/Applications/Git Leaf.app", "--repo", "/repo/a", "--file", "docs/a.md"]),
    {
      repoRoot: "/repo/a",
      file: "docs/a.md",
    },
  );
});

test("parseDesktopArgs ignores missing flag values instead of treating the next flag as a path", () => {
  assert.deepEqual(
    parseDesktopArgs(["--repo", "--file", "docs/a.md"]),
    {
      repoRoot: "",
      file: "docs/a.md",
    },
  );
  assert.deepEqual(
    parseDesktopArgs(["--repo", "--file"]),
    {
      repoRoot: "",
      file: "",
    },
  );
});

test("parseDesktopArgs accepts equals-style launch arguments", () => {
  assert.deepEqual(
    parseDesktopArgs(["--repo=/repo/a", "--file=docs/a.md"]),
    {
      repoRoot: "/repo/a",
      file: "docs/a.md",
    },
  );
});

test("parseDesktopArgs reads a Git Leaf document deep link", () => {
  assert.deepEqual(
    parseDesktopArgs([
      "C:\\Program Files\\Git Leaf\\Git Leaf.exe",
      "git-leaf://open?repo=C%3A%5CProjects%5Ccompany-docs&path=docs%2Fstrategy.md&handoff=handoff_1234567890abcdef",
    ], { platform: "win32" }),
    {
      repoRoot: "C:\\Projects\\company-docs",
      file: "docs/strategy.md",
      handoff: "handoff_1234567890abcdef",
    },
  );
});

test("parseDesktopArgs reads a versioned shared document link", () => {
  const rev = "a".repeat(40);
  assert.deepEqual(
    parseDesktopArgs([
      `git-leaf://open-shared?v=1&repo=exampleorg%2Fcompany-docs&path=docs%2Fstrategy.md&rev=${rev}&handoff=handoff_1234567890abcdef`,
    ]),
    {
      repository: "exampleorg/company-docs",
      file: "docs/strategy.md",
      rev,
      share: true,
      handoff: "handoff_1234567890abcdef",
    },
  );
});
