import assert from "node:assert/strict";
import test from "node:test";

import {
  filterFileTreeByVisibility,
  filterWorkbenchFileTree,
  normalizeFileTreeVisibilityMode,
} from "../public/file-tree-visibility.js";

const contentKindsTree = [
  { type: "file", name: "README.md", path: "README.md", kind: "markdown" },
  { type: "file", name: "guide.mdx", path: "guide.mdx", kind: "markdown" },
  { type: "file", name: "hero.png", path: "hero.png", kind: "image" },
  { type: "file", name: "brief.pdf", path: "brief.pdf", kind: "pdf" },
  { type: "file", name: "leads.csv", path: "leads.csv", kind: "csv" },
  { type: "file", name: "data.json", path: "data.json", kind: "json" },
  { type: "file", name: "campaign.yaml", path: "campaign.yaml", kind: "yaml" },
  { type: "file", name: "notes.txt", path: "notes.txt", kind: "text" },
  { type: "file", name: "preview.html", path: "preview.html", kind: "html" },
  { type: "file", name: "slides.pptx", path: "slides.pptx", kind: "unknown" },
  { type: "file", name: "archive.zip", path: "archive.zip", kind: "unsupported" },
  { type: "file", name: "build.js", path: "build.js", kind: "code" },
  { type: "file", name: "linked", path: "linked", kind: "symlink" },
  { type: "file", name: "vendor-lib", path: "vendor-lib", kind: "submodule" },
];

test("content mode keeps Markdown, HTML, images, and PDF as reader-facing content", () => {
  const result = filterFileTreeByVisibility(contentKindsTree);

  assert.deepEqual(
    result.map((node) => node.path),
    [
      "README.md",
      "guide.mdx",
      "hero.png",
      "brief.pdf",
      "preview.html",
    ],
  );
});

test("content mode hides source-repository data and configuration files by default", () => {
  const sourceRepositoryRoot = [
    file(".ai-infra-manifest.json", "json"),
    file(".claudeignore", "unknown"),
    file(".fvmrc", "unknown"),
    file(".git-blame-ignore-revs", "unknown"),
    file(".sops.yaml", "yaml"),
    file("AGENTS.md", "markdown"),
    file("chinese_strings_audit.csv", "csv"),
    file("CLAUDE.md", "markdown"),
    file("devtools_options.yaml", "yaml"),
    file("prototype.html", "html"),
    file("pubspec.yaml", "yaml"),
    file("README.md", "markdown"),
    file("turbo.json", "json"),
    file("versions.yaml", "yaml"),
  ];

  assert.deepEqual(paths(filterFileTreeByVisibility(sourceRepositoryRoot)), [
    "AGENTS.md",
    "CLAUDE.md",
    "prototype.html",
    "README.md",
  ]);
});

test("switching documents keeps unrelated hidden files out of the workbench tree", () => {
  const tree = [
    file("README.md", "markdown"),
    file("guide.md", "markdown"),
    file("LICENSE", "code"),
  ];
  const readmeTree = filterWorkbenchFileTree(tree, {
    currentDocument: {
      path: "README.md",
      source: "[Apache License 2.0](LICENSE)",
    },
  });
  const guideTree = filterWorkbenchFileTree(tree, {
    currentDocument: {
      path: "guide.md",
      source: "",
    },
  });

  assert.deepEqual(paths(readmeTree), paths(guideTree));
  assert.equal(paths(readmeTree).includes("LICENSE"), false);
});

test("content mode hides technical directories and common configuration files", () => {
  const tree = [
    { type: "file", name: ".gitignore", path: ".gitignore", kind: "code" },
    { type: "file", name: "package.json", path: "package.json", kind: "json" },
    { type: "file", name: "vite.config.js", path: "vite.config.js", kind: "code" },
    {
      type: "directory",
      name: ".github",
      children: [
        { type: "file", name: "CONTRIBUTING.md", path: ".github/CONTRIBUTING.md", kind: "markdown" },
        { type: "file", name: "ci.yml", path: ".github/workflows/ci.yml", kind: "yaml" },
      ],
    },
    {
      type: "directory",
      name: "docs",
      children: [
        { type: "file", name: "launch.md", path: "docs/launch.md", kind: "markdown" },
        { type: "file", name: "script.ts", path: "docs/script.ts", kind: "code" },
      ],
    },
  ];

  assert.deepEqual(filterFileTreeByVisibility(tree), [
    {
      type: "directory",
      name: "docs",
      children: [
        { type: "file", name: "launch.md", path: "docs/launch.md", kind: "markdown" },
      ],
    },
  ]);
});

