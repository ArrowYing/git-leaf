import { createHash } from "node:crypto";
import path from "node:path";

export function desktopRepositoryPanelItems(repoRoots, activeRepositoryRoot = "") {
  const roots = normalizedRepositoryRoots(repoRoots);
  const names = roots.map((repoRoot) => path.basename(repoRoot));
  const duplicateNames = new Set(
    names.filter((name, index) => names.indexOf(name) !== index),
  );

  return roots.map((repoRoot, index) => ({
    id: desktopRepositoryPanelId(repoRoot),
    name: names[index],
    context: duplicateNames.has(names[index])
      ? path.basename(path.dirname(repoRoot))
      : "",
    current: repoRoot === activeRepositoryRoot,
  }));
}

export function desktopRepositoryRootForPanelId(repoRoots, repositoryId) {
  const id = String(repositoryId ?? "").trim();
  if (!/^[a-f0-9]{16}$/u.test(id)) {
    return "";
  }
  return normalizedRepositoryRoots(repoRoots).find(
    (repoRoot) => desktopRepositoryPanelId(repoRoot) === id,
  ) ?? "";
}

export function desktopRepositoryPanelShortcutFromInput(input, { open = false } = {}) {
  if (!open || (input?.type && input.type !== "keyDown")) {
    return null;
  }
  const primary = input?.meta === true || input?.control === true;
  if (!primary || input?.shift === true || input?.alt === true) {
    return null;
  }
  const digitMatch = /^Digit([0-9])$/u.exec(String(input?.code || ""));
  if (!digitMatch) {
    return null;
  }
  const shortcut = Number(digitMatch[1]);
  return shortcut === 0
    ? { command: "repository-panel-open-another" }
    : { command: "repository-panel-switch-shortcut", shortcut };
}

export function desktopRepositoryPanelId(repoRoot) {
  const normalizedRoot = path.normalize(String(repoRoot ?? "").trim());
  if (!normalizedRoot) {
    return "";
  }
  return createHash("sha256").update(normalizedRoot).digest("hex").slice(0, 16);
}

function normalizedRepositoryRoots(repoRoots) {
  return Array.isArray(repoRoots)
    ? repoRoots.filter((repoRoot) => typeof repoRoot === "string" && repoRoot.trim())
    : [];
}
