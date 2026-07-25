import MarkdownIt from "markdown-it";

import { createTranslator } from "../public/i18n.js";
import { mdxLiteBlockRule, renderMdxLiteComponent } from "./mdx-lite.mjs";
import {
  renderTableToolbar,
  tableCardAttributeString,
  tableComplexityAttributes,
} from "./table-complexity.mjs";
import {
  renderTableColgroup,
  tableLayoutAttributes,
  tableScrollAttributeString,
} from "./table-layout.mjs";

const FRONT_MATTER_RE = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/;
const MARKDOWN_MESSAGES = Object.freeze({
  en: Object.freeze({
    "sourceLine.select": "Select line {line}",
    "sourceLine.gutter": "Source line numbers",
  }),
  "zh-CN": Object.freeze({
    "sourceLine.select": "选择第 {line} 行",
    "sourceLine.gutter": "源文件行号",
  }),
});

export function renderMarkdown(markdown, options = {}) {
  const { source, lineOffset } = stripFrontmatter(markdown);
  const translate = createTranslator(MARKDOWN_MESSAGES, options.locale);
  const renderer = createRenderer({
    ...options,
    locale: translate.locale,
  });
  return renderer.render(source, { lineOffset, translate });
}

export function extractTitle(markdown, fallbackPath) {
  const frontmatterTitle = extractFrontmatterScalar(markdown, "title");
  if (frontmatterTitle) {
    return frontmatterTitle;
  }

  const heading = markdown.replace(FRONT_MATTER_RE, "").match(/^#\s+(.+?)\s*$/m);
  if (heading) {
    return plainText(heading[1]);
  }

  return posixBasename(fallbackPath);
}

export function extractFrontmatterScalar(markdown, key) {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(String(key ?? ""))) {
    return "";
  }
  const frontmatter = String(markdown ?? "").match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)?.[1];
  if (!frontmatter) {
    return "";
  }

  for (const line of frontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (!match || match[1] !== key || !match[2] || /^[|>][+-]?\d?$/.test(match[2])) {
      continue;
    }

    return stripYamlScalarQuotes(match[2].trim());
  }

  return "";
}

