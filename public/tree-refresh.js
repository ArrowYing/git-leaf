export function hasTreeChanged(previousTree, nextTree) {
  return JSON.stringify(previousTree) !== JSON.stringify(nextTree);
}
