const CONTENT_VISIBLE_KINDS = new Set([
  "markdown",
  "md",
  "mdx",
  "image",
  "pdf",
  "html",
]);

const TECHNICAL_KINDS = new Set(["code", "symlink", "submodule"]);

const TECHNICAL_DIRECTORY_NAMES = new Set([
  ".cache",
  ".changeset",
  ".circleci",
  ".devcontainer",
  ".github",
  ".gitlab",
  ".husky",
  ".idea",
  ".next",
  ".nuxt",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".svelte-kit",
  ".vscode",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);

const TECHNICAL_FILENAMES = new Set([
  ".editorconfig",
  ".eslintignore",
  ".eslintrc",
  ".gitattributes",
  ".gitignore",
  ".gitmodules",
  ".npmrc",
  ".nvmrc",
  ".prettierignore",
  ".prettierrc",
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "cargo.toml",
  "cmakelists.txt",
  "composer.json",
  "composer.lock",
  "compose.yaml",
  "compose.yml",
  "deno.json",
  "deno.jsonc",
  "docker-compose.yaml",
  "docker-compose.yml",
  "dockerfile",
  "gemfile",
  "gemfile.lock",
  "go.mod",
  "go.sum",
  "jsconfig.json",
  "makefile",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "package.json",
  "pipfile",
  "pipfile.lock",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "poetry.lock",
  "procfile",
  "pyproject.toml",
  "requirements.txt",
  "tsconfig.json",
  "yarn.lock",
]);

const TECHNICAL_FILENAME_PATTERNS = [
  /^\.env(?:\..+)?$/,
  /^(?:astro|babel|eslint|jest|next|nuxt|postcss|prettier|rollup|stylelint|svelte|tailwind|vite|vitest|webpack)\.config\./,
  /^docker-compose(?:\..+)?\.ya?ml$/,
  /^(?:entitlements(?:\..+)?|.+\.entitlements)\.plist$/,
  /^info\.plist$/,
  /^tsconfig(?:\..+)?\.json$/,
];

export function normalizeFileTreeVisibilityMode(value) {
  return value === "all" ? "all" : "content";
}

/**
 * Return a filtered copy of an OpenPeek file tree without changing discovery or
 * file capabilities. Search matches, the current file, and Git changes override
 * content-mode hiding for the current view.
 */
export function filterFileTreeByVisibility(nodes, {
  mode = "content",
  currentFile = "",
  searchMatchedPaths = [],
  gitChangedPaths = [],
  isSearchMatch = null,
  includePlaceholders = false,
} = {}) {
  const visibilityMode = normalizeFileTreeVisibilityMode(mode);
  const context = {
    mode: visibilityMode,
    searchMatchedPaths: normalizedPathSet(searchMatchedPaths),
    overridePaths: normalizedPathSet([
      currentFile,
      ...pathValues(gitChangedPaths),
    ]),
    isSearchMatch: typeof isSearchMatch === "function" ? isSearchMatch : null,
    includePlaceholders: includePlaceholders === true,
  };

  return filterNodes(Array.isArray(nodes) ? nodes : [], "", context, {
    hiddenByTechnicalDirectory: false,
    revealAll: visibilityMode === "all",
  });
}

function filterNodes(nodes, parentPath, context, inherited) {
  const filtered = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      continue;
    }

    if (node.type === "directory") {
      const directoryPath = nodePath(node, parentPath);
      const matchesSearch = pathCoveredByReveal(directoryPath, context.searchMatchedPaths);
      const revealAll = inherited.revealAll || matchesSearch;
      const hiddenByTechnicalDirectory = revealAll
        ? false
        : inherited.hiddenByTechnicalDirectory || isTechnicalDirectory(node.name);
      const children = filterNodes(
        Array.isArray(node.children) ? node.children : [],
        directoryPath,
        context,
        { hiddenByTechnicalDirectory, revealAll },
      );
      if (children.length > 0 || (
        node.placeholderOnly === true &&
        context.includePlaceholders === false &&
        (context.mode === "all" || revealAll || !hiddenByTechnicalDirectory)
      )) {
        filtered.push({ ...node, children });
      }
      continue;
    }

    if (node.type !== "file") {
      continue;
    }
    if (node.placeholder === true && context.includePlaceholders === false) {
      continue;
    }

    const filePath = nodePath(node, parentPath);
    const revealed = inherited.revealAll ||
      pathCoveredByReveal(filePath, context.searchMatchedPaths) ||
      context.overridePaths.has(filePath) ||
      Boolean(context.isSearchMatch?.(node));
    const visibleByMode = context.mode === "all" || (
      !inherited.hiddenByTechnicalDirectory &&
      isContentFile(node)
    );
    if (revealed || visibleByMode) {
      filtered.push({ ...node });
    }
  }
  return filtered;
}

export function filterWorkbenchFileTree(nodes, {
  mode = "content",
  currentDocument = null,
  currentFile = "",
  searchMatchedPaths = [],
  gitChangedPaths = [],
  includePlaceholders = false,
} = {}) {
  return filterFileTreeByVisibility(nodes, {
    mode,
    currentFile: currentDocument?.path || currentFile,
    searchMatchedPaths,
    gitChangedPaths,
    includePlaceholders,
  });
}

function isContentFile(node) {
  const name = String(node.name || basename(node.path)).toLowerCase();
  if (isTechnicalFilename(name)) {
    return false;
  }

  const kind = String(node.kind || "unknown").toLowerCase();
  if (TECHNICAL_KINDS.has(kind)) {
    return false;
  }
  return CONTENT_VISIBLE_KINDS.has(kind);
}

function isTechnicalDirectory(name) {
  return TECHNICAL_DIRECTORY_NAMES.has(String(name || "").toLowerCase());
}

function isTechnicalFilename(name) {
  return TECHNICAL_FILENAMES.has(name) ||
    TECHNICAL_FILENAME_PATTERNS.some((pattern) => pattern.test(name));
}

function nodePath(node, parentPath) {
  const explicitPath = normalizePath(node.path);
  return explicitPath || normalizePath([parentPath, node.name].filter(Boolean).join("/"));
}

function basename(value) {
  return normalizePath(value).split("/").at(-1) || "";
}

function normalizedPathSet(values) {
  return new Set(pathValues(values).map(normalizePath).filter(Boolean));
}

function pathValues(values) {
  if (values === null || values === undefined || values === "") {
    return [];
  }
  const entries = typeof values === "string"
    ? [values]
    : Array.isArray(values) || values instanceof Set
      ? [...values]
      : typeof values?.[Symbol.iterator] === "function"
        ? [...values]
        : [values];
  return entries.map((entry) => (
    typeof entry === "string" ? entry : entry?.path
  )).filter((entry) => typeof entry === "string");
}

function pathCoveredByReveal(candidate, matchedPaths) {
  for (const matchedPath of matchedPaths) {
    if (candidate === matchedPath || candidate.startsWith(`${matchedPath}/`)) {
      return true;
    }
  }
  return false;
}

function normalizePath(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "");
}
