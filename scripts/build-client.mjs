#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(path.dirname(SCRIPT_PATH));
const OUTPUT_PATH = path.join(REPO_ROOT, "public", "source-editor.bundle.js");

export function normalizeGeneratedText(source) {
  return String(source).replace(/[ \t]+(?=\r?$)/gm, "");
}

export async function buildClient() {
  await build({
    entryPoints: [path.join(REPO_ROOT, "src", "client", "source-editor.mjs")],
    bundle: true,
    format: "esm",
    target: "es2022",
    outfile: OUTPUT_PATH,
  });
  const source = await readFile(OUTPUT_PATH, "utf8");
  const normalized = normalizeGeneratedText(source);
  if (normalized !== source) {
    await writeFile(OUTPUT_PATH, normalized);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  await buildClient();
}
