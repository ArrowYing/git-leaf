import {
  mermaidFlowchartSourceInfo,
  mermaidNodeOverlapCount,
  mermaidSmartLayoutCandidateOptions,
  mermaidSvgMetrics,
  selectMermaidSmartLayout,
} from "./mermaid-layout.js";

const DIAGRAM_SELECTOR = "[data-mermaid-diagram]";
const MIN_SCALE = 0.75;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;
const DEFAULT_VIEWPORT_HEIGHT = 360;
const MIN_VIEWPORT_HEIGHT = 240;
const MAX_VIEWPORT_HEIGHT = 560;
const VIEWPORT_PADDING = 36;

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
  const layouts = new WeakMap();
  const measuredWidths = new WeakMap();
  let drag = null;

  const resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = Math.round(entry.contentRect?.width ?? 0);
          if (width <= 0 || measuredWidths.get(entry.target) === width) continue;
          measuredWidths.set(entry.target, width);
          updateMermaidViewportLayout(entry.target, { viewportWidth: width });
        }
      })
    : null;

  const hydrate = (scope = root, { force = false } = {}) => {
    for (const diagram of diagramsWithin(scope)) {
      if (!force && diagram.dataset.mermaidHydrated === "true") continue;
      diagram.dataset.mermaidHydrated = "true";
      states.set(diagram, states.get(diagram) ?? initialMermaidViewState());
      resizeObserver?.observe(diagram);
      updateMermaidView(diagram, states.get(diagram));
      void hydrateDiagram(diagram, {
        render,
        theme: getTheme(diagram),
        requests,
        states,
        layouts,
      });
    }
  };

  const handleClick = (event) => {
    const button = event.target?.closest?.("[data-mermaid-action]");
    const actionDiagram = button?.closest?.(DIAGRAM_SELECTOR);
    if (button && actionDiagram && root.contains(actionDiagram)) {
      event.preventDefault();
      event.stopPropagation();
      const current = states.get(actionDiagram) ?? initialMermaidViewState();
      const next = mermaidViewStateAfterAction(current, button.dataset.mermaidAction);
      states.set(actionDiagram, next);
      if (button.dataset.mermaidAction === "smart-layout") {
        const layout = layouts.get(actionDiagram);
        applyMermaidRenderedLayout(actionDiagram, next, layout);
      }
      updateMermaidView(actionDiagram, next, layouts.get(actionDiagram));
    }
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
      resizeObserver?.disconnect();
      root.removeEventListener("click", handleClick);
      root.removeEventListener("pointerdown", handlePointerDown);
      root.removeEventListener("pointermove", handlePointerMove);
      root.removeEventListener("pointerup", finishDrag);
      root.removeEventListener("pointercancel", finishDrag);
    },
  };
}

export function initialMermaidViewState() {
  return {
    scale: 1,
    x: 0,
    y: 0,
    sourceVisible: false,
    smartLayout: true,
  };
}

