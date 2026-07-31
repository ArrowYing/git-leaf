const HAN_CHARACTER_RE = /\p{Script=Han}/u;

export function treeFilePresentation(node) {
  const filename = String(node?.name ?? "");
  const title = displayedTreeFileTitle(node);
  return {
    filename,
    title,
    lines: [
      { kind: "filename", text: filename },
      ...(title ? [{ kind: "title", text: title }] : []),
    ],
  };
}

export function displayedTreeFileTitle(node) {
  const filename = String(node?.name ?? "");
  if (String(node?.kind ?? "") !== "markdown" || treeFilenameContainsHan(filename)) {
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
