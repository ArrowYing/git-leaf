import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { buildFileTree, buildMarkdownTree } from "../src/server/tree.mjs";

const run = promisify(execFile);

async function initializeRepository(repoRoot) {
  await run("git", ["init", "-q"], { cwd: repoRoot });
  await writeFile(path.join(repoRoot, ".gitignore"), "node_modules/\n");
}

test("buildMarkdownTree returns nested markdown and mdx files only", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await mkdir(path.join(repoRoot, "product", "demo"), { recursive: true });
  await mkdir(path.join(repoRoot, "node_modules", "ignored"), { recursive: true });
  await initializeRepository(repoRoot);
  await writeFile(path.join(repoRoot, "README.md"), "# Root\n");
  await writeFile(path.join(repoRoot, "product", "demo", "guide.mdx"), "# Guide\n");
  await writeFile(path.join(repoRoot, "product", "demo", "notes.txt"), "ignore\n");
  await writeFile(path.join(repoRoot, "node_modules", "ignored", "README.md"), "ignore\n");

  const tree = await buildMarkdownTree(repoRoot);

  assert.deepEqual(tree, [
    { type: "file", name: "README.md", path: "README.md", kind: "markdown" },
    {
      type: "directory",
      name: "product",
      children: [
        {
          type: "directory",
          name: "demo",
          children: [
            { type: "file", name: "guide.mdx", path: "product/demo/guide.mdx", kind: "markdown" },
          ],
        },
      ],
    },
  ]);
});

test("buildFileTree includes every tracked or unignored repository file", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await mkdir(path.join(repoRoot, "docs"), { recursive: true });
  await mkdir(path.join(repoRoot, "node_modules", "ignored"), { recursive: true });
  await initializeRepository(repoRoot);
  await writeFile(path.join(repoRoot, "README.md"), "# Root\n");
  await writeFile(path.join(repoRoot, "docs", "data.csv"), "name,value\nA,1\n");
  await writeFile(path.join(repoRoot, "docs", "page.html"), "<h1>Page</h1>");
  await writeFile(path.join(repoRoot, "docs", "config.yaml"), "name: demo\n");
  await writeFile(path.join(repoRoot, "docs", "notes.txt"), "notes\n");
  await writeFile(path.join(repoRoot, "docs", "image.png"), "png\n");
  await writeFile(path.join(repoRoot, "docs", "script.js"), "export const ok = true;\n");
  await writeFile(path.join(repoRoot, "docs", "slides.pptx"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));
  await writeFile(path.join(repoRoot, "node_modules", "ignored", "README.md"), "ignore\n");

  const tree = await buildFileTree(repoRoot);

  assert.deepEqual(tree, [
    { type: "file", name: ".gitignore", path: ".gitignore", kind: "code" },
    { type: "file", name: "README.md", path: "README.md", kind: "markdown" },
    {
      type: "directory",
      name: "docs",
      children: [
        { type: "file", name: "config.yaml", path: "docs/config.yaml", kind: "yaml" },
        { type: "file", name: "data.csv", path: "docs/data.csv", kind: "csv" },
        { type: "file", name: "image.png", path: "docs/image.png", kind: "image" },
        { type: "file", name: "notes.txt", path: "docs/notes.txt", kind: "text" },
        { type: "file", name: "page.html", path: "docs/page.html", kind: "html" },
        { type: "file", name: "script.js", path: "docs/script.js", kind: "code" },
        { type: "file", name: "slides.pptx", path: "docs/slides.pptx", kind: "unknown" },
      ],
    },
  ]);
});

test("buildFileTree marks a zero-content folder placeholder without inventing a Git directory entry", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await initializeRepository(repoRoot);
  await mkdir(path.join(repoRoot, "planning"));
  await writeFile(path.join(repoRoot, "planning", ".gitkeep"), "");

  const tree = await buildFileTree(repoRoot);

  assert.deepEqual(tree.find((node) => node.name === "planning"), {
    type: "directory",
    name: "planning",
    placeholderOnly: true,
    children: [{
      type: "file",
      name: ".gitkeep",
      path: "planning/.gitkeep",
      kind: "placeholder",
      placeholder: true,
    }],
  });
});

test("buildFileTree does not hide a nonempty file merely because it is named .gitkeep", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await initializeRepository(repoRoot);
  await mkdir(path.join(repoRoot, "planning"));
  await writeFile(path.join(repoRoot, "planning", ".gitkeep"), "Keep this note.\n");

  const tree = await buildFileTree(repoRoot);

  assert.deepEqual(tree.find((node) => node.name === "planning"), {
    type: "directory",
    name: "planning",
    children: [{
      type: "file",
      name: ".gitkeep",
      path: "planning/.gitkeep",
      kind: "unknown",
    }],
  });
});

test("buildFileTree surfaces Git index errors instead of showing ignored filesystem files", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await initializeRepository(repoRoot);
  await writeFile(path.join(repoRoot, "README.md"), "# Root\n");
  await writeFile(path.join(repoRoot, ".git", "index"), "broken");

  await assert.rejects(() => buildFileTree(repoRoot), /index/i);
});

test("buildMarkdownTree sorts underscore directories after regular directories", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-"));
  await initializeRepository(repoRoot);
  const directories = ["_archive", "_drafts", "apps", "knowledge"];
  for (const directory of directories) {
    await mkdir(path.join(repoRoot, directory), { recursive: true });
    await writeFile(path.join(repoRoot, directory, "README.md"), "# Directory\n");
  }

  const tree = await buildMarkdownTree(repoRoot);

  assert.deepEqual(
    tree.map((node) => node.name),
    ["apps", "knowledge", "_archive", "_drafts"],
  );
});
