export function attachChartTooltips(container, { root = document.body } = {}) {
  const tooltip = root.querySelector(".chart-tooltip") ?? createTooltip(root);

  const hide = () => {
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
