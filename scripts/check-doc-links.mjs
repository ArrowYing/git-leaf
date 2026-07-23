#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import MarkdownIt from "markdown-it";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(path.dirname(SCRIPT_PATH));
const IGNORED_DIRECTORIES = new Set([".git", "dist", "node_modules"]);
const MARKDOWN = new MarkdownIt({ html: false, linkify: false });

export async function markdownFiles(root = REPO_ROOT) {
  const files = [];
  await collectMarkdownFiles(root, root, files);
  return files.sort();
}

export async function brokenMarkdownLinks({ root = REPO_ROOT } = {}) {
  const broken = [];
  for (const file of await markdownFiles(root)) {
    const source = await readFile(file, "utf8");
    for (const target of markdownLinkTargets(source)) {
      const fileTarget = target.split("#", 1)[0];
      if (!fileTarget) {
        continue;
      }
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(fileTarget));
      try {
        await access(resolved);
      } catch {
        broken.push({
          source: path.relative(root, file),
          target,
        });
      }
    }
  }
  return broken;
}

export function markdownLinkTargets(source) {
  const targets = [];
  for (const token of MARKDOWN.parse(String(source), {})) {
    if (token.type !== "inline" || !Array.isArray(token.children)) {
      continue;
    }
    for (const child of token.children) {
      const target = child.type === "link_open"
        ? child.attrGet("href")
        : child.type === "image"
          ? child.attrGet("src")
          : "";
      if (
        /\.(?:md|mdx)(?:#.*)?$/i.test(target) &&
        !/^[a-z][a-z\d+.-]*:/i.test(target) &&
        !target.startsWith("/")
      ) {
        targets.push(target);
      }
    }
  }
  return targets;
}

async function collectMarkdownFiles(root, directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        await collectMarkdownFiles(root, path.join(directory, entry.name), files);
      }
      continue;
    }
    if (entry.isFile() && /\.(?:md|mdx)$/i.test(entry.name)) {
      files.push(path.join(directory, entry.name));
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const broken = await brokenMarkdownLinks();
  if (broken.length > 0) {
    for (const item of broken) {
      console.error(`${item.source} -> ${item.target}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Documentation links are valid.");
  }
}
