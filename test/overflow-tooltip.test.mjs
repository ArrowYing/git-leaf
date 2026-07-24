import assert from "node:assert/strict";
import test from "node:test";

import {
  anchoredTooltipPosition,
  createOverflowTooltip,
  elementIsOverflowing,
} from "../public/overflow-tooltip.js";

test("overflow tooltip appears only when a navigation label is visually truncated", () => {
  assert.equal(elementIsOverflowing({ scrollWidth: 220, clientWidth: 120 }), true);
  assert.equal(elementIsOverflowing({ scrollWidth: 120, clientWidth: 120 }), false);
  assert.equal(elementIsOverflowing({ scrollWidth: 121, clientWidth: 120 }), false);
});

test("overflow tooltip stays inside the workbench while opening beside its navigation item", () => {
  assert.deepEqual(anchoredTooltipPosition({
    anchorRect: { right: 176, top: 60, height: 28 },
    tooltipRect: { width: 320, height: 52 },
    boundsRect: { left: 0, top: 0, width: 1200, height: 800 },
  }), {
    left: 184,
    top: 48,
  });

  assert.deepEqual(anchoredTooltipPosition({
    anchorRect: { right: 1180, top: 790, height: 28 },
    tooltipRect: { width: 320, height: 52 },
    boundsRect: { left: 0, top: 0, width: 1200, height: 800 },
  }), {
    left: 872,
    top: 740,
  });
});

test("the shared overflow tooltip renders a truncated navigation item after the fast delay", () => {
  const container = createEventTarget();
  const windowTarget = {
    ...createEventTarget(),
    innerWidth: 1200,
    innerHeight: 800,
  };
  const item = {
    clientWidth: 120,
    scrollWidth: 260,
    isConnected: true,
    textContent: "A complete document heading",
    contains: () => false,
    getBoundingClientRect: () => ({ right: 176, top: 60, height: 28 }),
  };
  container.contains = (candidate) => candidate === item;
  const tooltip = {
    hidden: true,
    ownerDocument: {
      createElement: () => ({ className: "", textContent: "" }),
    },
    style: {},
    children: [],
    replaceChildren(...children) {
      this.children = children;
    },
    getBoundingClientRect: () => ({ width: 260, height: 36 }),
  };
  const timers = [];
  const controller = createOverflowTooltip({
    tooltip,
    boundsElement: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    },
    sources: [{
      name: "document-outline",
      container,
      itemFromTarget: (target) => target,
      details: (target) => ({ name: target.textContent }),
    }],
    windowTarget,
    setTimer: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimer: () => {},
  });

  container.emit("pointerover", {
    target: item,
    relatedTarget: null,
    clientX: 80,
    clientY: 74,
  });
  assert.equal(tooltip.hidden, true);
  assert.equal(timers[0].delay, 120);
  timers[0].callback();

  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.children[0].className, "overflow-tooltip-name");
  assert.equal(tooltip.children[0].textContent, item.textContent);
  assert.deepEqual(tooltip.style, { left: "184px", top: "56px" });

  controller.destroy();
  assert.equal(tooltip.hidden, true);
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
