import assert from "node:assert/strict";
import test from "node:test";

import { attachChartTooltips } from "../public/chart-tooltip.js";

test("chart tooltip highlights every visible mark in the active x column and clears it", () => {
  const container = createEventTarget();
  const tooltip = createElement({ hidden: true, rect: { width: 180, height: 72 } });
  const root = {
    querySelector: (selector) => selector === ".chart-tooltip" ? tooltip : null,
  };
  const marks = [
    createElement({ dataset: { chartMark: "true", chartXIndex: "1" } }),
    createElement({ dataset: { chartMark: "true", chartXIndex: "2" } }),
    createElement({ dataset: { chartMark: "true", chartXIndex: "2" } }),
    createElement({ dataset: { chartMark: "true", chartXIndex: "2" } }),
  ];
  const guide = createElement();
  const chart = createElement();
  chart.querySelectorAll = (selector) => (
    selector === "[data-chart-mark][data-chart-x-index]" ? marks : []
  );
  chart.querySelector = (selector) => (
    selector === ".mdx-chart-active-guide" ? guide : null
  );
  const firstTarget = chartTarget(chart, {
    chartTooltip: "2025-08\\n新增用户: 16778 人",
    chartXIndex: "2",
    chartXPosition: "456.0",
  });
  const secondTarget = chartTarget(chart, {
    chartTooltip: "2025-07\\n新增用户: 16500 人",
    chartXIndex: "1",
    chartXPosition: "420.0",
  });
  container.contains = (candidate) => candidate === firstTarget || candidate === secondTarget;
  const originalWindow = globalThis.window;
  globalThis.window = { innerWidth: 1200, innerHeight: 800 };

  try {
    const controller = attachChartTooltips(container, { root });

    container.emit("pointermove", {
      target: firstTarget,
      clientX: 500,
      clientY: 300,
    });
    assert.equal(tooltip.hidden, false);
    assert.equal(tooltip.textContent, "2025-08\n新增用户: 16778 人");
    assert.equal(chart.classList.contains("has-active-column"), true);
    assert.equal(marks[0].classList.contains("is-active"), false);
    assert.equal(marks.filter((mark) => mark.classList.contains("is-active")).length, 3);
    assert.equal(guide.classList.contains("is-active"), true);
    assert.equal(guide.getAttribute("x1"), "456.0");
    assert.equal(guide.getAttribute("x2"), "456.0");

    container.emit("pointermove", {
      target: secondTarget,
      clientX: 460,
      clientY: 300,
    });
    assert.equal(marks[0].classList.contains("is-active"), true);
    assert.equal(marks.filter((mark) => mark.classList.contains("is-active")).length, 1);
    assert.equal(guide.getAttribute("x1"), "420.0");

    container.emit("pointerleave", { target: secondTarget });
    assert.equal(tooltip.hidden, true);
    assert.equal(chart.classList.contains("has-active-column"), false);
    assert.equal(marks.some((mark) => mark.classList.contains("is-active")), false);
    assert.equal(guide.classList.contains("is-active"), false);

    controller.destroy();
  } finally {
    globalThis.window = originalWindow;
  }
});

function chartTarget(chart, dataset) {
  return {
    dataset,
    closest(selector) {
      if (selector === "[data-chart-tooltip]") return this;
      if (selector === ".mdx-chart") return chart;
      return null;
    },
    getBoundingClientRect: () => ({ left: 440, top: 260, width: 32, height: 250 }),
  };
}

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

function createElement({ dataset = {}, hidden = false, rect = {} } = {}) {
  const classes = new Set();
  const attributes = new Map();
  return {
    dataset,
    hidden,
    textContent: "",
    style: {},
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getBoundingClientRect: () => rect,
  };
}
