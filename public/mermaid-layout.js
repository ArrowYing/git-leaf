const FLOWCHART_START_RE = /^([\t ]*)(flowchart(?:-elk)?|graph)(?:[\t ]+(TB|TD|BT|LR|RL))?(?=[\t ]*(?:;|$))/im;
const FLOWCHART_DIRECTIONS = new Set(["TB", "BT", "LR", "RL"]);
const DEFAULT_DIRECTION = "TB";

export const MERMAID_SMART_LAYOUT_NODE_THRESHOLD = 7;
export const MERMAID_SMART_LAYOUT_EDGE_THRESHOLD = 8;
export const MERMAID_SMART_LAYOUT_MAX_NODES = 80;
export const MERMAID_SMART_LAYOUT_MAX_EDGES = 160;

export function mermaidFlowchartSourceInfo(source) {
  const text = String(source ?? "");
  const match = FLOWCHART_START_RE.exec(text);
  if (!match) return null;

  const keyword = match[2].toLowerCase();
  const direction = normalizeFlowchartDirection(match[3]);
  const frontmatter = mermaidFrontmatter(text);
  const initDirective = text.match(/%%\{[\s\S]*?\}%%/)?.[0] ?? "";
  const explicitLayout = keyword.endsWith("-elk")
    || /(?:^|\s)layout\s*:/im.test(frontmatter)
    || /(?:layout|defaultRenderer)\s*:/i.test(initDirective);

  return {
    keyword,
    direction,
    explicitDirection: Boolean(match[3]),
    explicitLayout,
    start: match.index,
    end: match.index + match[0].length,
    indent: match[1],
  };
}

export function mermaidSourceWithFlowchartDirection(source, direction) {
  const text = String(source ?? "");
  const info = mermaidFlowchartSourceInfo(text);
  const normalizedDirection = normalizeFlowchartDirection(direction);
  if (!info || !FLOWCHART_DIRECTIONS.has(normalizedDirection)) return text;

  const keyword = info.keyword === "flowchart-elk" ? "flowchart" : info.keyword;
  return text.slice(0, info.start)
    + `${info.indent}${keyword} ${normalizedDirection}`
    + text.slice(info.end);
}

export function mermaidSvgMetrics(svg) {
  const source = String(svg ?? "");
  const viewBox = source.match(/<svg\b[^>]*\bviewBox=["']\s*([^"']+)["']/i)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = viewBox?.length === 4 && viewBox.every(Number.isFinite) ? viewBox[2] : 0;
  const height = viewBox?.length === 4 && viewBox.every(Number.isFinite) ? viewBox[3] : 0;

  return {
    x: width > 0 ? viewBox[0] : 0,
    y: height > 0 ? viewBox[1] : 0,
    width,
    height,
    aspectRatio: width > 0 && height > 0 ? width / height : 0,
    nodeCount: svgClassTokenCount(source, "node"),
    edgeCount: svgClassTokenCount(source, "flowchart-link"),
    clusterCount: svgClassTokenCount(source, "cluster"),
  };
}

export function mermaidShouldExploreSmartLayouts(info, metrics) {
  if (!info || info.explicitLayout) return false;
  const nodeCount = Number(metrics?.nodeCount) || 0;
  const edgeCount = Number(metrics?.edgeCount) || 0;
  const aspectRatio = Number(metrics?.aspectRatio) || 0;
  if (
    nodeCount <= 0
    || nodeCount > MERMAID_SMART_LAYOUT_MAX_NODES
    || edgeCount > MERMAID_SMART_LAYOUT_MAX_EDGES
  ) {
    return false;
  }

  return nodeCount >= MERMAID_SMART_LAYOUT_NODE_THRESHOLD
    || edgeCount >= MERMAID_SMART_LAYOUT_EDGE_THRESHOLD
    || aspectRatio >= 2.8
    || (aspectRatio > 0 && aspectRatio <= 0.36);
}

export function mermaidSmartLayoutCandidateOptions(info, metrics = {}) {
  if (!mermaidShouldExploreSmartLayouts(info, metrics)) return [];
  const direction = normalizeFlowchartDirection(info.direction);
  if (direction === "TB" || direction === "BT") return [];

  return [
    {
      id: "dagre-tb",
      layout: "dagre",
      direction: "TB",
      family: "layered",
      purpose: "overview",
      readingPriority: true,
    },
  ];
}

export function mermaidLayoutPresentation(metrics, {
  viewportWidth = 1_000,
  padding = 36,
  minHeight = 240,
  maxHeight = 560,
  fontSize = 14,
  family = "source",
} = {}) {
  const width = Number(metrics?.width) || 0;
  const height = Number(metrics?.height) || 0;
  const overlapCount = Number(metrics?.overlapCount) || 0;
  const availableWidth = Math.max(1, Number(viewportWidth) - padding);
  if (width <= 0 || height <= 0 || overlapCount > 0) {
    return { score: Number.NEGATIVE_INFINITY, scale: 0, fontSize: 0, viewportHeight: minHeight };
  }

  const fittedHeight = availableWidth * height / width + padding;
  const viewportHeight = Math.max(minHeight, Math.min(maxHeight, fittedHeight));
  const availableHeight = Math.max(1, viewportHeight - padding);
  const scale = Math.min(availableWidth / width, availableHeight / height);
  const displayedFontSize = Math.min(fontSize, fontSize * scale);
  const aspectRatio = width / height;
  const aspectDistance = Math.abs(Math.log(aspectRatio / 1.6));
  const familyPenalty = family === "network" ? 0.6 : family === "source" ? -0.15 : 0;
  const score = displayedFontSize * 10 - aspectDistance * 1.5 - familyPenalty;

  return {
    score,
    scale,
    fontSize: displayedFontSize,
    viewportHeight: Math.round(viewportHeight),
  };
}

