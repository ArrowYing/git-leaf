import { elementIsOverflowing } from "./ui-tooltip.js";

export function createTreeItemTooltipSource({
  container,
  nameRangesForItem = () => [],
  searchDetailsForItem = () => null,
  delay = 250,
} = {}) {
  function itemFromTarget(target) {
    const item = target?.closest?.("[data-tree-item]");
    return item && container?.contains?.(item) ? item : null;
  }

  function labelElement(item) {
    if (item?.dataset.treeItem === "file") {
      return item.querySelector?.(".tree-file-label") || item;
    }
    if (item?.dataset.treeItem === "directory") {
      return item.querySelector?.(".tree-directory-label") || item;
    }
    return item;
  }

  function details(item) {
    const searchDetails = searchDetailsForItem(item);
    if (String(searchDetails?.name ?? "").trim()) {
      return searchDetails;
    }
    const label = labelElement(item);
    const name = label?.textContent?.trim() || "";
    return {
      name,
      nameRanges: nameRangesForItem(item, name),
      path: "",
    };
  }

  function key(item) {
    const itemDetails = details(item);
    return `${item?.dataset.treeItem || ""}:${item?.dataset.treePath || itemDetails.name}`;
  }

  return {
    name: "file-tree",
    container,
    itemFromTarget,
    details,
    key,
    anchorElement: labelElement,
    describedElement: (item) => item,
    shouldShow: (item) => (
      Boolean(String(searchDetailsForItem(item)?.name ?? "").trim())
      || elementIsOverflowing(labelElement(item))
    ),
    placement: "expansion",
    variant: "expansion",
    delay,
  };
}
