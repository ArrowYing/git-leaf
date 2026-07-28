import { open, readFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizeFrontmatterValue,
} from "../../public/frontmatter-filters.js";
import { buildMarkdownTree } from "./tree.mjs";

const FRONTMATTER_HEAD_BYTES = 16 * 1024;
const FRONTMATTER_RULES_RELATIVE_PATH = "docs/frontmatter-rules.json";
const FRONTMATTER_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const NON_FACET_FRONTMATTER_KEYS = new Set([
  "ai_snippet",
  "canonical_path",
  "created",
  "date",
  "description",
  "last_reviewed",
  "last_updated",
  "meeting_date",
  "summary",
  "title",
]);

export async function frontmatterFilterProfile(repoRoot) {
  const rules = await readFrontmatterRules(repoRoot);
  if (!rules) {
    return {
      hasRules: false,
      allowedKeys: [],
      searchKeys: [],
    };
  }

  return {
    hasRules: true,
    allowedKeys: deriveAllowedFrontmatterFilterKeys(rules),
    searchKeys: deriveSearchFrontmatterKeys(rules),
  };
}

export async function frontmatterDocumentProfile(repoRoot, relativePath = "", source = "") {
  const rules = await readFrontmatterRules(repoRoot);
  if (!rules) {
    return {
      enabled: false,
      fields: [],
    };
  }

  return {
    enabled: true,
    fields: deriveFrontmatterDocumentFields(rules, relativePath, source),
  };
}

export async function frontmatterFacetsPayload(repoRoot) {
  const profile = await frontmatterFilterProfile(repoRoot);
  const allowedKeys = profile.allowedKeys;
  const metadataKeys = new Set([...allowedKeys, ...profile.searchKeys]);
  if (metadataKeys.size === 0) {
    return {
      allowedKeys,
      files: {},
      facets: {},
    };
  }

  const tree = await buildMarkdownTree(repoRoot);
  const files = {};
  const facetCounts = Object.fromEntries(
    allowedKeys.map((key) => [key, new Map()]),
  );

  for (const relativePath of flattenMarkdownTree(tree)) {
    const metadata = await readAllowedFrontmatter(path.join(repoRoot, relativePath), metadataKeys);
    if (Object.keys(metadata).length === 0) {
      continue;
    }

    files[relativePath] = metadata;
    for (const key of allowedKeys) {
      const value = metadata[key];
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        const normalizedValue = normalizeFrontmatterValue(item);
        if (!normalizedValue) {
          continue;
        }
        const counts = facetCounts[key];
        counts.set(normalizedValue, (counts.get(normalizedValue) ?? 0) + 1);
      }
    }
  }

  return {
    allowedKeys,
    files,
    facets: Object.fromEntries(
      allowedKeys.map((key) => [
        key,
        [...facetCounts[key]]
          .map(([value, count]) => ({ value, count }))
          .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, "zh-Hans-CN")),
      ]),
    ),
  };
}

