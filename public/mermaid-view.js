const DIAGRAM_SELECTOR = "[data-mermaid-diagram]";
const MIN_SCALE = 0.75;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

let rendererModulePromise = null;

export function attachMermaidDiagrams(
  root,
  {
    getTheme = () => "light",
    render = renderWithBundledMermaid,
  } = {},
) {
  if (!root?.querySelectorAll) {
    return { hydrate: () => {}, rerender: () => {}, destroy: () => {} };
  }

  const states = new WeakMap();
  const requests = new WeakMap();
  let drag = null;

  const hydrate = (scope = root, { force = false } = {}) => {
    for (const diagram of diagramsWithin(scope)) {
      if (!force && diagram.dataset.mermaidHydrated === "true") continue;
      diagram.dataset.mermaidHydrated = "true";
      states.set(diagram, states.get(diagram) ?? initialMermaidViewState());
      updateMermaidView(diagram, states.get(diagram));
      void hydrateDiagram(diagram, {
        render,
        theme: getTheme(diagram),
        requests,
      });
    }
  };

  const handleClick = (event) => {
    const button = event.target?.closest?.("[data-mermaid-action]");
    const diagram = button?.closest?.(DIAGRAM_SELECTOR);
    if (!button || !diagram || !root.contains(diagram)) return;
    event.preventDefault();
    event.stopPropagation();
    const current = states.get(diagram) ?? initialMermaidViewState();
    const next = mermaidViewStateAfterAction(current, button.dataset.mermaidAction);
    states.set(diagram, next);
    updateMermaidView(diagram, next);
  };

  const handlePointerDown = (event) => {
    const viewport = event.target?.closest?.("[data-mermaid-viewport]");
    const diagram = viewport?.closest?.(DIAGRAM_SELECTOR);
    if (!viewport || !diagram || !root.contains(diagram)) return;
    const state = states.get(diagram) ?? initialMermaidViewState();
    if (state.sourceVisible || state.scale <= 1) return;
    event.preventDefault();
    event.stopPropagation();
    drag = {
      diagram,
      pointerId: event.pointerId,
      startX: event.clientX - state.x,
      startY: event.clientY - state.y,
    };
    viewport.setPointerCapture?.(event.pointerId);
    diagram.classList.add("is-mermaid-dragging");
  };

  const handlePointerMove = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = states.get(drag.diagram) ?? initialMermaidViewState();
    const viewport = drag.diagram.querySelector("[data-mermaid-viewport]");
    const rect = viewport?.getBoundingClientRect?.() ?? { width: 0, height: 0 };
    const next = clampMermaidViewState({
      ...current,
      x: event.clientX - drag.startX,
      y: event.clientY - drag.startY,
    }, rect);
    states.set(drag.diagram, next);
    updateMermaidView(drag.diagram, next);
  };

  const finishDrag = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const viewport = drag.diagram.querySelector("[data-mermaid-viewport]");
    drag.diagram.classList.remove("is-mermaid-dragging");
    viewport?.releasePointerCapture?.(event.pointerId);
    drag = null;
  };

  const observer = typeof MutationObserver === "function"
    ? new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) hydrate(node);
          }
        }
      })
    : null;

  root.addEventListener("click", handleClick);
  root.addEventListener("pointerdown", handlePointerDown);
  root.addEventListener("pointermove", handlePointerMove);
  root.addEventListener("pointerup", finishDrag);
  root.addEventListener("pointercancel", finishDrag);
  observer?.observe(root, { childList: true, subtree: true });
  hydrate();

  return {
    hydrate,
    rerender(scope = root) {
      hydrate(scope, { force: true });
    },
    destroy() {
      observer?.disconnect();
      root.removeEventListener("click", handleClick);
      root.removeEventListener("pointerdown", handlePointerDown);
      root.removeEventListener("pointermove", handlePointerMove);
      root.removeEventListener("pointerup", finishDrag);
      root.removeEventListener("pointercancel", finishDrag);
    },
  };
}

export function initialMermaidViewState() {
  return { scale: 1, x: 0, y: 0, sourceVisible: false };
}

export function mermaidViewStateAfterAction(state, action) {
  const current = { ...initialMermaidViewState(), ...state };
  if (action === "fit") {
    return initialMermaidViewState();
  }
  if (action === "zoom-in") {
    return {
      ...current,
      scale: Math.min(MAX_SCALE, Number((current.scale + SCALE_STEP).toFixed(2))),
    };
  }
  if (action === "zoom-out") {
    const scale = Math.max(MIN_SCALE, Number((current.scale - SCALE_STEP).toFixed(2)));
    return {
      ...current,
      scale,
      x: scale <= 1 ? 0 : current.x,
      y: scale <= 1 ? 0 : current.y,
    };
  }
  if (action === "source") {
    return { ...current, sourceVisible: !current.sourceVisible };
  }
  return current;
}

