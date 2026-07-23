export function outlineItemsFromHeadings(headings) {
  const items = headings
    .map((heading) => {
      const sourceLine = Number(heading.sourceLine);
      return {
        id: heading.id,
        title: heading.text?.trim() ?? "",
        level: headingLevel(heading.tagName),
        ...(Number.isInteger(sourceLine) ? { sourceLine } : {}),
      };
    })
    .filter((item) => item.id && item.title && item.level >= 1 && item.level <= 3);

  const levelOneItems = items.filter((item) => item.level === 1);
  const hasDocumentTitle = levelOneItems.length === 1 && items[0] === levelOneItems[0];
  const visibleItems = hasDocumentTitle ? items.slice(1) : items;
  const baseLevel = hasDocumentTitle || levelOneItems.length === 0 ? 2 : 1;

  return visibleItems.map((item) => ({
    ...item,
    depth: Math.max(1, item.level - baseLevel + 1),
  }));
}

export function activeOutlineIdForSourceLine(sourceLine, outlineItems) {
  const items = [...outlineItems];
  const fallback = items[0]?.id;
  if (!Number.isInteger(sourceLine)) {
    return fallback;
  }

  const lineItems = items
    .filter((item) => Number.isInteger(item.sourceLine))
    .sort((left, right) => left.sourceLine - right.sourceLine);
  if (lineItems.length === 0) {
    return fallback;
  }

  let activeId;
  for (const item of lineItems) {
    if (item.sourceLine > sourceLine) {
      return activeId;
    }
    activeId = item.id;
  }
  return activeId;
}

export function createOutlineClickViewportGuard() {
  let active = false;

  return {
    begin() {
      active = true;
    },
    end() {
      active = false;
    },
    preserveForContentScroll() {
      return active;
    },
    isActive() {
      return active;
    },
  };
}

function headingLevel(tagName) {
  const match = String(tagName).match(/^H([1-6])$/i);
  return match ? Number(match[1]) : 0;
}
