import { formatLineRange } from "./line-selection.js";

export const AGENT_CONTEXT_STORAGE_PREFIX = "git-leaf-agent-context-v1";

export function agentContextScopeKey({ repoId, worktreeId } = {}) {
  const repo = String(repoId ?? "").trim();
  const worktree = String(worktreeId ?? repo).trim();
  if (!repo) {
    return "";
  }
  return `${AGENT_CONTEXT_STORAGE_PREFIX}:${encodeURIComponent(repo)}:${encodeURIComponent(worktree)}`;
}

export function createAgentContextItem({
  repoId,
  repoName,
  worktreeId,
  worktreeName,
  branch,
  revision,
  path,
  selectedLines,
  sourceLines,
} = {}) {
  const normalizedPath = String(path ?? "").trim();
  const lines = normalizeLineNumbers(selectedLines);
  if (!normalizedPath || lines.length === 0) {
    return null;
  }

  const sourceByLine = new Map(
    (Array.isArray(sourceLines) ? sourceLines : [])
      .map((line) => [Number(line?.number), String(line?.text ?? "")])
      .filter(([number]) => Number.isInteger(number) && number > 0),
  );

  return {
    id: `${normalizedPath}:${lines.join(",")}`,
    repoId: String(repoId ?? "").trim(),
    repoName: String(repoName ?? "").trim(),
    worktreeId: String(worktreeId ?? "").trim(),
    worktreeName: String(worktreeName ?? "").trim(),
    branch: String(branch ?? "").trim(),
    revision: String(revision ?? "").trim(),
    path: normalizedPath,
    selectedLines: lines,
    sourceLines: lines.map((number) => ({
      number,
      text: sourceByLine.get(number) ?? "",
    })),
  };
}

export function normalizeAgentContextItems(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const items = [];
  for (const candidate of value) {
    const item = createAgentContextItem(candidate);
    if (!item) {
      continue;
    }
    const existingIndex = items.findIndex((existing) => existing.id === item.id);
    if (existingIndex >= 0) {
      items[existingIndex] = item;
    } else {
      items.push(item);
    }
  }
  return items;
}

export function addAgentContextItem(items, item) {
  const normalized = normalizeAgentContextItems(items);
  const nextItem = createAgentContextItem(item);
  if (!nextItem) {
    return normalized;
  }
  const existingIndex = normalized.findIndex((existing) => existing.id === nextItem.id);
  if (existingIndex >= 0) {
    normalized[existingIndex] = nextItem;
    return normalized;
  }
  return [...normalized, nextItem];
}

export function removeAgentContextItem(items, itemId) {
  const id = String(itemId ?? "");
  return normalizeAgentContextItems(items).filter((item) => item.id !== id);
}

export function agentContextLineCount(items) {
  return normalizeAgentContextItems(items)
    .reduce((total, item) => total + item.selectedLines.length, 0);
}

export function agentContextItemLabel(item) {
  const normalized = createAgentContextItem(item);
  if (!normalized) {
    return "";
  }
  const fileName = normalized.path
    .split("/")
    .at(-1)
    ?.replace(/\.mdx?$/i, "") || normalized.path;
  const ranges = formatLineRange(normalized.selectedLines)
    .split(",")
    .filter(Boolean)
    .map((range) => `L${range.replace("-", "–")}`)
    .join(",");
  return ranges ? `${fileName} · ${ranges}` : fileName;
}

export function formatAgentContextMarkdown(items) {
  const normalized = normalizeAgentContextItems(items);
  if (normalized.length === 0) {
    return "";
  }

  const first = normalized[0];
  const output = ["# Agent Context", ""];
  appendMetadata(output, "Repository", first.repoName || first.repoId);
  appendMetadata(output, "Worktree", first.worktreeName || first.worktreeId);
  appendMetadata(output, "Branch", first.branch);
  appendMetadata(output, "Revision", first.revision);

  for (const item of normalized) {
    if (output.at(-1) !== "") {
      output.push("");
    }
    output.push(`## ${lineReference(item)}`, "", "```markdown");
    for (const line of item.sourceLines) {
      output.push(`${line.number} | ${line.text}`);
    }
    output.push("```");
  }

  return output.join("\n").trim();
}

export function readAgentContextItems({ storage, scopeKey } = {}) {
  if (!storage || !scopeKey) {
    return [];
  }
  try {
    return normalizeAgentContextItems(JSON.parse(storage.getItem(scopeKey) ?? "[]"));
  } catch {
    return [];
  }
}

export function writeAgentContextItems({ storage, scopeKey, items } = {}) {
  if (!storage || !scopeKey) {
    return false;
  }
  try {
    storage.setItem(scopeKey, JSON.stringify(normalizeAgentContextItems(items)));
    return true;
  } catch {
    return false;
  }
}

function normalizeLineNumbers(lines) {
  return [...new Set(Array.isArray(lines) ? lines : [])]
    .map(Number)
    .filter((line) => Number.isInteger(line) && line > 0)
    .sort((left, right) => left - right);
}

function lineReference(item) {
  const ranges = formatLineRange(item.selectedLines)
    .split(",")
    .filter(Boolean)
    .map((range) => range.includes("-") ? `L${range.replace("-", "-L")}` : `L${range}`)
    .join(",");
  return `${item.path}:${ranges}`;
}

function appendMetadata(output, label, value) {
  if (value) {
    output.push(`${label}: ${value}`);
  }
}
