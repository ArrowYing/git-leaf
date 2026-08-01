import assert from "node:assert/strict";
import test from "node:test";

import {
  createUiTooltip,
  elementIsOverflowing,
  uiTooltipPosition,
} from "../public/ui-tooltip.js";

test("expansion tooltips appear only when a navigation label is visually truncated", () => {
  assert.equal(elementIsOverflowing({ scrollWidth: 220, clientWidth: 120 }), true);
  assert.equal(elementIsOverflowing({ scrollWidth: 120, clientWidth: 120 }), false);
  assert.equal(elementIsOverflowing({ scrollWidth: 121, clientWidth: 120 }), true);
});

test("expansion tooltip text aligns with the source text instead of its outer box", () => {
  assert.deepEqual(uiTooltipPosition({
    anchorRect: { left: 32, top: 60, width: 120, height: 28 },
    tooltipRect: { left: 0, top: 0, width: 320, height: 52 },
    contentRect: { left: 11, top: 6, width: 298, height: 17 },
    boundsRect: { left: 0, top: 0, width: 1200, height: 800 },
    placement: "expansion",
  }), {
    left: 21,
    top: 54,
  });

  assert.deepEqual(uiTooltipPosition({
    anchorRect: { left: 1180, top: 790, width: 120, height: 28 },
    tooltipRect: { left: 0, top: 0, width: 320, height: 52 },
    contentRect: { left: 11, top: 6, width: 298, height: 17 },
    boundsRect: { left: 0, top: 0, width: 1200, height: 800 },
    placement: "expansion",
  }), {
    left: 872,
    top: 740,
  });
});

test("action tooltips center below controls and flip above near the lower edge", () => {
  assert.deepEqual(uiTooltipPosition({
    anchorRect: { left: 100, top: 30, width: 40, height: 20 },
    tooltipRect: { width: 120, height: 32 },
    boundsRect: { left: 0, top: 0, width: 800, height: 800 },
    placement: "bottom",
  }), {
    left: 60,
    top: 58,
  });

  assert.deepEqual(uiTooltipPosition({
    anchorRect: { left: 100, top: 770, width: 40, height: 20 },
    tooltipRect: { width: 120, height: 32 },
    boundsRect: { left: 0, top: 0, width: 800, height: 800 },
    placement: "bottom",
  }), {
    left: 60,
    top: 730,
  });
});

test("expansion tooltips preserve source typography without changing action prompts", () => {
  const root = createEventTarget();
  const windowTarget = {
    ...createEventTarget(),
    innerWidth: 1200,
    innerHeight: 800,
  };
  const expansionItem = createElement({
    id: "outline-item",
    rect: { left: 100, top: 40, width: 160, height: 28 },
  });
  const actionItem = createElement({
    id: "toolbar-action",
    dataset: { uiTooltip: "Back" },
    rect: { left: 300, top: 40, width: 32, height: 32 },
  });
  const tooltip = createElement({
    id: "ui-tooltip",
    hidden: true,
    rect: { width: 260, height: 28 },
  });
  root.contains = (candidate) => (
    candidate === expansionItem ||
    candidate === actionItem ||
    candidate === tooltip
  );
  tooltip.contains = (candidate) => candidate === tooltip;
  const controller = createUiTooltip({
    tooltip,
    eventRoot: root,
    boundsElement: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    },
    sources: [
      {
        name: "expansion",
        container: root,
        itemFromTarget: (target) => target === expansionItem ? expansionItem : null,
        details: () => ({ name: "8.1 检索单元用 episode，不优先用任意文本块" }),
        key: (target) => target.id,
        placement: "expansion",
        focusDelay: 0,
      },
      {
        name: "action",
        container: root,
        itemFromTarget: (target) => target === actionItem ? actionItem : null,
        details: (target) => ({ name: target.dataset.uiTooltip }),
        key: (target) => target.id,
        placement: "bottom",
        focusDelay: 0,
      },
    ],
    windowTarget,
    styleFromElement: () => ({
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: "13px",
      fontStyle: "normal",
      fontStretch: "100%",
      fontVariant: "normal",
      fontWeight: "400",
      lineHeight: "16.25px",
      letterSpacing: "normal",
      wordSpacing: "0px",
    }),
  });

  root.emit("focusin", { target: expansionItem });
  assert.equal(tooltip.dataset.variant, "expansion");
  assert.equal(tooltip.dataset.source, "expansion");
  assert.equal(tooltip.style.fontFamily, "Inter, system-ui, sans-serif");
  assert.equal(tooltip.style.fontSize, "13px");
  assert.equal(tooltip.style.lineHeight, "16.25px");
  assert.equal(tooltip.children[0].style.fontWeight, "400");

  root.emit("focusout", { target: expansionItem, relatedTarget: null });
  root.emit("focusin", { target: actionItem });
  assert.equal(tooltip.dataset.variant, "action");
  assert.equal(tooltip.dataset.source, "action");
  assert.equal(tooltip.style.fontFamily, "");
  assert.equal(tooltip.style.fontSize, "");
  assert.equal(tooltip.children[0].style.fontWeight, undefined);

  controller.destroy();
});