async function readFrontmatterRules(repoRoot) {
  try {
    return JSON.parse(
      await readFile(path.join(repoRoot, FRONTMATTER_RULES_RELATIVE_PATH), "utf8"),
    );
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

function deriveAllowedFrontmatterFilterKeys(rules) {
  const keys = [];
  const add = (key) => {
    if (!isFilterableFrontmatterKey(key) || keys.includes(key)) {
      return;
    }
    keys.push(key);
  };

  for (const key of arrayValues(rules.basicFields)) {
    add(key);
  }
  if (Array.isArray(rules.domains)) {
    add("domain");
  }
  if (Array.isArray(rules.types)) {
    add("type");
  }
  for (const key of Object.keys(objectValue(rules.fieldValues))) {
    add(key);
  }
  for (const rule of arrayValues(rules.rules)) {
    for (const key of Object.keys(objectValue(rule.allowValues))) {
      add(key);
    }
    for (const key of Object.keys(objectValue(rule.infer))) {
      add(key);
    }
  }

  return keys;
}

function deriveFrontmatterDocumentFields(rules, relativePath, source = "") {
  const fields = new Map();
  const matchedRules = arrayValues(rules.rules).filter((rule) => frontmatterRuleMatchesPath(rule, relativePath));
  const matchingSuggestedKeys = new Set();
  const inferredValues = new Map();
  const add = (key, updates = {}) => {
    if (typeof key !== "string" || !FRONTMATTER_KEY_PATTERN.test(key) || key === "$basic") {
      return;
    }

    const existing = fields.get(key) ?? {
      key,
      type: frontmatterFieldType(key, []),
      values: [],
      inferredValue: "",
      required: false,
      suggested: false,
    };
    const values = mergeStringValues(existing.values, updates.values);
    fields.set(key, {
      ...existing,
      ...updates,
      values,
      type: updates.type ?? frontmatterFieldType(key, values),
      inferredValue: updates.inferredValue ?? existing.inferredValue,
      required: Boolean(existing.required || updates.required),
      suggested: Boolean(existing.suggested || updates.suggested),
    });
  };

  for (const key of arrayValues(rules.basicFields)) {
    add(key, { suggested: true });
  }
  if (Array.isArray(rules.domains)) {
    add("domain", { values: rules.domains, type: "enum" });
  }
  if (Array.isArray(rules.types)) {
    add("type", { values: rules.types, type: "enum" });
  }
  for (const [key, values] of Object.entries(objectValue(rules.fieldValues))) {
    add(key, { values: arrayValues(values) });
  }
  for (const requiredFields of Object.values(objectValue(rules.typeRequiredFields))) {
    for (const key of arrayValues(requiredFields)) {
      add(key);
    }
  }
  for (const rule of arrayValues(rules.rules)) {
    for (const [key, values] of Object.entries(objectValue(rule.allowValues))) {
      add(key, { values: arrayValues(values) });
    }
    for (const key of Object.keys(objectValue(rule.infer))) {
      add(key);
    }
    for (const key of arrayValues(rule.suggestFields)) {
      add(key);
    }
  }

  for (const rule of matchedRules) {
    for (const key of arrayValues(rule.suggestFields)) {
      matchingSuggestedKeys.add(key);
    }
    for (const [key, value] of Object.entries(objectValue(rule.infer))) {
      const inferredValue = inferredFrontmatterValue(value, relativePath);
      if (inferredValue) {
        inferredValues.set(key, inferredValue);
      }
    }
  }
  for (const key of matchingSuggestedKeys) {
    add(key, { suggested: true });
  }
  for (const [key, inferredValue] of inferredValues) {
    add(key, { inferredValue });
  }
  for (const { key, value } of frontmatterEntriesFromSource(source)) {
    add(key, frontmatterFieldUpdatesFromValue(value));
  }

  return [...fields.values()].sort(frontmatterFieldSort);
}

function frontmatterEntriesFromSource(source) {
  const frontmatter = extractFrontmatter(String(source ?? ""));
  if (!frontmatter) {
    return [];
  }

  const entries = [];
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const value = parseFrontmatterValue(match[2]);
    if (value === null || value === "") {
      continue;
    }
    entries.push({ key: match[1], value });
  }
  return entries;
}

function frontmatterFieldUpdatesFromValue(value) {
  if (typeof value === "boolean") {
    return {
      type: "boolean",
      values: ["true", "false"],
    };
  }
  return {};
}

function frontmatterFieldType(key, values) {
  if (values.length === 2 && values.includes("true") && values.includes("false")) {
    return "boolean";
  }
  if (values.length > 0 || key === "domain" || key === "type") {
    return "enum";
  }
  if (
    key === "created" ||
    key === "last_updated" ||
    key === "last_reviewed" ||
    key === "meeting_date" ||
    key.endsWith("_date")
  ) {
    return "date";
  }
  return "text";
}

function frontmatterFieldSort(left, right) {
  const rank = (field) => (
    field.suggested ? 0 :
      field.values.length > 0 || field.inferredValue ? 1 :
        2
  );
  return rank(left) - rank(right) || left.key.localeCompare(right.key, "zh-Hans-CN");
}

function mergeStringValues(left = [], right = []) {
  return [...new Set([
    ...arrayValues(left).map(String),
    ...arrayValues(right).map(String),
  ].filter(Boolean))];
}

function frontmatterRuleMatchesPath(rule, relativePath) {
  const pathValue = String(relativePath ?? "");
  if (!pathValue) {
    return false;
  }
  if (matchesAny(pathValue, arrayValues(rule.excludePaths))) {
    return false;
  }
  return matchesAny(pathValue, arrayValues(rule.paths));
}

function matchesAny(pathValue, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(pathValue));
}

