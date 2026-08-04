#!/usr/bin/env node

import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(path.dirname(SCRIPT_PATH));
const SOURCE_EDITOR_OUTPUT_PATH = path.join(REPO_ROOT, "public", "source-editor.bundle.js");
const MERMAID_RENDERER_OUTPUT_PATH = path.join(
  REPO_ROOT,
  "public",
  "mermaid-renderer.bundle.js",
);
const MERMAID_LICENSE_OUTPUT_PATH = path.join(
  REPO_ROOT,
  "public",
  "mermaid.LICENSE.txt",
);

export function normalizeGeneratedText(source) {
  return String(source).replace(/[ \t]+(?=\r?$)/gm, "");
}

export async function buildClient() {
  await Promise.all([
    build({
      entryPoints: [path.join(REPO_ROOT, "src", "client", "source-editor.mjs")],
      bundle: true,
      format: "esm",
      target: "es2022",
      outfile: SOURCE_EDITOR_OUTPUT_PATH,
    }),
    build({
      entryPoints: [path.join(REPO_ROOT, "src", "client", "mermaid-renderer.mjs")],
      bundle: true,
      format: "esm",
      minify: true,
      platform: "browser",
      target: "es2022",
      outfile: MERMAID_RENDERER_OUTPUT_PATH,
    }),
  ]);

  for (const outputPath of [SOURCE_EDITOR_OUTPUT_PATH, MERMAID_RENDERER_OUTPUT_PATH]) {
    const source = await readFile(outputPath, "utf8");
    const normalized = normalizeGeneratedText(source);
    if (normalized !== source) {
      await writeFile(outputPath, normalized);
    }
  }

  await copyFile(
    path.join(REPO_ROOT, "node_modules", "mermaid", "LICENSE"),
    MERMAID_LICENSE_OUTPUT_PATH,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  await buildClient();
}
