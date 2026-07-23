export function referencedLocalPaths(source, currentFile = "") {
  const text = String(source ?? "");
  const references = new Set();
  const patterns = [
    /!?(?:\[[^\]]*\])\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g,
    /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi,
    /\burl\(\s*["']?([^"')]+)["']?\s*\)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const target = match.slice(1).find((value) => typeof value === "string" && value.trim());
      const resolved = resolveLocalReference(target, currentFile);
      if (resolved) {
        references.add(resolved);
      }
    }
  }
  return references;
}

export function resolveLocalReference(value, currentFile = "") {
  let target = String(value ?? "").trim();
  if (!target || target.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) {
    return "";
  }
  try {
    target = decodeURIComponent(target);
  } catch {
    // Keep the original path when a repository filename contains a literal percent sign.
  }
  target = target.split(/[?#]/, 1)[0].replaceAll("\\", "/");
  const baseParts = target.startsWith("/")
    ? []
    : normalizePath(currentFile).split("/").slice(0, -1);
  return normalizeSegments([...baseParts, ...target.replace(/^\/+/, "").split("/")]);
}

function normalizeSegments(segments) {
  const resolved = [];
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join("/");
}

function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}