export function selectMermaidSmartLayout(original, candidates, { viewportWidth = 1_000 } = {}) {
  if (!original?.svg) return null;
  const originalMetrics = original.metrics ?? mermaidSvgMetrics(original.svg);
  const originalPresentation = mermaidLayoutPresentation(originalMetrics, {
    viewportWidth,
    family: "source",
  });
  const sourceCandidate = {
    ...original,
    id: original.id ?? "source",
    family: "source",
    metrics: originalMetrics,
    presentation: originalPresentation,
  };

  const comparable = [sourceCandidate];
  for (const candidate of candidates ?? []) {
    if (!candidate?.svg) continue;
    const metrics = candidate.metrics ?? mermaidSvgMetrics(candidate.svg);
    if (!sameMermaidTopology(originalMetrics, metrics)) continue;
    comparable.push({
      ...candidate,
      metrics,
      presentation: mermaidLayoutPresentation(metrics, {
        viewportWidth,
        family: candidate.family,
      }),
    });
  }

  const readingPriority = comparable.find((candidate) => (
    candidate.readingPriority && Number.isFinite(candidate.presentation.score)
  ));
  const best = readingPriority ?? comparable.reduce((selected, candidate) => (
    candidate.presentation.score > selected.presentation.score ? candidate : selected
  ), sourceCandidate);
  if (best.id === sourceCandidate.id) {
    return { original: sourceCandidate, selected: sourceCandidate, improved: false, candidates: comparable };
  }

  const fontGain = best.presentation.fontSize - sourceCandidate.presentation.fontSize;
  const scaleRatio = sourceCandidate.presentation.scale > 0
    ? best.presentation.scale / sourceCandidate.presentation.scale
    : Number.POSITIVE_INFINITY;
  const materiallyBetter = best.readingPriority
    || fontGain >= 0.75
    || scaleRatio >= 1.12
    || (sourceCandidate.presentation.fontSize < 9 && fontGain >= 0.4);

  return {
    original: sourceCandidate,
    selected: materiallyBetter ? best : sourceCandidate,
    improved: materiallyBetter,
    candidates: comparable,
  };
}

export function mermaidNodeOverlapCount(nodeBounds, nodeIds) {
  const entries = normalizedNodeBounds(nodeBounds, nodeIds);
  let count = 0;
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      if (rectanglesOverlap(entries[leftIndex][1], entries[rightIndex][1])) count += 1;
    }
  }
  return count;
}

function mermaidFrontmatter(source) {
  return String(source ?? "").match(/^\s*---[\t ]*\r?\n([\s\S]*?)\r?\n---[\t ]*(?:\r?\n|$)/)?.[1] ?? "";
}

function normalizeFlowchartDirection(direction) {
  const value = String(direction ?? "").toUpperCase();
  if (value === "TD") return "TB";
  return FLOWCHART_DIRECTIONS.has(value) ? value : DEFAULT_DIRECTION;
}

function svgClassTokenCount(svg, token) {
  let count = 0;
  for (const match of String(svg ?? "").matchAll(/\bclass=["']([^"']*)["']/gi)) {
    if (match[1].split(/\s+/).includes(token)) count += 1;
  }
  return count;
}

function sameMermaidTopology(original, candidate) {
  return original.nodeCount === candidate.nodeCount
    && original.edgeCount === candidate.edgeCount
    && original.clusterCount === candidate.clusterCount;
}

function normalizedNodeBounds(nodeBounds, nodeIds) {
  const source = nodeBounds instanceof Map
    ? [...nodeBounds.entries()]
    : Object.entries(nodeBounds ?? {});
  const allowed = nodeIds ? new Set([...nodeIds].map(String)) : null;
  return source.filter(([id, bounds]) => (
    (!allowed || allowed.has(String(id)))
    && Number.isFinite(Number(bounds?.x))
    && Number.isFinite(Number(bounds?.y))
    && Number(bounds?.width) > 0
    && Number(bounds?.height) > 0
  )).map(([id, bounds]) => [String(id), {
    x: Number(bounds.x),
    y: Number(bounds.y),
    width: Number(bounds.width),
    height: Number(bounds.height),
  }]);
}

function rectanglesOverlap(left, right) {
  const epsilon = 0.5;
  return left.x + left.width > right.x + epsilon
    && right.x + right.width > left.x + epsilon
    && left.y + left.height > right.y + epsilon
    && right.y + right.height > left.y + epsilon;
}