test("content mode hides generated caches, signing metadata, and other unknown files", () => {
  const tree = [
    directory("scripts", [
      directory("__pycache__", [
        file("scripts/__pycache__/worker.cpython-311.pyc", "unsupported"),
      ]),
    ]),
    directory("assets", [
      file("assets/entitlements.mac.plist", "unknown"),
      file("assets/customer-data.plist", "unknown"),
    ]),
  ];

  assert.deepEqual(paths(filterFileTreeByVisibility(tree, { mode: "content" })), []);
});

test("current, search-matched, and changed files remain available in content mode", () => {
  const tree = [
    { type: "file", name: ".gitignore", path: ".gitignore", kind: "code" },
    {
      type: "directory",
      name: "scripts",
      children: [
        { type: "file", name: "current.js", path: "scripts/current.js", kind: "code" },
        { type: "file", name: "search.js", path: "scripts/search.js", kind: "code" },
      ],
    },
  ];

  const result = filterFileTreeByVisibility(tree, {
    currentFile: "scripts/current.js",
    searchMatchedPaths: ["scripts/search.js"],
    gitChangedPaths: [{ path: ".gitignore" }],
  });

  assert.deepEqual(result, tree);
});

test("a search match on a hidden technical directory reveals its complete subtree", () => {
  const tree = [{
    type: "directory",
    name: ".github",
    children: [
      directory("workflows", [
        file(".github/workflows/ci.yml", "yaml"),
        file(".github/workflows/release.js", "code"),
      ]),
    ],
  }];

  assert.deepEqual(
    filterFileTreeByVisibility(tree, { searchMatchedPaths: new Set([".github"]) }),
    tree,
  );
});

test("a search predicate can reveal a hidden file", () => {
  const tree = [{ type: "file", name: "deploy.js", path: "scripts/deploy.js", kind: "code" }];

  assert.deepEqual(
    filterFileTreeByVisibility(tree, {
      isSearchMatch: (node) => node.path === "scripts/deploy.js",
    }),
    tree,
  );
});

test("all mode returns every node and does not mutate the input tree", () => {
  const tree = [
    ...contentKindsTree,
    {
      type: "directory",
      name: ".github",
      children: [
        { type: "file", name: "ci.yml", path: ".github/ci.yml", kind: "yaml" },
      ],
    },
  ];
  const original = structuredClone(tree);

  const result = filterFileTreeByVisibility(tree, { mode: "all" });

  assert.deepEqual(result, original);
  assert.deepEqual(tree, original);
  assert.notStrictEqual(result, tree);
  assert.notStrictEqual(result.at(-1), tree.at(-1));
});

test("folder placeholders stay hidden in All while preserving the real folder, and remain available to Sync", () => {
  const tree = [{
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
  }];

  assert.deepEqual(filterFileTreeByVisibility(tree, { mode: "all" }), [{
    type: "directory",
    name: "planning",
    placeholderOnly: true,
    children: [],
  }]);
  assert.deepEqual(filterFileTreeByVisibility(tree, {
    mode: "all",
    includePlaceholders: true,
  }), tree);
});

test("unknown modes normalize to the content default", () => {
  assert.equal(normalizeFileTreeVisibilityMode("all"), "all");
  assert.equal(normalizeFileTreeVisibilityMode("content"), "content");
  assert.equal(normalizeFileTreeVisibilityMode("invalid"), "content");
  assert.deepEqual(
    filterFileTreeByVisibility(contentKindsTree, { mode: "invalid" }),
    filterFileTreeByVisibility(contentKindsTree, { mode: "content" }),
  );
});

function directory(name, children) {
  return { type: "directory", name, children };
}

function file(filePath, kind) {
  return {
    type: "file",
    name: filePath.split("/").at(-1),
    path: filePath,
    kind,
  };
}

function paths(nodes, parentPath = "") {
  const result = [];
  for (const node of nodes) {
    const nodePath = node.path || [parentPath, node.name].filter(Boolean).join("/");
    result.push(nodePath);
    if (node.children) {
      result.push(...paths(node.children, nodePath));
    }
  }
  return result;
}