export function mermaidViewStateAfterAction(state, action) {
  const current = { ...initialMermaidViewState(), ...state };
  if (action === "fit") {
    return { ...current, scale: 1, x: 0, y: 0, sourceVisible: false };
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
  if (action === "smart-layout") {
    return {
      ...current,
      scale: 1,
      x: 0,
      y: 0,
      smartLayout: !current.smartLayout,
    };
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

export function mermaidViewportHeight({
  viewportWidth,
  viewBoxWidth,
  viewBoxHeight,
  padding = VIEWPORT_PADDING,
  minHeight = MIN_VIEWPORT_HEIGHT,
  maxHeight = MAX_VIEWPORT_HEIGHT,
  fallbackHeight = DEFAULT_VIEWPORT_HEIGHT,
} = {}) {
  const width = Number(viewportWidth);
  const diagramWidth = Number(viewBoxWidth);
  const diagramHeight = Number(viewBoxHeight);
  if (
    !Number.isFinite(width)
    || !Number.isFinite(diagramWidth)
    || !Number.isFinite(diagramHeight)
    || width <= 0
    || diagramWidth <= 0
    || diagramHeight <= 0
  ) {
    return fallbackHeight;
  }

  const inset = Math.max(0, Number(padding) || 0);
  const lowerBound = Math.max(0, Number(minHeight) || 0);
  const upperBound = Math.max(lowerBound, Number(maxHeight) || lowerBound);
  const fittedHeight = Math.max(0, width - inset) * diagramHeight / diagramWidth + inset;
  return Math.round(Math.max(lowerBound, Math.min(upperBound, fittedHeight)));
}

async function hydrateDiagram(diagram, {
  render,
  theme,
  requests,
  states,
  layouts,
}) {
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
    const originalResult = await render(source, { theme, includeGraph: true });
    if (requests.get(diagram) !== requestId || diagram.isConnected === false) return;
    const original = {
      ...originalResult,
      id: "source",
      family: "source",
      metrics: mermaidSvgMetrics(originalResult.svg),
    };
    original.geometry = measureMermaidCandidate(diagram, original, originalResult.graph);
    original.metrics.overlapCount = original.geometry.overlapCount;
    const sourceInfo = originalResult.flowchart ?? mermaidFlowchartSourceInfo(source);
    const candidateOptions = mermaidSmartLayoutCandidateOptions(sourceInfo, original.metrics);
    const candidateResults = [];
    for (const option of candidateOptions) {
      try {
        const result = await render(source, {
          theme,
          layout: option.layout,
          direction: option.direction,
          includeGraph: false,
        });
        if (requests.get(diagram) !== requestId || diagram.isConnected === false) return;
        candidateResults.push({
          ...result,
          ...option,
          metrics: mermaidSvgMetrics(result.svg),
        });
      } catch {
        // A failed optional layout must never replace or invalidate the source rendering.
      }
    }

    for (const candidate of candidateResults) {
      candidate.geometry = measureMermaidCandidate(diagram, candidate, originalResult.graph);
      candidate.metrics.overlapCount = candidate.geometry.overlapCount;
    }

    const viewportWidth = diagram.querySelector("[data-mermaid-viewport]")
      ?.getBoundingClientRect?.().width
      || diagram.getBoundingClientRect?.().width
      || 1_000;
    const selection = selectMermaidSmartLayout(original, candidateResults, { viewportWidth }) ?? {
      original,
      selected: original,
      improved: false,
    };
    const layout = {
      original: selection.original,
      overview: selection.selected,
      improved: selection.improved,
      graph: originalResult.graph,
    };
    layouts.set(diagram, layout);
    const state = { ...(states.get(diagram) ?? initialMermaidViewState()) };
    states.set(diagram, state);
    applyMermaidRenderedLayout(diagram, state, layout);
    updateMermaidView(diagram, state, layout);
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

function applyMermaidRenderedLayout(diagram, state, layout) {
  const canvas = diagram.querySelector("[data-mermaid-canvas]");
  if (!canvas || !layout?.original?.svg) return;
  const candidate = state.smartLayout && layout.improved ? layout.overview : layout.original;
  if (canvas.dataset.mermaidLayoutId !== candidate.id) {
    canvas.innerHTML = candidate.svg;
    canvas.dataset.mermaidLayoutId = candidate.id;
  }
  annotateMermaidGraph(canvas, layout.graph);
  const svg = canvas.querySelector("svg");
  const viewBox = [candidate.metrics.x, candidate.metrics.y, candidate.metrics.width, candidate.metrics.height];
  if (svg && viewBox.every(Number.isFinite)) svg.setAttribute("viewBox", viewBox.join(" "));
  diagram.dataset.mermaidLayout = candidate.id;
  diagram.dataset.mermaidReadingMode = "overview";
  updateMermaidViewportLayout(diagram);
}

function updateMermaidViewportLayout(diagram, { viewportWidth } = {}) {
  const viewport = diagram.querySelector?.("[data-mermaid-viewport]");
  const svg = diagram.querySelector?.("[data-mermaid-canvas] svg");
  const viewBox = svg?.getAttribute?.("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (!viewport || viewBox?.length !== 4 || !viewBox.every(Number.isFinite)) return;

  const width = Number(viewportWidth)
    || viewport.getBoundingClientRect?.().width
    || diagram.getBoundingClientRect?.().width
    || 0;
  const height = mermaidViewportHeight({
    viewportWidth: width,
    viewBoxWidth: viewBox[2],
    viewBoxHeight: viewBox[3],
  });
  diagram.style?.setProperty("--mermaid-viewport-height", `${height}px`);
}

function updateMermaidView(diagram, state, layout) {
  const canvas = diagram.querySelector("[data-mermaid-canvas]");
  const viewport = diagram.querySelector("[data-mermaid-viewport]");
  const source = diagram.querySelector("[data-mermaid-source-view]");
  const zoomValue = diagram.querySelector("[data-mermaid-zoom-value]");
  const fitButton = diagram.querySelector('[data-mermaid-action="fit"]');
  const zoomOutButton = diagram.querySelector('[data-mermaid-action="zoom-out"]');
  const zoomInButton = diagram.querySelector('[data-mermaid-action="zoom-in"]');
  const sourceButton = diagram.querySelector('[data-mermaid-action="source"]');
  const smartLayoutButton = diagram.querySelector('[data-mermaid-action="smart-layout"]');

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
  if (smartLayoutButton) {
    smartLayoutButton.hidden = !layout?.improved;
    smartLayoutButton.disabled = state.sourceVisible;
    smartLayoutButton.setAttribute(
      "aria-pressed",
      String(Boolean(layout?.improved && state.smartLayout)),
    );
  }
  diagram.classList.toggle("is-mermaid-source-visible", state.sourceVisible);
  diagram.classList.toggle("is-mermaid-pannable", !state.sourceVisible && state.scale > 1);
}

function annotateMermaidGraph(scope, graph) {
  const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  if (graphNodes.length === 0) return;
  const knownIds = new Set(graphNodes.map((node) => String(node.id)));
  for (const node of scope.querySelectorAll?.("g.node") ?? []) {
    if (knownIds.has(node.dataset.id)) continue;
    const generatedId = String(node.id ?? "");
    const parsedId = generatedId.match(/-flowchart-(.+)-\d+$/)?.[1] ?? "";
    if (knownIds.has(parsedId)) {
      node.dataset.id = parsedId;
      continue;
    }
    const indexed = graphNodes.find((graphNode, index) => (
      generatedId.endsWith(`-flowchart-${String(graphNode.id)}-${index}`)
    ));
    if (indexed) node.dataset.id = String(indexed.id);
  }
}

function measureMermaidCandidate(diagram, candidate, graph) {
  const document = diagram?.ownerDocument;
  const metrics = candidate?.metrics ?? mermaidSvgMetrics(candidate?.svg);
  if (!document?.body || !candidate?.svg || metrics.width <= 0 || metrics.height <= 0) {
    return { nodeBounds: {}, overlapCount: Number.POSITIVE_INFINITY };
  }

  const surface = document.createElement("div");
  surface.style.position = "fixed";
  surface.style.left = "-100000px";
  surface.style.top = "0";
  surface.style.width = `${Math.max(1, metrics.width)}px`;
  surface.style.height = `${Math.max(1, metrics.height)}px`;
  surface.style.visibility = "hidden";
  surface.style.pointerEvents = "none";
  surface.style.overflow = "hidden";
  surface.innerHTML = candidate.svg;
  document.body.append(surface);

  try {
    const svg = surface.querySelector("svg");
    if (!svg) return { nodeBounds: {}, overlapCount: Number.POSITIVE_INFINITY };
    svg.style.width = `${metrics.width}px`;
    svg.style.height = `${metrics.height}px`;
    svg.style.maxWidth = "none";
    annotateMermaidGraph(surface, graph);
    const svgRect = svg.getBoundingClientRect();
    if (svgRect.width <= 0 || svgRect.height <= 0) {
      return { nodeBounds: {}, overlapCount: Number.POSITIVE_INFINITY };
    }
    const scaleX = metrics.width / svgRect.width;
    const scaleY = metrics.height / svgRect.height;
    const nodeBounds = {};
    for (const node of surface.querySelectorAll("g.node[data-id]")) {
      const rect = node.getBoundingClientRect();
      nodeBounds[node.dataset.id] = {
        x: metrics.x + (rect.left - svgRect.left) * scaleX,
        y: metrics.y + (rect.top - svgRect.top) * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
      };
    }
    const complete = Object.keys(nodeBounds).length === (graph?.nodes?.length ?? 0);
    return {
      nodeBounds,
      overlapCount: complete
        ? mermaidNodeOverlapCount(nodeBounds)
        : Number.POSITIVE_INFINITY,
    };
  } finally {
    surface.remove();
  }
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
