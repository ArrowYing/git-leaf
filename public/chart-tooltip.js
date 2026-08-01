const chartMarkCache = new WeakMap();

export function attachChartTooltips(container, { root = document.body } = {}) {
  const tooltip = root.querySelector(".chart-tooltip") ?? createTooltip(root);
  let activeColumn = null;

  const hide = () => {
    clearActiveColumn(activeColumn);
    activeColumn = null;
    tooltip.hidden = true;
    tooltip.textContent = "";
  };

  const show = (target, clientX, clientY) => {
    const text = tooltipText(target);
    if (!text) {
      hide();
      return;
    }

    tooltip.textContent = text;
    tooltip.hidden = false;
    activeColumn = activateChartColumn(target, activeColumn);
    positionTooltip(tooltip, clientX, clientY);
  };

  const onPointerMove = (event) => {
    const target = event.target.closest?.("[data-chart-tooltip]");
    if (!target || !container.contains(target)) {
      hide();
      return;
    }
    show(target, event.clientX, event.clientY);
  };

  const onFocusIn = (event) => {
    const target = event.target.closest?.("[data-chart-tooltip]");
    if (!target || !container.contains(target)) {
      return;
    }
    const rect = target.getBoundingClientRect();
    show(target, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerleave", hide);
  container.addEventListener("focusin", onFocusIn);
  container.addEventListener("focusout", hide);

  return {
    hide,
    destroy() {
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", hide);
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("focusout", hide);
      hide();
    },
  };
}

function activateChartColumn(target, current) {
  const chart = target.closest?.(".mdx-chart");
  const index = String(target.dataset.chartXIndex ?? "");
  if (!chart || !index) {
    clearActiveColumn(current);
    return null;
  }
  if (current?.chart === chart && current.index === index) {
    return current;
  }

  clearActiveColumn(current);
  const marks = chartMarksByIndex(chart).get(index) ?? [];
  const guide = chart.querySelector(".mdx-chart-active-guide");
  const position = chartXPosition(chart, target, index);
  chart.classList.add("has-active-column");
  for (const mark of marks) {
    mark.classList.add("is-active");
  }
  if (guide && position !== null) {
    guide.setAttribute("x1", position);
    guide.setAttribute("x2", position);
    guide.classList.add("is-active");
  }
  return { chart, guide, index, marks };
}

function clearActiveColumn(active) {
  if (!active) return;
  active.chart.classList.remove("has-active-column");
  for (const mark of active.marks) {
    mark.classList.remove("is-active");
  }
  active.guide?.classList.remove("is-active");
}

function chartMarksByIndex(chart) {
  const cached = chartMarkCache.get(chart);
  if (cached) return cached;
  const result = new Map();
  for (const mark of chart.querySelectorAll("[data-chart-mark][data-chart-x-index]")) {
    const index = String(mark.dataset.chartXIndex ?? "");
    const marks = result.get(index) ?? [];
    marks.push(mark);
    result.set(index, marks);
  }
  chartMarkCache.set(chart, result);
  return result;
}

function chartXPosition(chart, target, index) {
  const direct = finiteNumber(target.dataset.chartXPosition);
  if (direct !== null) return String(target.dataset.chartXPosition);
  const region = [...chart.querySelectorAll(".mdx-chart-x-hit-target[data-chart-x-index]")]
    .find((candidate) => String(candidate.dataset.chartXIndex ?? "") === index);
  const fallback = finiteNumber(region?.dataset.chartXPosition);
  return fallback === null ? null : String(region.dataset.chartXPosition);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function createTooltip(root) {
  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.hidden = true;
  tooltip.setAttribute("role", "tooltip");
  root.append(tooltip);
  return tooltip;
}

function tooltipText(target) {
  return String(target.dataset.chartTooltip || "")
    .split(/\\n|\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function positionTooltip(tooltip, clientX, clientY) {
  const offset = 14;
  const margin = 10;
  const rect = tooltip.getBoundingClientRect();
  let left = clientX + offset;
  let top = clientY - rect.height / 2;

  if (left + rect.width + margin > window.innerWidth) {
    left = clientX - rect.width - offset;
  }
  top = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin));

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}
