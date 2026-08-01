const DEFAULT_DELAY = 400;
const DEFAULT_QUICK_DELAY = 80;
const DEFAULT_WARM_DURATION = 1200;
const EXPANSION_TYPOGRAPHY_PROPERTIES = Object.freeze([
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontStretch",
  "fontVariant",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
]);

export function createUiTooltip({
  tooltip,
  eventRoot,
  boundsElement,
  sources = [],
  isBlocked = () => false,
  defaultDelay = DEFAULT_DELAY,
  quickDelay = DEFAULT_QUICK_DELAY,
  warmDuration = DEFAULT_WARM_DURATION,
  windowTarget = globalThis.window,
  setTimer = windowTarget?.setTimeout?.bind(windowTarget) ?? setTimeout,
  clearTimer = windowTarget?.clearTimeout?.bind(windowTarget) ?? clearTimeout,
  now = Date.now,
  styleFromElement = windowTarget?.getComputedStyle?.bind(windowTarget)
    ?? globalThis.getComputedStyle?.bind(globalThis),
} = {}) {
  const normalizedSources = sources.filter((source) => source?.container);
  const root = eventRoot ?? boundsElement;
  const listeners = [];
  let timer = null;
  let pending = null;
  let visible = null;
  let dismissedKey = "";
  let scrollBlocked = false;
  let pointerX = null;
  let pointerY = null;
  let warmUntil = 0;
  let describedElement = null;

  listen(root, "pointerover", handlePointerOver);
  listen(root, "pointermove", handlePointerMove);
  listen(root, "pointerout", handlePointerOut);
  listen(root, "pointerdown", handlePointerDown);
  listen(root, "focusin", handleFocusIn);
  listen(root, "focusout", handleFocusOut);
  listen(root, "scroll", handleScroll, true);
  listen(root, "keydown", handleKeydown);
  listen(tooltip, "pointerenter", () => {});
  listen(tooltip, "pointerleave", (event) => {
    if (!visible?.item?.contains?.(event.relatedTarget)) {
      hide();
    }
  });
  listen(windowTarget, "resize", hide);

  function listen(target, type, handler, options) {
    if (!target?.addEventListener) {
      return;
    }
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  }

  function handlePointerOver(event) {
    if (tooltip?.contains?.(event.target)) {
      return;
    }
    if (pointerInsideVisibleExpansionTooltip(event)) {
      rememberPointer(event);
      return;
    }
    const resolved = resolveTarget(event.target);
    if (!resolved || sameResolvedTarget(resolved, resolveTarget(event.relatedTarget))) {
      return;
    }
    pointerX = event.clientX;
    pointerY = event.clientY;
    scrollBlocked = false;
    if (dismissedKey && dismissedKey !== resolved.key) {
      dismissedKey = "";
    }
    schedule(resolved, "pointer");
  }

  function handlePointerMove(event) {
    if (tooltip?.contains?.(event.target)) {
      return;
    }
    if (pointerInsideVisibleExpansionTooltip(event)) {
      rememberPointer(event);
      return;
    }
    const resolved = resolveTarget(event.target);
    if (!resolved) {
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
    if (visible?.key === resolved.key || pending?.key === resolved.key) {
      return;
    }
    if (dismissedKey && dismissedKey !== resolved.key) {
      dismissedKey = "";
    }
    schedule(resolved, "pointer");
  }

  function handlePointerOut(event) {
    if (tooltip?.contains?.(event.target)) {
      return;
    }
    if (pointerInsideVisibleExpansionTooltip(event)) {
      rememberPointer(event);
      return;
    }
    const resolved = resolveTarget(event.target);
    if (!resolved || resolved.item?.contains?.(event.relatedTarget)) {
      return;
    }
    if (tooltip?.contains?.(event.relatedTarget)) {
      return;
    }
    if (dismissedKey === resolved.key) {
      dismissedKey = "";
    }
    hide();
  }

  function handlePointerDown(event) {
    if (pointerInsideVisibleExpansionTooltip(event)) {
      hide();
    }
  }

  function handleFocusIn(event) {
    const resolved = resolveTarget(event.target);
    if (!resolved) {
      return;
    }
    scrollBlocked = false;
    if (dismissedKey && dismissedKey !== resolved.key) {
      dismissedKey = "";
    }
    schedule(resolved, "focus");
  }

  function handleFocusOut(event) {
    const resolved = resolveTarget(event.target);
    if (!resolved || resolved.item?.contains?.(event.relatedTarget)) {
      return;
    }
    if (dismissedKey === resolved.key) {
      dismissedKey = "";
    }
    hide();
  }

  function handleScroll(event) {
    if (!normalizedSources.some((source) => source.container === event.target
      || source.container.contains?.(event.target))) {
      return;
    }
    scrollBlocked = true;
    hide();
  }

  function handleKeydown(event) {
    if (event.key !== "Escape" || (!visible && !pending)) {
      return;
    }
    dismissedKey = visible?.key ?? pending?.key ?? "";
    hide({ preserveDismissedKey: true });
  }

  function resolveTarget(target) {
    if (!target) {
      return null;
    }
    for (const source of normalizedSources) {
      if (!source.container.contains?.(target) && source.container !== target) {
        continue;
      }
      const item = source.itemFromTarget?.(target);
      if (!item || (!source.container.contains?.(item) && source.container !== item)) {
        continue;
      }
      return {
        source,
        item,
        key: itemKey(source, item),
      };
    }
    return null;
  }

  function schedule(resolved, reason) {
    if (!canShow(resolved) || dismissedKey === resolved.key) {
      hide({ preserveDismissedKey: true });
      return;
    }
    if (visible?.key === resolved.key || pending?.key === resolved.key) {
      return;
    }

    clearTimer(timer);
    pending = resolved;
    const sourceDelay = reason === "focus"
      ? (resolved.source.focusDelay ?? 0)
      : now() < warmUntil
        ? (resolved.source.quickDelay ?? quickDelay)
        : (resolved.source.delay ?? defaultDelay);
    if (sourceDelay <= 0) {
      show(resolved);
      return;
    }
    timer = setTimer(() => show(resolved), sourceDelay);
  }

  function canShow({ source, item }) {
    return Boolean(
      tooltip
      && !scrollBlocked
      && !isBlocked(source, item)
      && item?.isConnected !== false
      && (source.shouldShow?.(item) ?? true),
    );
  }

  function show(resolved) {
    clearTimer(timer);
    timer = null;
    pending = null;
    if (!canShow(resolved) || dismissedKey === resolved.key) {
      hide({ preserveDismissedKey: true });
      return;
    }

    const details = resolved.source.details?.(resolved.item) ?? {};
    const name = String(details.name ?? details.title ?? "").trim();
    if (!name) {
      hide();
      return;
    }

    const titleElement = renderTooltip(tooltip, {
      name,
      nameRanges: details.nameRanges,
      path: String(details.path ?? details.detail ?? "").trim(),
      shortcut: String(details.shortcut ?? "").trim(),
    });
    const placement = valueFromSource(resolved.source.placement, resolved.item) || "bottom";
    tooltip.dataset.variant = placement === "expansion"
      ? "expansion"
      : placement.startsWith("bottom") || placement.startsWith("top")
        ? (resolved.source.variant ?? "action")
        : (resolved.source.variant ?? "content");
    tooltip.dataset.source = String(resolved.source.name ?? "");
    applyTooltipHitTesting(tooltip);
    applyExpansionTypography({
      tooltip,
      titleElement,
      sourceElement: resolved.source.anchorElement?.(resolved.item) ?? resolved.item,
      styleFromElement,
    });
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    tooltip.hidden = false;
    tooltip.setAttribute?.("aria-hidden", "false");
    position(resolved, placement, titleElement);
    visible = resolved;
    connectDescription(resolved);
    warmUntil = now() + warmDuration;
  }

  function position(resolved, placement = null, contentElement = null) {
    if (!tooltip || tooltip.hidden) {
      return;
    }
    const anchor = resolved.source.anchorElement?.(resolved.item) ?? resolved.item;
    if (!anchor?.getBoundingClientRect) {
      return;
    }
    const boundsRect = boundsElement?.getBoundingClientRect?.()
      ?? documentBounds(windowTarget);
    const next = uiTooltipPosition({
      anchorRect: anchor.getBoundingClientRect(),
      tooltipRect: tooltip.getBoundingClientRect(),
      contentRect: contentElement?.getBoundingClientRect?.(),
      boundsRect,
      placement: placement
        ?? valueFromSource(resolved.source.placement, resolved.item)
        ?? "bottom",
    });
    tooltip.style.left = `${next.left}px`;
    tooltip.style.top = `${next.top}px`;
  }

  function pointerInsideVisibleExpansionTooltip(event) {
    if (!visible || tooltip?.hidden || tooltip?.dataset?.variant !== "expansion") {
      return false;
    }
    const clientX = finiteNumber(event?.clientX);
    const clientY = finiteNumber(event?.clientY);
    if (clientX === null || clientY === null || !tooltip?.getBoundingClientRect) {
      return false;
    }
    const rect = tooltip.getBoundingClientRect();
    const left = number(rect?.left);
    const top = number(rect?.top);
    const right = left + rectSize(rect, "width", "left", "right");
    const bottom = top + rectSize(rect, "height", "top", "bottom");
    return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
  }

  function rememberPointer(event) {
    pointerX = event.clientX;
    pointerY = event.clientY;
  }

  function connectDescription(resolved) {
    disconnectDescription();
    const target = resolved.source.describedElement?.(resolved.item) ?? resolved.item;
    const tooltipId = tooltip?.id;
    if (!tooltipId || !target?.getAttribute || !target?.setAttribute) {
      return;
    }
    const ids = new Set(String(target.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter(Boolean));
    ids.add(tooltipId);
    target.setAttribute("aria-describedby", [...ids].join(" "));
    describedElement = target;
  }

  function disconnectDescription() {
    const tooltipId = tooltip?.id;
    if (!tooltipId || !describedElement?.getAttribute) {
      describedElement = null;
      return;
    }
    const ids = String(describedElement.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter((id) => id && id !== tooltipId);
    if (ids.length > 0) {
      describedElement.setAttribute("aria-describedby", ids.join(" "));
    } else {
      describedElement.removeAttribute?.("aria-describedby");
    }
    describedElement = null;
  }

  function hide({ preserveDismissedKey = false } = {}) {
    clearTimer(timer);
    timer = null;
    pending = null;
    visible = null;
    disconnectDescription();
    if (!preserveDismissedKey) {
      dismissedKey = "";
    }
    if (tooltip) {
      tooltip.hidden = true;
      tooltip.setAttribute?.("aria-hidden", "true");
    }
  }

  function showFor(sourceName, item) {
    const source = normalizedSources.find((candidate) => candidate.name === sourceName);
    if (!source || !item) {
      hide();
      return;
    }
    scrollBlocked = false;
    dismissedKey = "";
    schedule({ source, item, key: itemKey(source, item) }, "focus");
  }

  function destroy() {
    hide();
    for (const removeListener of listeners.splice(0)) {
      removeListener();
    }
  }

  return { destroy, hide, showFor };
}

export function elementIsOverflowing(element) {
  return Boolean(element && element.scrollWidth > element.clientWidth);
}

export function uiTooltipPosition({
  anchorRect,
  tooltipRect,
  contentRect,
  boundsRect,
  placement = "bottom",
  gap = 8,
  padding = 8,
  contentInset = 10,
} = {}) {
  const boundsLeft = number(boundsRect?.left);
  const boundsTop = number(boundsRect?.top);
  const boundsWidth = Math.max(0, number(boundsRect?.width));
  const boundsHeight = Math.max(0, number(boundsRect?.height));
  const anchorLeft = number(anchorRect?.left) - boundsLeft;
  const anchorTop = number(anchorRect?.top) - boundsTop;
  const anchorWidth = rectSize(anchorRect, "width", "left", "right");
  const anchorHeight = rectSize(anchorRect, "height", "top", "bottom");
  const anchorRight = anchorLeft + anchorWidth;
  const anchorBottom = anchorTop + anchorHeight;
  const tooltipWidth = Math.max(0, number(tooltipRect?.width));
  const tooltipHeight = Math.max(0, number(tooltipRect?.height));
  const minimumLeft = placement === "expansion" ? 0 : padding;
  const maxLeft = Math.max(minimumLeft, boundsWidth - tooltipWidth - padding);
  const maxTop = Math.max(padding, boundsHeight - tooltipHeight - padding);
  let idealLeft;
  let idealTop;

  if (placement === "expansion") {
    const tooltipLeft = finiteNumber(tooltipRect?.left);
    const tooltipTop = finiteNumber(tooltipRect?.top);
    const contentLeft = finiteNumber(contentRect?.left);
    const contentTop = finiteNumber(contentRect?.top);
    const contentOffsetLeft = tooltipLeft === null || contentLeft === null
      ? contentInset
      : contentLeft - tooltipLeft;
    const contentOffsetTop = tooltipTop === null || contentTop === null
      ? (tooltipHeight - anchorHeight) / 2
      : contentTop - tooltipTop;
    idealLeft = anchorLeft - contentOffsetLeft;
    idealTop = anchorTop - contentOffsetTop;
  } else {
    const alignStart = placement.endsWith("-start");
    const preferTop = placement.startsWith("top");
    idealLeft = alignStart
      ? anchorLeft
      : anchorLeft + (anchorWidth - tooltipWidth) / 2;
    const below = anchorBottom + gap;
    const above = anchorTop - tooltipHeight - gap;
    if (preferTop) {
      idealTop = above >= padding || below + tooltipHeight > boundsHeight - padding
        ? above
        : below;
    } else {
      idealTop = below + tooltipHeight <= boundsHeight - padding || above < padding
        ? below
        : above;
    }
  }

  return {
    left: Math.round(clamp(idealLeft, minimumLeft, maxLeft)),
    top: Math.round(clamp(idealTop, padding, maxTop)),
  };
}

function renderTooltip(tooltip, { name, nameRanges, path, shortcut }) {
  const documentRef = tooltip.ownerDocument ?? globalThis.document;
  const nameElement = documentRef.createElement("div");
  nameElement.className = "ui-tooltip-title";
  appendHighlightedText(nameElement, name, nameRanges, documentRef);
  const children = [];
  if (shortcut) {
    const row = documentRef.createElement("div");
    row.className = "ui-tooltip-row";
    const shortcutElement = documentRef.createElement("span");
    shortcutElement.className = "ui-tooltip-shortcut";
    shortcutElement.textContent = shortcut;
    row.append(nameElement, shortcutElement);
    children.push(row);
  } else {
    children.push(nameElement);
  }
  if (path && path !== name) {
    const pathElement = documentRef.createElement("div");
    pathElement.className = "ui-tooltip-detail";
    pathElement.textContent = path;
    children.push(pathElement);
  }
  tooltip.replaceChildren(...children);
  return nameElement;
}

function appendHighlightedText(element, text, ranges, documentRef) {
  const normalizedRanges = normalizeHighlightRanges(text, ranges);
  if (normalizedRanges.length === 0) {
    element.textContent = text;
    return;
  }

  let cursor = 0;
  for (const range of normalizedRanges) {
    if (range.from > cursor) {
      element.append(documentRef.createTextNode(text.slice(cursor, range.from)));
    }
    const mark = documentRef.createElement("mark");
    mark.className = "ui-tooltip-search-match";
    mark.textContent = text.slice(range.from, range.to);
    element.append(mark);
    cursor = range.to;
  }
  if (cursor < text.length) {
    element.append(documentRef.createTextNode(text.slice(cursor)));
  }
}

function normalizeHighlightRanges(text, ranges) {
  const length = text.length;
  const candidates = [];
  for (const range of Array.isArray(ranges) ? ranges : []) {
    const rawFrom = Number(range?.from);
    const rawTo = Number(range?.to);
    if (!Number.isFinite(rawFrom) || !Number.isFinite(rawTo)) {
      continue;
    }
    const from = Math.max(0, Math.min(length, Math.trunc(rawFrom)));
    const to = Math.max(from, Math.min(length, Math.trunc(rawTo)));
    if (to <= from) {
      continue;
    }
    candidates.push({ from, to });
  }

  candidates.sort((left, right) => left.from - right.from || left.to - right.to);
  const normalized = [];
  for (const { from, to } of candidates) {
    const previous = normalized.at(-1);
    if (previous && from <= previous.to) {
      previous.to = Math.max(previous.to, to);
    } else {
      normalized.push({ from, to });
    }
  }
  return normalized;
}

function applyExpansionTypography({
  tooltip,
  titleElement,
  sourceElement,
  styleFromElement,
}) {
  if (tooltip.dataset.expansionTypography === "true") {
    for (const property of EXPANSION_TYPOGRAPHY_PROPERTIES) {
      tooltip.style[property] = "";
    }
    delete tooltip.dataset.expansionTypography;
  }
  if (tooltip.dataset.variant !== "expansion" || typeof styleFromElement !== "function") {
    return;
  }

  let sourceStyle;
  try {
    sourceStyle = styleFromElement(sourceElement);
  } catch {
    return;
  }
  if (!sourceStyle) {
    return;
  }
  for (const property of EXPANSION_TYPOGRAPHY_PROPERTIES) {
    tooltip.style[property] = String(sourceStyle[property] ?? "");
  }
  titleElement.style.fontWeight = String(sourceStyle.fontWeight ?? "");
  tooltip.dataset.expansionTypography = "true";
}

function applyTooltipHitTesting(tooltip) {
  if (tooltip.dataset.variant === "expansion") {
    tooltip.style.pointerEvents = "none";
    return;
  }
  if (typeof tooltip.style.removeProperty === "function") {
    tooltip.style.removeProperty("pointer-events");
  } else {
    delete tooltip.style.pointerEvents;
  }
}

function itemKey(source, item) {
  const key = source.key?.(item) ?? source.details?.(item)?.name ?? "";
  return `${source.name ?? ""}:${key}`;
}

function sameResolvedTarget(left, right) {
  return Boolean(left && right && left.key === right.key);
}

function valueFromSource(value, item) {
  return typeof value === "function" ? value(item) : value;
}

function rectSize(rect, sizeKey, startKey, endKey) {
  const explicit = number(rect?.[sizeKey]);
  return explicit || Math.max(0, number(rect?.[endKey]) - number(rect?.[startKey]));
}

function number(value) {
  return Number(value) || 0;
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(Number(value) || 0, maximum));
}

function documentBounds(windowTarget) {
  return {
    left: 0,
    top: 0,
    width: Number(windowTarget?.innerWidth) || 0,
    height: Number(windowTarget?.innerHeight) || 0,
  };
}
