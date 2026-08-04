import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_ROOTS = ["public", "src"];
const BROWSER_LAYERS = new Set(["public", "content", "client"]);
const GENERATED_BROWSER_BUNDLES = new Set([
  "mermaid-renderer.bundle.js",
  "source-editor.bundle.js",
]);
const NODE_RUNTIME_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  "electron",
]);
const ALLOWED_LAYER_IMPORTS = new Map([
  ["public", new Set(["public"])],
  ["content", new Set(["content", "public"])],
  ["client", new Set(["client", "content", "public"])],
  ["server", new Set(["server", "content", "public", "root"])],
  ["desktop", new Set(["desktop", "server", "public", "root"])],
  ["root", new Set(["root", "server"])],
]);

test("source layers preserve one-way runtime dependency boundaries", () => {
  const unresolved = [];
  const disallowed = [];

  for (const filePath of sourceFiles()) {
    const sourceLayer = sourceLayerFor(filePath);
    for (const specifier of moduleSpecifiers(readFileSync(filePath, "utf8"))) {
      if (!specifier.startsWith(".")) {
        continue;
      }

      const targetPath = path.resolve(path.dirname(filePath), specifier);
      if (!existsSync(targetPath)) {
        unresolved.push(`${repoPath(filePath)} -> ${specifier}`);
        continue;
      }

      const targetLayer = sourceLayerFor(targetPath);
      if (!allowedTargetLayers(filePath, sourceLayer).has(targetLayer)) {
        disallowed.push(
          `${repoPath(filePath)} (${sourceLayer}) -> ${repoPath(targetPath)} (${targetLayer})`,
        );
      }
    }
  }

  assert.deepEqual(unresolved, [], "every relative source import should resolve");
  assert.deepEqual(disallowed, [], "source imports should follow the documented layer graph");
});

test("browser-safe layers do not import Node or Electron runtimes", () => {
  const violations = [];

  for (const filePath of sourceFiles()) {
    const sourceLayer = sourceLayerFor(filePath);
    if (!BROWSER_LAYERS.has(sourceLayer)) {
      continue;
    }
    for (const specifier of moduleSpecifiers(readFileSync(filePath, "utf8"))) {
      if (NODE_RUNTIME_MODULES.has(specifier)) {
        violations.push(`${repoPath(filePath)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

function sourceFiles() {
  return SOURCE_ROOTS.flatMap((directory) => collectSourceFiles(path.join(REPO_ROOT, directory)));
}

function collectSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(filePath));
    } else if (
      entry.isFile()
      && /\.(?:cjs|js|mjs)$/.test(entry.name)
      && !GENERATED_BROWSER_BUNDLES.has(entry.name)
    ) {
      files.push(filePath);
    }
  }
  return files.sort();
}

function moduleSpecifiers(source) {
  const specifiers = new Set();
  for (const pattern of [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']/g,
  ]) {
    for (const match of source.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

function allowedTargetLayers(filePath, sourceLayer) {
  if (sourceLayer === "root" && repoPath(filePath) !== "src/cli.mjs") {
    return new Set(["root"]);
  }
  return ALLOWED_LAYER_IMPORTS.get(sourceLayer) ?? new Set();
}

function sourceLayerFor(filePath) {
  const relativePath = repoPath(filePath);
  if (relativePath.startsWith("public/")) {
    return "public";
  }
  for (const layer of ["client", "content", "server", "desktop"]) {
    if (relativePath.startsWith(`src/${layer}/`)) {
      return layer;
    }
  }
  if (relativePath.startsWith("src/")) {
    return "root";
  }
  return "outside";
}

function repoPath(filePath) {
  return path.relative(REPO_ROOT, filePath).replaceAll(path.sep, "/");
}
