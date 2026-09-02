export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((item) => item.some((cellValue) => cellValue.length > 0));
}

export function csvMarkdownDocumentLink(value) {
  const markdown = String(value ?? "").trim();
  const match = /^\[((?:\\.|[^\\\]\r\n])+)\]\(([^)\r\n]+)\)$/u.exec(markdown);
  if (!match) return null;

  const href = match[2].trim();
  const pathPart = href.split(/[?#]/u, 1)[0];
  if (
    !href
    || href.startsWith("/")
    || href.includes("\\")
    || /^[a-z][a-z0-9+.-]*:/iu.test(href)
    || !/\.mdx?$/iu.test(pathPart)
  ) {
    return null;
  }

  return {
    text: match[1].replace(/\\([\\\[\]`*_])/gu, "$1"),
    href,
  };
}