export function clampMermaidViewState(state, { width = 0, height = 0 } = {}) {
  const current = { ...initialMermaidViewState(), ...state };
  if (current.scale <= 1) {
    return { ...current, x: 0, y: 0 };
  }
  const maxX = Math.max(0, Number(width) * (current.scale - 1) / 2);
  const maxY = Math.max(0, Number(height) * (current.scale - 1) / 2);
  return {
    ...current,
    x: Math.max(-maxX, Math.min(maxX, current.x)),
    y: Math.max(-maxY, Math.min(maxY, current.y)),
  };
}

async function hydrateDiagram(diagram, { render, theme, requests }) {
  const source = diagram.querySelector("[data-mermaid-source]")?.textContent ?? "";
  const canvas = diagram.querySelector("[data-mermaid-canvas]");
  const status = diagram.querySelector("[data-mermaid-status]");
  if (!canvas || !status) return;

  const requestId = (requests.get(diagram) ?? 0) + 1;
  requests.set(diagram, requestId);
  diagram.dataset.mermaidState = "loading";
  canvas.setAttribute("aria-busy", "true");
  status.hidden = false;
  status.textContent = diagram.dataset.mermaidLoadingMessage || "Rendering diagram…";

  try {
    const { svg } = await render(source, { theme });
    if (requests.get(diagram) !== requestId || diagram.isConnected === false) return;
    canvas.innerHTML = svg;
    canvas.setAttribute("aria-busy", "false");
    status.hidden = true;
    diagram.dataset.mermaidState = "ready";
  } catch {
    if (requests.get(diagram) !== requestId || diagram.isConnected === false) return;
    canvas.setAttribute("aria-busy", "false");
    if (!canvas.querySelector("svg")) canvas.replaceChildren();
    status.hidden = false;
    status.textContent = diagram.dataset.mermaidErrorMessage || "Diagram could not be rendered.";
    diagram.dataset.mermaidState = "error";
  }
}

function updateMermaidView(diagram, state) {
  const canvas = diagram.querySelector("[data-mermaid-canvas]");
  const viewport = diagram.querySelector("[data-mermaid-viewport]");
  const source = diagram.querySelector("[data-mermaid-source-view]");
  const zoomValue = diagram.querySelector("[data-mermaid-zoom-value]");
  const fitButton = diagram.querySelector('[data-mermaid-action="fit"]');
  const zoomOutButton = diagram.querySelector('[data-mermaid-action="zoom-out"]');
  const zoomInButton = diagram.querySelector('[data-mermaid-action="zoom-in"]');
  const sourceButton = diagram.querySelector('[data-mermaid-action="source"]');

  if (canvas) {
    canvas.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
  }
  if (viewport) viewport.hidden = state.sourceVisible;
  if (source) source.hidden = !state.sourceVisible;
  if (zoomValue) zoomValue.textContent = `${Math.round(state.scale * 100)}%`;
  if (fitButton) fitButton.disabled = state.sourceVisible;
  if (zoomOutButton) zoomOutButton.disabled = state.sourceVisible || state.scale <= MIN_SCALE;
  if (zoomInButton) zoomInButton.disabled = state.sourceVisible || state.scale >= MAX_SCALE;
  if (sourceButton) {
    const label = state.sourceVisible
      ? sourceButton.dataset.mermaidDiagramLabel || "Show diagram"
      : sourceButton.dataset.mermaidSourceLabel || "Show Mermaid source";
    sourceButton.setAttribute("aria-pressed", String(state.sourceVisible));
    sourceButton.setAttribute("aria-label", label);
    sourceButton.dataset.uiTooltip = label;
  }
  diagram.classList.toggle("is-mermaid-source-visible", state.sourceVisible);
  diagram.classList.toggle("is-mermaid-pannable", !state.sourceVisible && state.scale > 1);
}

function diagramsWithin(scope) {
  const diagrams = [];
  if (scope?.matches?.(DIAGRAM_SELECTOR)) diagrams.push(scope);
  for (const diagram of scope?.querySelectorAll?.(DIAGRAM_SELECTOR) ?? []) {
    diagrams.push(diagram);
  }
  return diagrams;
}

async function renderWithBundledMermaid(source, options) {
  rendererModulePromise ??= import(
    new URL("./mermaid-renderer.bundle.js", import.meta.url).href
  );
  const renderer = await rendererModulePromise;
  return renderer.renderMermaidDiagram(source, options);
}
