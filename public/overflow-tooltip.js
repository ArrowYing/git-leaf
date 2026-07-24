export function createOverflowTooltip({
  tooltip,
  sources = [],
  boundsElement,
  isBlocked = () => false,
  delay = 120,
  windowTarget = globalThis.window,
  setTimer = windowTarget?.setTimeout?.bind(windowTarget) ?? setTimeout,
  clearTimer = windowTarget?.clearTimeout?.bind(windowTarget) ?? clearTimeout,
} = {}) {
  const normalizedSources = sources.filter((source) => source?.container);
  let timer = null;
  let pendingKey = "";
  let visibleKey = "";
  let scrollBlocked = false;
  let pointerX = null;
  let pointerY = null;
  const listeners = [];

  for (const source of normalizedSources) {
    listen(source.container, "pointerover", (event) => {
      const item = itemFromEvent(source, event);
      if (!item || item.contains?.(event.relatedTarget)) {
        return;
      }
      if (!scrollBlocked) {
        pointerX = event.clientX;
        pointerY = event.clientY;
      }
      schedule(source, item);
    });
    listen(source.container, "pointermove", (event) => {
      const item = itemFromEvent(source, event);
      if (!item) {
        return;
      }
      const pointerMoved = pointerX === null
        || pointerY === null
        || event.clientX !== pointerX
        || event.clientY !== pointerY;
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (scrollBlocked && !pointerMoved) {
        return;
      }
      scrollBlocked = false;
      const key = itemKey(source, item);
      if (!tooltip?.hidden && visibleKey === key) {
        return;
      }
      schedule(source, item);
    });
    listen(source.container, "pointerout", (event) => {
      const item = itemFromEvent(source, event);
      if (!item || item.contains?.(event.relatedTarget)) {
        return;
      }
      hide();
    });
    listen(source.container, "focusin", (event) => {
      const item = itemFromEvent(source, event);
      if (!item) {
        return;
      }
      scrollBlocked = false;
      schedule(source, item);
    });
    listen(source.container, "focusout", hide);
    listen(source.container, "scroll", () => {
      scrollBlocked = true;
      hide();
    });
  }
  listen(windowTarget, "resize", hide);

  function listen(target, type, handler) {
    if (!target?.addEventListener) {
      return;
    }
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  }

  function schedule(source, item) {
    if (
      !tooltip
      || scrollBlocked
      || isBlocked()
      || !elementIsOverflowing(labelElement(source, item))
    ) {
      hide();
      return;
    }

    const key = itemKey(source, item);
    if (pendingKey === key && timer) {
      return;
    }

    clearTimer(timer);
    pendingKey = key;
    timer = setTimer(() => {
      timer = null;
      pendingKey = "";
      show(source, item);
    }, delay);
  }

  function show(source, item) {
    if (
      !tooltip
      || isBlocked()
      || item?.isConnected === false
      || !elementIsOverflowing(labelElement(source, item))
    ) {
      hide();
      return;
    }

    const details = source.details?.(item) ?? {};
    const name = String(details.name ?? "").trim();
    if (!name) {
      hide();
      return;
    }

    const documentRef = tooltip.ownerDocument ?? globalThis.document;
    const nameElement = documentRef.createElement("div");
    nameElement.className = "overflow-tooltip-name";
    nameElement.textContent = name;
    const children = [nameElement];
    const path = String(details.path ?? "").trim();
    if (path && path !== name) {
      const pathElement = documentRef.createElement("div");
      pathElement.className = "overflow-tooltip-path";
      pathElement.textContent = path;
      children.push(pathElement);
    }

    tooltip.replaceChildren(...children);
    visibleKey = itemKey(source, item);
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    tooltip.hidden = false;
    position(item);
  }

  function position(item) {
    if (!tooltip || tooltip.hidden || !item?.getBoundingClientRect) {
      return;
    }
    const bounds = boundsElement?.getBoundingClientRect?.()
      ?? documentBounds(windowTarget);
    const position = anchoredTooltipPosition({
      anchorRect: item.getBoundingClientRect(),
      tooltipRect: tooltip.getBoundingClientRect(),
      boundsRect: bounds,
    });
    tooltip.style.left = `${position.left}px`;
    tooltip.style.top = `${position.top}px`;
  }

  function hide() {
    clearTimer(timer);
    timer = null;
    pendingKey = "";
    visibleKey = "";
    if (tooltip) {
      tooltip.hidden = true;
    }
  }

  function destroy() {
    hide();
    for (const removeListener of listeners.splice(0)) {
      removeListener();
    }
  }

  function showFor(sourceName, item) {
    const source = normalizedSources.find((candidate) => candidate.name === sourceName);
    if (!source || !item) {
      hide();
      return;
    }
    scrollBlocked = false;
    schedule(source, item);
  }

  return { destroy, hide, showFor };
}

export function elementIsOverflowing(element) {
  return Boolean(element && element.scrollWidth > element.clientWidth + 1);
}

export function anchoredTooltipPosition({
  anchorRect,
  tooltipRect,
  boundsRect,
  gap = 8,
  padding = 8,
} = {}) {
  const boundsWidth = Math.max(0, Number(boundsRect?.width) || 0);
  const boundsHeight = Math.max(0, Number(boundsRect?.height) || 0);
  const idealLeft = (Number(anchorRect?.right) || 0) - (Number(boundsRect?.left) || 0) + gap;
  const maxLeft = boundsWidth - (Number(tooltipRect?.width) || 0) - padding;
  const idealTop = (Number(anchorRect?.top) || 0)
    - (Number(boundsRect?.top) || 0)
    + ((Number(anchorRect?.height) || 0) - (Number(tooltipRect?.height) || 0)) / 2;
  const maxTop = boundsHeight - (Number(tooltipRect?.height) || 0) - padding;
  return {
    left: Math.round(Math.max(padding, Math.min(idealLeft, maxLeft))),
    top: Math.round(Math.max(padding, Math.min(idealTop, maxTop))),
  };
}

function itemFromEvent(source, event) {
  const item = source.itemFromTarget?.(event?.target);
  return item && source.container.contains(item) ? item : null;
}

function labelElement(source, item) {
  return source.labelElement?.(item) ?? item;
}

function itemKey(source, item) {
  const key = source.key?.(item) ?? source.details?.(item)?.name ?? "";
  return `${source.name ?? ""}:${key}`;
}

function documentBounds(windowTarget) {
  return {
    left: 0,
    top: 0,
    width: Number(windowTarget?.innerWidth) || 0,
    height: Number(windowTarget?.innerHeight) || 0,
  };
}