function globToRegExp(pattern) {
  let source = "^";
  for (let index = 0; index < pattern.length;) {
    if (pattern.slice(index, index + 3) === "**/") {
      source += "(?:[^/]+/)*";
      index += 3;
      continue;
    }
    if (pattern.slice(index, index + 2) === "**") {
      source += ".*";
      index += 2;
      continue;
    }
    const char = pattern[index];
    if (char === "*") {
      source += "[^/]*";
    } else if (/[.+^${}()|[\]\\]/.test(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
    index += 1;
  }
  return new RegExp(`${source}$`);
}

function inferredFrontmatterValue(value, relativePath) {
  const parts = String(relativePath ?? "").split("/");
  if (value === "firstSegment") {
    return parts[0] ?? "";
  }
  if (value === "secondSegment") {
    return parts[1] ?? "";
  }
  if (value === "firstBusinessSegment") {
    return parts.find((part) => !["docs", "tools", "inbox"].includes(part)) ?? parts[0] ?? "";
  }
  return typeof value === "string" ? value : "";
}

function deriveSearchFrontmatterKeys(rules) {
  return frontmatterKeyIsMentioned(rules, "ai_snippet") ? ["ai_snippet"] : [];
}

function frontmatterKeyIsMentioned(rules, expectedKey) {
  if (arrayValues(rules.basicFields).includes(expectedKey)) {
    return true;
  }
  for (const fields of Object.values(objectValue(rules.typeRequiredFields))) {
    if (arrayValues(fields).includes(expectedKey)) {
      return true;
    }
  }
  for (const rule of arrayValues(rules.rules)) {
    if (arrayValues(rule.suggestFields).includes(expectedKey)) {
      return true;
    }
  }
  return false;
}

function isFilterableFrontmatterKey(key) {
  if (typeof key !== "string" || !FRONTMATTER_KEY_PATTERN.test(key)) {
    return false;
  }

  const normalizedKey = key.toLowerCase();
  if (NON_FACET_FRONTMATTER_KEYS.has(normalizedKey)) {
    return false;
  }
  return !(
    normalizedKey.endsWith("_date") ||
    normalizedKey.endsWith("_updated") ||
    normalizedKey.endsWith("_reviewed")
  );
}

function arrayValues(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function flattenMarkdownTree(nodes) {
  const files = [];
  for (const node of nodes) {
    if (node.type === "file") {
      files.push(node.path);
      continue;
    }
    files.push(...flattenMarkdownTree(node.children));
  }
  return files;
}

async function readAllowedFrontmatter(absolutePath, metadataKeys) {
  const source = await readFileHead(absolutePath);
  const frontmatter = extractFrontmatter(source);
  if (!frontmatter) {
    return {};
  }

  const metadata = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const key = match[1];
    if (!metadataKeys.has(key)) {
      continue;
    }

    const value = parseFrontmatterValue(match[2]);
    if (value === null || value === "") {
      continue;
    }
    metadata[key] = value;
  }
  return metadata;
}

async function readFileHead(absolutePath) {
  const file = await open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(FRONTMATTER_HEAD_BYTES);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}

function extractFrontmatter(source) {
  if (!source.startsWith("---")) {
    return null;
  }

  const closingMatch = /\r?\n---(?:\r?\n|$)/.exec(source.slice(3));
  if (!closingMatch) {
    return null;
  }

  const endIndex = 3 + closingMatch.index;
  return source.slice(3, endIndex).trim();
}

function parseFrontmatterValue(rawValue) {
  const value = rawValue.trim();
  if (!value) {
    return null;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => stripQuotes(item.trim()))
      .filter(Boolean);
  }
  return stripQuotes(value);
}

function stripQuotes(value) {
  const quote = value[0];
  if ((quote === "\"" || quote === "'") && value.at(-1) === quote) {
    return value.slice(1, -1);
  }
  return value;
}