function stripYamlScalarQuotes(value) {
  const text = String(value ?? "").trim();
  const quote = text[0];
  if ((quote === '"' || quote === "'") && text.endsWith(quote)) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function createRenderer(options) {
  const renderer = new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
  });

  const originalLinkOpen =
    renderer.renderer.rules.link_open ?? renderToken(renderer, "link_open");
  const originalImage =
    renderer.renderer.rules.image ?? renderToken(renderer, "image");
  const originalFence =
    renderer.renderer.rules.fence ?? renderToken(renderer, "fence");
  const originalCodeBlock =
    renderer.renderer.rules.code_block ?? renderToken(renderer, "code_block");
  const originalBulletListOpen =
    renderer.renderer.rules.bullet_list_open ?? renderToken(renderer, "bullet_list_open");
  const originalBulletListClose =
    renderer.renderer.rules.bullet_list_close ?? renderToken(renderer, "bullet_list_close");
  const originalOrderedListOpen =
    renderer.renderer.rules.ordered_list_open ?? renderToken(renderer, "ordered_list_open");
  const originalOrderedListClose =
    renderer.renderer.rules.ordered_list_close ?? renderToken(renderer, "ordered_list_close");
  const originalListItemOpen =
    renderer.renderer.rules.list_item_open ?? renderToken(renderer, "list_item_open");
  const originalBlockquoteOpen =
    renderer.renderer.rules.blockquote_open ?? renderToken(renderer, "blockquote_open");
  const originalBlockquoteClose =
    renderer.renderer.rules.blockquote_close ?? renderToken(renderer, "blockquote_close");

  renderer.block.ruler.before("paragraph", "mdx_lite_component", mdxLiteBlockRule, {
    alt: ["paragraph", "reference", "blockquote"],
  });
  renderer.block.ruler.before("paragraph", "safe_image_html", safeImageHtmlBlockRule, {
    alt: ["paragraph"],
  });
  renderer.block.ruler.before("paragraph", "safe_image_gallery_html", safeImageGalleryHtmlBlockRule, {
    alt: ["paragraph"],
  });
  renderer.inline.ruler.before("html_inline", "safe_image_html_inline", safeImageHtmlInlineRule);
  renderer.inline.ruler.before("html_inline", "safe_html_break_inline", safeHtmlBreakInlineRule);

  renderer.renderer.rules.mdx_lite_component = (tokens, index, rendererOptions, env) =>
    sourceBlockOpen(tokens[index], env) +
    renderMdxLiteComponent(tokens[index], { locale: options.locale }) +
    sourceBlockClose();

  renderer.renderer.rules.safe_image_html = (tokens, index, rendererOptions, env) =>
    sourceBlockOpen(tokens[index], env) +
    renderSafeImageHtml(tokens[index].content, options) +
    sourceBlockClose();

  renderer.renderer.rules.safe_image_gallery_html = (tokens, index, rendererOptions, env) =>
    sourceBlockOpen(tokens[index], env) +
    renderSafeImageGalleryHtml(tokens[index].content, options) +
    sourceBlockClose();

  renderer.renderer.rules.safe_image_html_inline = (tokens, index) =>
    renderSafeImageHtml(tokens[index].content, options, { inline: true });

  renderer.renderer.rules.safe_html_break_inline = () => "<br>";

  renderer.renderer.rules.heading_open = (tokens, index, rendererOptions, env, self) => {
    const nextToken = tokens[index + 1];
    const text = nextToken?.type === "inline" ? nextToken.content : "section";
    tokens[index].attrSet("id", uniqueHeadingId(plainText(text), env));
    return sourceBlockOpen(tokens[index], env) + self.renderToken(tokens, index, rendererOptions);
  };

  renderer.renderer.rules.heading_close = (tokens, index, rendererOptions, env, self) =>
    self.renderToken(tokens, index, rendererOptions) + sourceBlockClose();

  renderer.renderer.rules.paragraph_open = (tokens, index, rendererOptions, env, self) => {
    if (tokens[index].hidden || env.listDepth > 0 || env.blockquoteDepth > 0) {
      return self.renderToken(tokens, index, rendererOptions);
    }
    return sourceBlockOpen(tokens[index], env) + self.renderToken(tokens, index, rendererOptions);
  };

  renderer.renderer.rules.paragraph_close = (tokens, index, rendererOptions, env, self) => {
    if (tokens[index].hidden || env.listDepth > 0 || env.blockquoteDepth > 0) {
      return self.renderToken(tokens, index, rendererOptions);
    }
    return self.renderToken(tokens, index, rendererOptions) + sourceBlockClose();
  };

  renderer.renderer.rules.link_open = (tokens, index, rendererOptions, env, self) => {
    const href = tokens[index].attrGet("href");
    if (href) {
      tokens[index].attrSet("href", transformDestination(href, options, "link"));
    }
    return originalLinkOpen(tokens, index, rendererOptions, env, self);
  };

  renderer.renderer.rules.image = (tokens, index, rendererOptions, env, self) => {
    const src = tokens[index].attrGet("src");
    if (src) {
      tokens[index].attrSet("src", transformDestination(src, options, "asset"));
    }
    tokens[index].attrJoin("class", "git-leaf-image");
    tokens[index].attrSet("data-git-leaf-image", "true");
    tokens[index].attrSet("data-image-align", "left");
    return [
      '<span class="git-leaf-image-frame is-align-left" data-image-align="left">',
      originalImage(tokens, index, rendererOptions, env, self),
      "</span>",
    ].join("");
  };

  renderer.renderer.rules.fence = (tokens, index, rendererOptions, env, self) =>
    sourceBlockOpen(tokens[index], env) +
    originalFence(tokens, index, rendererOptions, env, self) +
    sourceBlockClose();

  renderer.renderer.rules.code_block = (tokens, index, rendererOptions, env, self) =>
    sourceBlockOpen(tokens[index], env) +
    originalCodeBlock(tokens, index, rendererOptions, env, self) +
    sourceBlockClose();

  renderer.renderer.rules.bullet_list_open = (tokens, index, rendererOptions, env, self) => {
    const shouldWrapList = beginList(env, tokens[index]);
    return (shouldWrapList ? sourceBlockOpen(tokens[index], env, {
      lineLayout: "list",
      lines: listItemSourceLines(tokens, index, env),
    }) : "") +
      originalBulletListOpen(tokens, index, rendererOptions, env, self);
  };

  renderer.renderer.rules.bullet_list_close = (tokens, index, rendererOptions, env, self) => {
    const shouldWrapList = endList(env);
    return originalBulletListClose(tokens, index, rendererOptions, env, self) +
      (shouldWrapList ? sourceBlockClose() : "");
  };

  renderer.renderer.rules.ordered_list_open = (tokens, index, rendererOptions, env, self) => {
    const shouldWrapList = beginList(env, tokens[index]);
    return (shouldWrapList ? sourceBlockOpen(tokens[index], env, {
      lineLayout: "list",
      lines: listItemSourceLines(tokens, index, env),
    }) : "") +
      originalOrderedListOpen(tokens, index, rendererOptions, env, self);
  };

  renderer.renderer.rules.ordered_list_close = (tokens, index, rendererOptions, env, self) => {
    const shouldWrapList = endList(env);
    return originalOrderedListClose(tokens, index, rendererOptions, env, self) +
      (shouldWrapList ? sourceBlockClose() : "");
  };

  renderer.renderer.rules.list_item_open = (tokens, index, rendererOptions, env, self) => {
    const sourceLine = listItemSourceLine(tokens[index], env);
    if (Number.isInteger(sourceLine)) {
      tokens[index].attrSet("data-source-list-line", String(sourceLine));
    }
    return originalListItemOpen(tokens, index, rendererOptions, env, self);
  };

  renderer.renderer.rules.blockquote_open = (tokens, index, rendererOptions, env, self) => {
    const shouldWrapBlockquote = beginBlockquote(env, tokens[index]);
    return (shouldWrapBlockquote ? sourceBlockOpen(tokens[index], env) : "") +
      originalBlockquoteOpen(tokens, index, rendererOptions, env, self);
  };

  renderer.renderer.rules.blockquote_close = (tokens, index, rendererOptions, env, self) => {
    const shouldWrapBlockquote = endBlockquote(env);
    return originalBlockquoteClose(tokens, index, rendererOptions, env, self) +
      (shouldWrapBlockquote ? sourceBlockClose() : "");
  };

  renderer.renderer.rules.table_open = (tokens, index, rendererOptions, env) => {
    const shape = tableShapeFromTokens(tokens, index);
    const attributes = tableComplexityAttributes(shape);
    const layout = tableLayoutAttributes(shape);
    return [
      sourceBlockOpen(tokens[index], env),
      `<div ${tableCardAttributeString(attributes, layout)}>`,
      renderTableToolbar(attributes, { locale: options.locale }),
      `<div ${tableScrollAttributeString(layout)}><table>`,
      renderTableColgroup(layout),
    ].join("");
  };

  renderer.renderer.rules.table_close = () => "</table></div></div>" + sourceBlockClose();

  return renderer;
}

