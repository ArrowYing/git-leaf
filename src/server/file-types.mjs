import path from "node:path";
import { open } from "node:fs/promises";

export const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);
export const IMAGE_EXTENSIONS = new Set([".avif", ".bmp", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
export const PDF_EXTENSIONS = new Set([".pdf"]);
export const CSV_EXTENSIONS = new Set([".csv"]);
export const JSON_EXTENSIONS = new Set([".json"]);
export const NDJSON_EXTENSIONS = new Set([".ndjson", ".jsonl"]);
export const YAML_EXTENSIONS = new Set([".yaml", ".yml"]);
export const TEXT_EXTENSIONS = new Set([".txt"]);
export const HTML_EXTENSIONS = new Set([".html", ".htm"]);
export const CODE_TEXT_EXTENSIONS = new Set([
  ".astro",
  ".bash",
  ".c",
  ".cc",
  ".cfg",
  ".cjs",
  ".cmake",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".env",
  ".fish",
  ".go",
  ".gradle",
  ".graphql",
  ".h",
  ".hpp",
  ".ini",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".lock",
  ".log",
  ".lua",
  ".mjs",
  ".php",
  ".properties",
  ".ps1",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".tex",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".xml",
  ".zsh",
]);
export const CODE_TEXT_FILENAMES = new Set([
  ".editorconfig",
  ".env.example",
  ".eslintignore",
  ".eslintrc",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  ".prettierignore",
  ".prettierrc",
  "cmakelists.txt",
  "dockerfile",
  "gemfile",
  "license",
  "makefile",
  "notice",
  "procfile",
  "rakefile",
]);

export const RAW_ASSET_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...PDF_EXTENSIONS,
  ...CSV_EXTENSIONS,
  ...JSON_EXTENSIONS,
  ...NDJSON_EXTENSIONS,
  ...YAML_EXTENSIONS,
  ...TEXT_EXTENSIONS,
  ...HTML_EXTENSIONS,
]);

export function isMarkdownPath(value) {
  return MARKDOWN_EXTENSIONS.has(extensionForPath(value));
}

export function fileTypeForPath(value) {
  const extension = extensionForPath(value);
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return { kind: "markdown", extension, editable: true, text: true, raw: false };
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return { kind: "image", extension, editable: false, text: false, raw: true };
  }
  if (PDF_EXTENSIONS.has(extension)) {
    return { kind: "pdf", extension, editable: false, text: false, raw: true };
  }
  if (CSV_EXTENSIONS.has(extension)) {
    return { kind: "csv", extension, editable: false, text: true, raw: false };
  }
  if (JSON_EXTENSIONS.has(extension)) {
    return { kind: "json", extension, editable: false, text: true, raw: false };
  }
  if (NDJSON_EXTENSIONS.has(extension)) {
    return { kind: "ndjson", extension, editable: false, text: true, raw: false };
  }
  if (YAML_EXTENSIONS.has(extension)) {
    return { kind: "yaml", extension, editable: false, text: true, raw: false };
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return { kind: "text", extension, editable: false, text: true, raw: false };
  }
  if (HTML_EXTENSIONS.has(extension)) {
    return { kind: "html", extension, editable: false, text: false, raw: true };
  }
  if (CODE_TEXT_EXTENSIONS.has(extension) || CODE_TEXT_FILENAMES.has(path.basename(String(value)).toLowerCase())) {
    return { kind: "code", extension, editable: false, text: true, raw: false };
  }
  return null;
}

export async function openableFileTypeForPath(value, { sampleBytes = 8192 } = {}) {
  const known = fileTypeForPath(value);
  if (known) {
    return known;
  }
  if (await fileLooksLikeText(value, sampleBytes)) {
    return {
      kind: "code",
      extension: extensionForPath(value),
      editable: false,
      text: true,
      raw: false,
    };
  }
  return {
    kind: "unsupported",
    extension: extensionForPath(value),
    editable: false,
    text: false,
    raw: false,
  };
}

export function extensionForPath(value) {
  return path.extname(String(value ?? "")).toLowerCase();
}

async function fileLooksLikeText(filePath, sampleBytes) {
  let handle;
  try {
    handle = await open(filePath, "r");
    const buffer = Buffer.alloc(Math.max(1, sampleBytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead);
    if (sample.includes(0)) {
      return false;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(sample);
    let controls = 0;
    for (const character of text) {
      const code = character.codePointAt(0);
      if (code < 32 && character !== "\n" && character !== "\r" && character !== "\t") {
        controls += 1;
      }
    }
    return text.length === 0 || controls / text.length < 0.01;
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}
