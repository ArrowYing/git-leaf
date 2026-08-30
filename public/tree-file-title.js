const HAN_CHARACTER_RE = /\p{Script=Han}/u;

export function treeFilePresentation(node, { showDocumentTitles = true } = {}) {
  const filename = String(node?.name ?? "");
  const title = displayedTreeFileTitle(node, { showDocumentTitles });
  return {
    filename,
    title,
    lines: [
      { kind: "filename", text: filename },
      ...(title ? [{ kind: "title", text: title }] : []),
    ],
  };
}

export function treeDirectoryPresentation(node, { parentPath = "", view = "all" } = {}) {
  const name = String(node?.name ?? "");
  const path = normalizeTreePath(node?.path || [parentPath, name].filter(Boolean).join("/"));
  const parent = directoryParentPath(path);
  const showParentPath = view === "favorites"
    && !String(parentPath ?? "").trim()
    && Boolean(parent);
  return {
    name,
    parentPath: showParentPath ? parent : "",
    lines: [
      { kind: "name", text: name },
      ...(showParentPath ? [{ kind: "parent", text: parent }] : []),
    ],
  };
}

export function displayedTreeFileTitle(node, { showDocumentTitles = true } = {}) {
  const filename = String(node?.name ?? "");
  if (
    showDocumentTitles === false
    || String(node?.kind ?? "") !== "markdown"
    || treeFilenameContainsHan(filename)
  ) {
    return "";
  }

  const title = String(node?.title ?? "").trim();
  if (!title || title === filename || title === filenameStem(filename)) {
    return "";
  }
  return title;
}

export function treeFileCanShowDocumentTitle(file) {
  const filename = String(file?.name ?? basename(file?.path));
  return String(file?.kind ?? "") === "markdown" && !treeFilenameContainsHan(filename);
}

export function treeFilenameContainsHan(filename) {
  return HAN_CHARACTER_RE.test(filenameStem(filename));
}

function filenameStem(filename) {
  return String(filename ?? "").replace(/\.(?:md|mdx)$/i, "");
}

function basename(value) {
  return String(value ?? "").replaceAll("\\", "/").split("/").at(-1) ?? "";
}

function normalizeTreePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

function directoryParentPath(path) {
  const normalized = normalizeTreePath(path);
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}
