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

test("expansion tooltips begin at the text instead of beyond the navigation column", () => {
  assert.deepEqual(uiTooltipPosition({
    anchorRect: { left: 32, top: 60, width: 120, height: 28 },
    tooltipRect: { width: 320, height: 52 },
    boundsRect: { left: 0, top: 0, width: 1200, height: 800 },
    placement: "expansion",
  }), {
    left: 22,
    top: 48,
  });

  assert.deepEqual(uiTooltipPosition({
    anchorRect: { left: 1180, top: 790, width: 120, height: 28 },
    tooltipRect: { width: 320, height: 52 },
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