function stripFrontmatter(markdown) {
  const match = markdown.match(FRONT_MATTER_RE);
  if (!match) {
    return { source: markdown, lineOffset: 0 };
  }

  return {
    source: markdown.slice(match[0].length),
    lineOffset: match[0].match(/\n/g)?.length ?? 0,
  };
}

function safeImageHtmlBlockRule(state, startLine, _endLine, silent) {
  const line = blockSourceLine(state, startLine).trim();
  if (!/^<img\b[^>]*>\s*$/i.test(line)) {
    return false;
  }

  if (silent) {
    return true;
  }

  const token = state.push("safe_image_html", "", 0);
  token.block = true;
  token.map = [startLine, startLine + 1];
  token.content = line;
  state.line = startLine + 1;
  return true;
}

function safeImageGalleryHtmlBlockRule(state, startLine, _endLine, silent) {
  const line = blockSourceLine(state, startLine).trim();
  const match = /^<p>\s*((?:<img\b[^<>]*>\s*)+)<\/p>\s*$/i.exec(line);
  if (!match) {
    return false;
  }

  if (silent) {
    return true;
  }

  const token = state.push("safe_image_gallery_html", "", 0);
  token.block = true;
  token.map = [startLine, startLine + 1];
  token.content = match[1];
  state.line = startLine + 1;
  return true;
}

function safeImageHtmlInlineRule(state, silent) {
  const match = /^<img\b[^<>]*>/i.exec(state.src.slice(state.pos));
  if (!match) {
    return false;
  }

  if (!silent) {
    const token = state.push("safe_image_html_inline", "", 0);
    token.content = match[0];
  }
  state.pos += match[0].length;
  return true;
}

function safeHtmlBreakInlineRule(state, silent) {
  const match = /^<br\s*\/?\s*>/i.exec(state.src.slice(state.pos));
  if (!match) {
    return false;
  }

  if (!silent) {
    state.push("safe_html_break_inline", "br", 0);
  }
  state.pos += match[0].length;
  return true;
}

