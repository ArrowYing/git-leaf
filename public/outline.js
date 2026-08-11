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
    .filter((item) => item.id && item.title && item.level >= 1 && item.level <= 5);

  const levelOneItems = items.filter((item) => item.level === 1);
  const hasDocumentTitle = levelOneItems.length === 1 && items[0] === levelOneItems[0];
  const visibleItems = hasDocumentTitle ? items.slice(1) : items;
  const levelStack = [];

  return visibleItems.map((item) => {
    while (levelStack.length > 0 && item.level <= levelStack[levelStack.length - 1]) {
      levelStack.pop();
    }
    levelStack.push(item.level);
    return {
      ...item,
      depth: levelStack.length,
    };
  });
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

export function createOutlineActiveViewportState() {
  let documentPath = "";
  let activeId;

  return {
    transition({
      documentPath: nextDocumentPath = "",
      activeId: nextActiveId,
      preserveViewport = false,
    } = {}) {
      const previousActiveId = nextDocumentPath === documentPath ? activeId : undefined;
      documentPath = nextDocumentPath;
      activeId = nextActiveId;

      if (preserveViewport) {
        return "preserve";
      }
      if (nextActiveId && nextActiveId !== previousActiveId) {
        return "center";
      }
      if (!nextActiveId && previousActiveId) {
        return "top";
      }
      return "preserve";
    },
    reset() {
      documentPath = "";
      activeId = undefined;
    },
  };
}

function headingLevel(tagName) {
  const match = String(tagName).match(/^H([1-6])$/i);
  return match ? Number(match[1]) : 0;
}
