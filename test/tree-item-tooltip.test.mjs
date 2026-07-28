import assert from "node:assert/strict";
import test from "node:test";

import { createTreeItemTooltipSource } from "../public/tree-item-tooltip.js";
import { createUiTooltip } from "../public/ui-tooltip.js";

test("AI snippet matches use the whole file row, normal delay, and file-name anchor", () => {
  const root = createEventTarget();
  const label = createElement({
    className: "tree-file-label",
    rect: { left: 16, top: 40, width: 167, height: 17 },
    scrollWidth: 167,
    clientWidth: 167,
  });
  const evidence = createElement({
    className: "tree-file-search-evidence",
    rect: { left: 16, top: 59, width: 167, height: 14 },
  });
  const item = createElement({
    dataset: {
      treeItem: "file",
      treePath: "README.md",
    },
    rect: { left: 8, top: 35, width: 209, height: 42 },
  });
  item.querySelector = (selector) => (
    selector === ".tree-file-label"
      ? label
      : selector === ".tree-file-search-evidence"
        ? evidence
        : null
  );
  item.contains = (candidate) => candidate === item || candidate === label || candidate === evidence;
  label.closest = () => item;
  evidence.closest = () => item;

  const tooltip = createElement({
    id: "ui-tooltip",
    hidden: true,
    rect: { width: 440, height: 28 },
  });
  tooltip.contains = (candidate) => candidate === tooltip;
  root.contains = (candidate) => item.contains(candidate) || candidate === tooltip;

  const snippet = "AI search context boundary evidence that is intentionally long";
  const matchFrom = snippet.indexOf("boundary");
  const snippetDetails = new WeakMap([[
    item,
    {
      name: snippet,
      nameRanges: [{ from: matchFrom, to: matchFrom + "boundary".length }],
    },
  ]]);
  const source = createTreeItemTooltipSource({
    container: root,
    searchDetailsForItem: (candidate) => snippetDetails.get(candidate),
  });

  assert.equal(source.itemFromTarget(label), item);
  assert.equal(source.itemFromTarget(evidence), item);
  assert.equal(source.anchorElement(item), label);
  assert.equal(source.shouldShow(item), true);
  assert.deepEqual(source.details(item), snippetDetails.get(item));

  const timers = [];
  const controller = createUiTooltip({
    tooltip,
    eventRoot: root,
    boundsElement: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    },
    sources: [source],
    windowTarget: {
      ...createEventTarget(),
      innerWidth: 1200,
      innerHeight: 800,
    },
    setTimer: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimer: () => {},
  });

  root.emit("pointerover", {
    target: label,
    relatedTarget: null,
    clientX: 80,
    clientY: 48,
  });
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 250);
  timers[0].callback();
  assert.equal(tooltip.hidden, false);
  assert.equal(
    tooltip.children[0].children.find(
      (child) => child.className === "ui-tooltip-search-match",
    )?.textContent,
    "boundary",
  );
  assert.equal(tooltip.style.left, "8px");

  root.emit("pointerout", {
    target: label,
    relatedTarget: evidence,
  });
  root.emit("pointerover", {
    target: evidence,
    relatedTarget: label,
    clientX: 80,
    clientY: 66,
  });
  assert.equal(tooltip.hidden, false);
  assert.equal(timers.length, 1);

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
  className = "",
  dataset = {},
  hidden = false,
  rect = {},
  scrollWidth = 0,
  clientWidth = 0,
} = {}) {
  const eventTarget = createEventTarget();
  const attributes = new Map();
  return {
    ...eventTarget,
    id,
    className,
    dataset,
    hidden,
    scrollWidth,
    clientWidth,
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
    closest: () => null,
    querySelector: () => null,
    getBoundingClientRect: () => rect,
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
  };
}
