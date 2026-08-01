export const MDX_LITE_COMPONENT_NAMES = Object.freeze([
  "DataTable",
  "Timeline",
  "Chart",
  "DecisionBox",
  "MetricGrid",
  "FlowDiagram",
]);

const MDX_LITE_COMPONENT_NAME_SET = new Set(MDX_LITE_COMPONENT_NAMES);
const MAX_OPENING_LINES = 100;
const MAX_OPENING_CHARACTERS = 32 * 1024;

export function mdxLiteComponentOpeningAtLines(lines, startIndex = 0) {
  if (!Array.isArray(lines) || !Number.isInteger(startIndex) || startIndex < 0) {
    return null;
  }

  let source = "";
  const lastIndex = Math.min(lines.length, startIndex + MAX_OPENING_LINES);
  for (let lineIndex = startIndex; lineIndex < lastIndex; lineIndex += 1) {
    source += `${lineIndex === startIndex ? "" : "\n"}${String(lines[lineIndex] ?? "")}`;
    if (source.length > MAX_OPENING_CHARACTERS) {
      return null;
    }

    const normalized = source.trimStart();
    const nameMatch = normalized.match(/^<([A-Z][A-Za-z0-9]*)\b/);
    if (!nameMatch || !MDX_LITE_COMPONENT_NAME_SET.has(nameMatch[1])) {
      return null;
    }
    const tagEnd = unquotedTagEnd(normalized);
    if (tagEnd < 0) {
      continue;
    }
    if (normalized.slice(tagEnd + 1).trim()) {
      return null;
    }

    const beforeEnd = normalized.slice(0, tagEnd).trimEnd();
    const selfClosing = beforeEnd.endsWith("/");
    const attributesEnd = selfClosing ? beforeEnd.length - 1 : beforeEnd.length;
    const rawAttributes = beforeEnd.slice(nameMatch[0].length, attributesEnd).trim();
    return {
      name: nameMatch[1],
      rawAttributes,
      attributes: parseMdxLiteAttributes(rawAttributes),
      selfClosing,
      endIndex: lineIndex,
    };
  }

  return null;
}

export function mdxLiteComponentBlockAtLines(lines, startIndex = 0) {
  const opening = mdxLiteComponentOpeningAtLines(lines, startIndex);
  if (!opening) {
    return null;
  }
  if (opening.selfClosing) {
    return {
      component: opening.name,
      openingEndIndex: opening.endIndex,
      endIndex: opening.endIndex,
      rawAttributes: opening.rawAttributes,
      attributes: opening.attributes,
      selfClosing: true,
    };
  }

  for (let lineIndex = opening.endIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    if (String(lines[lineIndex] ?? "").trim() === `</${opening.name}>`) {
      return {
        component: opening.name,
        openingEndIndex: opening.endIndex,
        endIndex: lineIndex,
        rawAttributes: opening.rawAttributes,
        attributes: opening.attributes,
        selfClosing: false,
      };
    }
  }
  return null;
}

export function parseMdxLiteAttributes(rawAttributes) {
  const attributes = {};
  const attributeRe = /([A-Za-z_][A-Za-z0-9_-]*)=(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g;
  for (const match of String(rawAttributes ?? "").matchAll(attributeRe)) {
    attributes[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function unquotedTagEnd(source) {
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") {
      return index;
    }
  }
  return -1;
}