test("search result tooltips show full text and preserve highlighted match ranges", () => {
  const root = createEventTarget();
  const windowTarget = {
    ...createEventTarget(),
    innerWidth: 1200,
    innerHeight: 800,
  };
  const item = createElement({
    id: "search-result",
    rect: { left: 40, top: 60, width: 180, height: 28 },
  });
  const tooltip = createElement({
    id: "ui-tooltip",
    hidden: true,
    rect: { width: 440, height: 28 },
  });
  root.contains = (candidate) => candidate === item || candidate === tooltip;
  const fullName = "dr-04-company-code-repository-context-boundaries.md";
  const matchFrom = fullName.indexOf("context");
  const controller = createUiTooltip({
    tooltip,
    eventRoot: root,
    boundsElement: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    },
    sources: [{
      name: "search-result",
      container: root,
      itemFromTarget: (target) => target === item ? item : null,
      details: () => ({
        name: fullName,
        nameRanges: [{ from: matchFrom, to: matchFrom + "context".length }],
      }),
      key: (target) => target.id,
      placement: "expansion",
      delay: 0,
    }],
    windowTarget,
  });

  root.emit("pointerover", {
    target: item,
    relatedTarget: null,
    clientX: 60,
    clientY: 74,
  });
  const title = tooltip.children[0];
  const match = title.children.find(
    (child) => child.className === "ui-tooltip-search-match",
  );
  assert.equal(tooltip.hidden, false);
  assert.equal(match?.textContent, "context");

  controller.destroy();
});

test("one shared controller renders actions, exposes shortcuts, and remains hoverable", () => {
  const root = createEventTarget();
  const windowTarget = {
    ...createEventTarget(),
    innerWidth: 1200,
    innerHeight: 800,
  };
  const item = createElement({
    id: "history-back",
    dataset: {
      uiTooltip: "Back",
      uiTooltipShortcut: "⌘[",
    },
    rect: { left: 100, top: 40, width: 32, height: 32 },
  });
  const tooltip = createElement({
    id: "ui-tooltip",
    hidden: true,
    rect: { width: 210, height: 52 },
  });
  root.contains = (candidate) => candidate === item || candidate === tooltip;
  tooltip.contains = (candidate) => candidate === tooltip;
  const timers = [];
  const controller = createUiTooltip({
    tooltip,
    eventRoot: root,
    boundsElement: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    },
    sources: [{
      name: "action",
      container: root,
      itemFromTarget: (target) => target === item ? item : null,
      details: (target) => ({
        name: target.dataset.uiTooltip,
        shortcut: target.dataset.uiTooltipShortcut,
      }),
      key: (target) => target.id,
      placement: "bottom",
      delay: 450,
    }],
    windowTarget,
    setTimer: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimer: () => {},
    now: () => 100,
  });

  root.emit("pointerover", {
    target: item,
    relatedTarget: null,
    clientX: 116,
    clientY: 56,
  });
  assert.equal(tooltip.hidden, true);
  assert.equal(timers[0].delay, 450);
  timers[0].callback();

  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.dataset.variant, "action");
  assert.equal(tooltip.children[0].className, "ui-tooltip-row");
  assert.equal(tooltip.children[0].children[0].textContent, "Back");
  assert.equal(tooltip.children[0].children[1].textContent, "⌘[");
  assert.deepEqual(tooltip.style, { left: "11px", top: "80px" });
  assert.equal(item.getAttribute("aria-describedby"), "ui-tooltip");

  root.emit("pointerout", {
    target: item,
    relatedTarget: tooltip,
  });
  assert.equal(tooltip.hidden, false);

  tooltip.emit("pointerleave", {
    target: tooltip,
    relatedTarget: null,
  });
  assert.equal(tooltip.hidden, true);
  assert.equal(item.getAttribute("aria-describedby"), null);

  controller.destroy();
});