function blockSourceLine(state, line) {
  const start = state.bMarks[line] + state.tShift[line];
  const end = state.eMarks[line];
  return state.src.slice(start, end);
}

function renderSafeImageHtml(rawTag, options, { inline = false } = {}) {
  const attributes = parseHtmlAttributes(rawTag);
  const src = attributes.src?.trim();
  if (!src) {
    return escapeHtml(rawTag);
  }

  const alt = attributes.alt ?? "";
  const align = normalizeImageAlign(attributes["data-align"]);
  const width = normalizeImageWidth(attributes.width);
  const height = normalizeImageHeight(attributes.height);
  const caption = normalizeImageCaption(attributes["data-caption"]);
  const transformedSrc = transformDestination(src, options, "asset");
  const imageAttributes = [
    'class="git-leaf-image"',
    'data-git-leaf-image="true"',
    `data-image-align="${align}"`,
    caption ? `data-image-caption="${escapeAttribute(caption)}"` : "",
    `src="${escapeAttribute(transformedSrc)}"`,
    `alt="${escapeAttribute(alt)}"`,
    width ? `width="${escapeAttribute(width)}"` : "",
    height ? `height="${escapeAttribute(height)}"` : "",
  ].filter(Boolean);

  const frameTag = inline ? "span" : "figure";
  const captionTag = inline ? "span" : "figcaption";
  return [
    `<${frameTag} class="git-leaf-image-frame is-align-${align}" data-image-align="${align}">`,
    `<img ${imageAttributes.join(" ")}>`,
    caption ? `<${captionTag} class="git-leaf-image-caption">${escapeHtml(caption)}</${captionTag}>` : "",
    `</${frameTag}>`,
  ].join("");
}

function renderSafeImageGalleryHtml(rawImages, options) {
  const images = [...rawImages.matchAll(/<img\b[^<>]*>/gi)]
    .map((match) => renderSafeImageHtml(match[0], options, { inline: true }));
  return `<div class="git-leaf-image-gallery">${images.join("")}</div>`;
}

