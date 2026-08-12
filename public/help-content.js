import { createTranslator } from "./i18n.js";
import { WORKBENCH_MESSAGES } from "./workbench-locales.js";

const HELP_SECTION_KEYS = Object.freeze([
  { id: "repository-files", key: "repositoryFiles", paragraphCount: 3 },
  { id: "filters", key: "filters", paragraphCount: 2 },
  { id: "worktrees", key: "worktrees", paragraphCount: 4 },
  { id: "sync", key: "sync", paragraphCount: 3 },
  { id: "sharing", key: "sharing", paragraphCount: 4 },
  { id: "telemetry", key: "telemetry", paragraphCount: 2 },
]);

const FILE_TYPE_ROWS = Object.freeze([
  { files: ".md .mdx", visibility: "default", behavior: "document" },
  { files: ".avif .bmp .png .jpg .jpeg .gif .webp .svg", visibility: "default", behavior: "image" },
  { files: ".pdf", visibility: "default", behavior: "pdf" },
  { files: ".html .htm", visibility: "default", behavior: "html" },
  { files: ".csv", visibility: "onDemand", behavior: "csv" },
  { files: ".json", visibility: "onDemand", behavior: "json" },
  { files: ".ndjson .jsonl", visibility: "onDemand", behavior: "ndjson" },
  { files: ".yaml .yml .txt", visibility: "onDemand", behavior: "text" },
  { filesKey: "help.files.code", visibility: "onDemand", behavior: "code" },
  { filesKey: "help.files.other", visibility: "onDemand", behavior: "other" },
]);

export function getOpenPeekHelpSections(locale = "en") {
  const t = createTranslator(WORKBENCH_MESSAGES, locale);
  return HELP_SECTION_KEYS.map(({ id, key, paragraphCount }) => ({
    id,
    title: t(`help.${key}.title`),
    body: Array.from(
      { length: paragraphCount },
      (_, index) => t(`help.${key}.${index + 1}`),
    ),
  }));
}

export function getFileTypeHelpRows(locale = "en") {
  const t = createTranslator(WORKBENCH_MESSAGES, locale);
  return FILE_TYPE_ROWS.map((row) => ({
    files: row.files ?? t(row.filesKey),
    visibility: t(`help.visibility.${row.visibility}`),
    behavior: t(`help.behavior.${row.behavior}`),
  }));
}

// Keep the original exports for callers that have not selected a locale yet.
export const OPENPEEK_HELP_SECTIONS = getOpenPeekHelpSections("zh-CN");
export const FILE_TYPE_HELP_ROWS = getFileTypeHelpRows("zh-CN");

export function openPeekHelpPlainText(locale = "zh-CN") {
  const t = createTranslator(WORKBENCH_MESSAGES, locale);
  const sections = getOpenPeekHelpSections(locale);
  const rows = getFileTypeHelpRows(locale);
  return [
    t("help.title"),
    "",
    ...sections.flatMap((section) => [
      section.title,
      ...section.body,
      "",
    ]),
    t("help.fileTypes"),
    `${t("help.column.fileType").padEnd(30)}${t("help.column.contentMode").padEnd(12)}${t("help.column.openMethod")}`,
    ...rows.map((row) => `${row.files.padEnd(30)}${row.visibility.padEnd(12)}${row.behavior}`),
  ].join("\n").trim();
}