test("a visible expansion tooltip preserves hover without intercepting the covered file click", () => {
  const root = createEventTarget();
  const windowTarget = {
    ...createEventTarget(),
    innerWidth: 1200,
    innerHeight: 800,
  };
  const firstItem = createElement({
    id: "first-file",
    rect: { left: 100, top: 80, width: 180, height: 42 },
  });
  const coveredItem = createElement({
    id: "covered-file",
    rect: { left: 100, top: 122, width: 180, height: 42 },
  });
  let openedItem = null;
  coveredItem.addEventListener("click", () => {
    openedItem = coveredItem.id;
  });
  const tooltip = createElement({
    id: "ui-tooltip",
    hidden: true,
    rect: { left: 90, top: 74, width: 360, height: 68 },
  });
  root.contains = (candidate) => (
    candidate === firstItem || candidate === coveredItem || candidate === tooltip
  );
  tooltip.contains = (candidate) => candidate === tooltip;
  const controller = createUiTooltip({
    tooltip,
    eventRoot: root,
    boundsElement: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    },
    sources: [{
      name: "file-tree",
      container: root,
      itemFromTarget: (target) => (
        target === firstItem || target === coveredItem ? target : null
      ),
      details: (target) => ({ name: `${target.id}.md`, path: `${target.id} title` }),
      key: (target) => target.id,
      placement: "expansion",
      delay: 0,
    }],
    windowTarget,
  });

  root.emit("pointerover", {
    target: firstItem,
    relatedTarget: null,
    clientX: 120,
    clientY: 96,
  });
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.style.pointerEvents, "none");
  assert.equal(tooltip.children[0].textContent, "first-file.md");

  root.emit("pointerout", {
    target: firstItem,
    relatedTarget: coveredItem,
    clientX: 120,
    clientY: 130,
  });
  root.emit("pointerover", {
    target: coveredItem,
    relatedTarget: firstItem,
    clientX: 120,
    clientY: 130,
  });
  root.emit("pointermove", {
    target: coveredItem,
    clientX: 121,
    clientY: 131,
  });
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.children[0].textContent, "first-file.md");

  root.emit("pointerdown", {
    target: coveredItem,
    clientX: 121,
    clientY: 131,
  });
  assert.equal(tooltip.hidden, true);
  coveredItem.emit("click", { target: coveredItem });
  assert.equal(openedItem, "covered-file");

  controller.destroy();
});

test("Escape dismisses the visible tooltip until the pointer leaves its control", () => {
  const root = createEventTarget();
  const windowTarget = {
    ...createEventTarget(),
    innerWidth: 800,
    innerHeight: 600,
  };
  const item = createElement({
    id: "sidebar-toggle",
    dataset: { uiTooltip: "Hide sidebar" },
    rect: { left: 20, top: 20, width: 32, height: 32 },
  });
  const tooltip = createElement({
    id: "ui-tooltip",
    hidden: true,
    rect: { width: 120, height: 32 },
  });
  root.contains = (candidate) => candidate === item || candidate === tooltip;
  const controller = createUiTooltip({
    tooltip,
    eventRoot: root,
    boundsElement: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    },
    sources: [{
      name: "action",
      container: root,
      itemFromTarget: (target) => target === item ? item : null,
      details: (target) => ({ name: target.dataset.uiTooltip }),
      key: (target) => target.id,
      focusDelay: 0,
    }],
    windowTarget,
  });

  root.emit("focusin", { target: item });
  assert.equal(tooltip.hidden, false);
  root.emit("keydown", { key: "Escape" });
  assert.equal(tooltip.hidden, true);
  root.emit("focusin", { target: item });
  assert.equal(tooltip.hidden, true);
  root.emit("focusout", { target: item, relatedTarget: null });
  root.emit("focusin", { target: item });
  assert.equal(tooltip.hidden, false);

  controller.destroy();
});

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      const handlers = listeners.get(type) ?? new Set();
      handlers.add(handler);
      listeners.set(type, handlers);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    emit(type, event) {
      for (const handler of listeners.get(type) ?? []) {
        handler(event);
      }
    },
  };
}

function createElement({
  id = "",
  dataset = {},
  hidden = false,
  rect = {},
} = {}) {
  const eventTarget = createEventTarget();
  const attributes = new Map();
  return {
    ...eventTarget,
    id,
    dataset,
    hidden,
    style: {},
    children: [],
    isConnected: true,
    ownerDocument: {
      createElement: () => createElement(),
      createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    },
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    contains: () => false,
    getBoundingClientRect: () => rect,
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
  };
}