function parseHtmlAttributes(rawTag) {
  const attributes = {};
  const attributeRe = /([A-Za-z_:][A-Za-z0-9_:.:-]*)=(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g;
  for (const match of rawTag.matchAll(attributeRe)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function normalizeImageAlign(value) {
  const align = String(value ?? "").trim().toLowerCase();
  return align === "center" ? "center" : "left";
}

function normalizeImageWidth(value) {
  const width = String(value ?? "").trim();
  if (/^\d{2,4}$/.test(width)) {
    return String(Math.min(Math.max(Number(width), 80), 2000));
  }
  return "";
}

function normalizeImageHeight(value) {
  const height = String(value ?? "").trim();
  if (/^\d{2,4}$/.test(height)) {
    return String(Math.min(Math.max(Number(height), 40), 2000));
  }
  return "";
}

function normalizeImageCaption(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 240);
}

function sourceBlockOpen(token, env, { lineLayout = "", lines = null } = {}) {
  if (!token.map) {
    return "";
  }

  const fallbackStart = token.map[0] + (env.lineOffset ?? 0) + 1;
  const fallbackEnd = token.map[1] + (env.lineOffset ?? 0);
  const lineNumbers = Array.isArray(lines) && lines.length > 0
    ? [...new Set(lines)].filter(Number.isInteger).sort((left, right) => left - right)
    : Array.from({ length: fallbackEnd - fallbackStart + 1 }, (_, index) => fallbackStart + index);
  const start = lineNumbers[0] ?? fallbackStart;
  const end = lineNumbers.at(-1) ?? fallbackEnd;
  const buttons = [];
  const translate = typeof env.translate === "function"
    ? env.translate
    : createTranslator(MARKDOWN_MESSAGES, "en");
  for (const line of lineNumbers) {
    const lineLabel = escapeAttribute(translate("sourceLine.select", { line }));
    buttons.push(
      `<button type="button" class="source-line-button" data-source-line="${line}" title="${lineLabel}" aria-label="${lineLabel}">${line}</button>`,
    );
  }

  const lineLayoutAttribute = lineLayout ? ` data-source-line-layout="${escapeAttribute(lineLayout)}"` : "";

  return [
    `<div class="source-block" data-source-start="${start}" data-source-end="${end}">`,
    `<div class="source-line-gutter"${lineLayoutAttribute} aria-label="${escapeAttribute(translate("sourceLine.gutter"))}">`,
    buttons.join(""),
    "</div>",
    '<div class="source-block-content">',
  ].join("");
}

function sourceBlockClose() {
  return "</div></div>";
}

function listItemSourceLines(tokens, startIndex, env) {
  const lines = [];
  let nestedListDepth = 0;
  for (let index = startIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      nestedListDepth += 1;
      continue;
    }

    if (token.type === "bullet_list_close" || token.type === "ordered_list_close") {
      if (nestedListDepth === 0) {
        break;
      }
      nestedListDepth -= 1;
      continue;
    }

    const line = listItemSourceLine(token, env);
    if (Number.isInteger(line)) {
      lines.push(line);
    }
  }
  return lines;
}

function listItemSourceLine(token, env) {
  return token.type === "list_item_open" && token.map
    ? token.map[0] + (env.lineOffset ?? 0) + 1
    : null;
}

function tableShapeFromTokens(tokens, startIndex) {
  let rowCount = 0;
  let columnCount = 0;
  let currentRowColumns = 0;
  let inBody = false;
  let inHeader = false;
  let activeColumn = -1;
  const cells = [];
  const columns = [];
  const cellsByColumn = [];

  for (let index = startIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "table_close") {
      break;
    }
    if (token.type === "thead_open") {
      inHeader = true;
      continue;
    }
    if (token.type === "thead_close") {
      inHeader = false;
      continue;
    }
    if (token.type === "tbody_open") {
      inBody = true;
      continue;
    }
    if (token.type === "tbody_close") {
      inBody = false;
      continue;
    }
    if (token.type === "tr_open") {
      currentRowColumns = 0;
      activeColumn = -1;
      continue;
    }
    if (token.type === "th_open" || token.type === "td_open") {
      activeColumn = currentRowColumns;
      currentRowColumns += 1;
      continue;
    }
    if (token.type === "th_close" || token.type === "td_close") {
      activeColumn = -1;
      continue;
    }
    if (token.type === "inline") {
      cells.push(token.content);
      if (activeColumn >= 0) {
        cellsByColumn[activeColumn] ??= [];
        cellsByColumn[activeColumn].push(token.content);
        if (inHeader && !columns[activeColumn]) {
          columns[activeColumn] = token.content;
        }
      }
      continue;
    }
    if (token.type === "tr_close") {
      if (inHeader) {
        columnCount = Math.max(columnCount, currentRowColumns);
      }
      if (inBody) {
        rowCount += 1;
      }
      columnCount = Math.max(columnCount, currentRowColumns);
    }
  }

  return {
    rows: rowCount,
    columns: columnCount,
    columnNames: Array.from({ length: columnCount }, (_, index) => columns[index] || `Column ${index + 1}`),
    cellsByColumn: Array.from({ length: columnCount }, (_, index) => cellsByColumn[index] ?? []),
    cells,
  };
}

function beginList(env, token) {
  const depth = env.listDepth ?? 0;
  const shouldWrapList = depth === 0 && Boolean(token.map);
  env.listDepth = depth + 1;
  env.listWrapStack ??= [];
  env.listWrapStack.push(shouldWrapList);
  return shouldWrapList;
}

function endList(env) {
  env.listDepth = Math.max((env.listDepth ?? 1) - 1, 0);
  return env.listWrapStack?.pop() ?? false;
}

function beginBlockquote(env, token) {
  const depth = env.blockquoteDepth ?? 0;
  const shouldWrapBlockquote = depth === 0 && (env.listDepth ?? 0) === 0 && Boolean(token.map);
  env.blockquoteDepth = depth + 1;
  env.blockquoteWrapStack ??= [];
  env.blockquoteWrapStack.push(shouldWrapBlockquote);
  return shouldWrapBlockquote;
}

function endBlockquote(env) {
  env.blockquoteDepth = Math.max((env.blockquoteDepth ?? 1) - 1, 0);
  return env.blockquoteWrapStack?.pop() ?? false;
}

function renderToken(renderer, tokenName) {
  return (tokens, index, options, env, self) =>
    self.renderToken(tokens, index, options);
}

