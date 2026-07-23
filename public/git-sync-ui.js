export function hasGitChangesChanged(previousChanges, nextChanges) {
  const previous = Array.isArray(previousChanges) ? previousChanges : [];
  const next = Array.isArray(nextChanges) ? nextChanges : [];
  if (previous.length !== next.length) {
    return true;
  }

  return previous.some((change, index) => {
    const nextChange = next[index];
    return change?.path !== nextChange?.path
      || change?.oldPath !== nextChange?.oldPath
      || change?.status !== nextChange?.status
      || change?.rawStatus !== nextChange?.rawStatus;
  });
}
