export function repositoryAtIndex(repoRoots, index) {
  if (!Array.isArray(repoRoots) || !Number.isInteger(index) || index < 0) {
    return "";
  }
  const repoRoot = repoRoots[index];
  return typeof repoRoot === "string" ? repoRoot : "";
}

export function adjacentRepository(repoRoots, activeRepoRoot, direction) {
  if (!Array.isArray(repoRoots) || repoRoots.length === 0) {
    return "";
  }
  const step = direction < 0 ? -1 : 1;
  const activeIndex = repoRoots.indexOf(activeRepoRoot);
  if (activeIndex < 0) {
    return step < 0 ? repoRoots.at(-1) : repoRoots[0];
  }
  return repoRoots[(activeIndex + step + repoRoots.length) % repoRoots.length];
}

export function repositoryAfterClose(repoRoots, closingRepoRoot) {
  if (!Array.isArray(repoRoots) || repoRoots.length === 0) {
    return "";
  }
  const closingIndex = repoRoots.indexOf(closingRepoRoot);
  if (closingIndex < 0) {
    return "";
  }
  const remainingRepoRoots = repoRoots.filter((repoRoot) => repoRoot !== closingRepoRoot);
  if (remainingRepoRoots.length === 0) {
    return "";
  }
  return remainingRepoRoots[Math.min(closingIndex, remainingRepoRoots.length - 1)] ?? "";
}