function transformDestination(rawDestination, options, kind) {
  const destination = rawDestination.trim();
  if (kind === "link" && isGitLeafDocumentDestination(destination)) {
    return sanitizeGitLeafDocumentDestination(destination);
  }
  if (!options.currentFile || isExternalDestination(destination) || destination.startsWith("#")) {
    return destination;
  }

  const resolved = resolveRelativeRepoLink(options.currentFile, destination);
  const [pathPart, suffix = ""] = splitSuffix(resolved);

  if (kind === "link" && isMarkdownPath(pathPart)) {
    return withRepositoryQuery("/", {
      repo: options.currentRepo,
      file: pathPart,
      suffix,
    });
  }

  return withRepositoryQuery("/raw", {
    repo: options.currentRepo,
    file: pathPart,
    suffix,
  });
}

function withRepositoryQuery(pathname, { repo, file, suffix = "" }) {
  const query = new URLSearchParams();
  if (repo) {
    query.set("repo", repo);
  }
  query.set("file", file);
  return `${pathname}?${query.toString()}${suffix}`;
}

function isGitLeafDocumentDestination(destination) {
  try {
    if (!destination.startsWith("/") && !destination.startsWith("?")) {
      return false;
    }

    const url = new URL(destination, "http://git-leaf.local");
    const file = url.searchParams.get("file") ?? "";
    return url.pathname === "/" && /\.mdx?$/i.test(file);
  } catch {
    return false;
  }
}

function sanitizeGitLeafDocumentDestination(destination) {
  const url = new URL(destination, "http://git-leaf.local");
  const query = new URLSearchParams();
  for (const key of ["repo", "file"]) {
    const value = url.searchParams.get(key);
    if (value) {
      query.set(key, value);
    }
  }
  url.search = query.toString();
  return `${url.pathname}${url.search}${url.hash}`;
}

function resolveRelativeRepoLink(sourceRelativePath, destination) {
  if (isExternalDestination(destination) || destination.startsWith("#")) {
    return destination;
  }

  const [pathPart, suffix = ""] = splitDestinationSuffix(destination);
  if (!pathPart) {
    return destination;
  }

  const decodedPath = decodeURI(pathPart);
  const sourceDir = posixDirname(sourceRelativePath);
  const resolved = decodedPath.startsWith("/")
    ? posixNormalize(decodedPath.slice(1))
    : posixNormalize(`${sourceDir}/${decodedPath}`);
  if (resolved.startsWith("../") || resolved === "..") {
    return destination;
  }

  return encodeURI(resolved) + suffix;
}

function isMarkdownPath(value) {
  const extension = posixExtname(value).toLowerCase();
  return extension === ".md" || extension === ".mdx";
}

function isExternalDestination(destination) {
  const normalized = destination.trim().toLowerCase();
  return (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("mailto:") ||
    normalized.startsWith("tel:") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("//")
  );
}

function splitDestinationSuffix(destination) {
  const hashIndex = destination.indexOf("#");
  const queryIndex = destination.indexOf("?");
  const indexes = [hashIndex, queryIndex].filter((index) => index >= 0);
  if (indexes.length === 0) {
    return [destination, ""];
  }

  const splitIndex = Math.min(...indexes);
  return [destination.slice(0, splitIndex), destination.slice(splitIndex)];
}

function splitSuffix(destination) {
  const hashIndex = destination.indexOf("#");
  const queryIndex = destination.indexOf("?");
  const indexes = [hashIndex, queryIndex].filter((index) => index >= 0);
  if (indexes.length === 0) {
    return [destination, ""];
  }
  const splitIndex = Math.min(...indexes);
  return [destination.slice(0, splitIndex), destination.slice(splitIndex)];
}

function posixBasename(value) {
  const normalized = String(value ?? "").replace(/\/+$/g, "");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function posixDirname(value) {
  const normalized = String(value ?? "").replace(/\/+$/g, "");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : ".";
}

function posixExtname(value) {
  const pathPart = String(value ?? "").split(/[?#]/, 1)[0];
  const slashIndex = pathPart.lastIndexOf("/");
  const dotIndex = pathPart.lastIndexOf(".");
  return dotIndex > slashIndex ? pathPart.slice(dotIndex) : "";
}

function posixNormalize(value) {
  const segments = [];
  for (const part of String(value ?? "").split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else {
        segments.push(part);
      }
      continue;
    }
    segments.push(part);
  }

  return segments.join("/") || ".";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function plainText(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
}

function slugify(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

function uniqueHeadingId(value, env) {
  const baseId = slugify(value);
  const usedIds = env.headingIds ??= new Set();
  let id = baseId;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}
