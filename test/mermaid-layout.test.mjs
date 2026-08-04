import assert from "node:assert/strict";
import test from "node:test";

import {
  mermaidFlowchartSourceInfo,
  mermaidNodeOverlapCount,
  mermaidShouldExploreSmartLayouts,
  mermaidSmartLayoutCandidateOptions,
  mermaidSourceWithFlowchartDirection,
  mermaidSvgMetrics,
  selectMermaidSmartLayout,
} from "../public/mermaid-layout.js";

test("Mermaid smart layout recognizes portable flowcharts without rewriting stored source", () => {
  const source = [
    "---",
    "title: Example",
    "---",
    "flowchart LR",
    "  A --> B",
  ].join("\n");
  const info = mermaidFlowchartSourceInfo(source);

  assert.deepEqual(
    {
      keyword: info?.keyword,
      direction: info?.direction,
      explicitDirection: info?.explicitDirection,
      explicitLayout: info?.explicitLayout,
    },
    {
      keyword: "flowchart",
      direction: "LR",
      explicitDirection: true,
      explicitLayout: false,
    },
  );
  assert.equal(
    mermaidSourceWithFlowchartDirection(source, "TB"),
    source.replace("flowchart LR", "flowchart TB"),
  );
  assert.equal(source.includes("flowchart LR"), true);
});

test("Mermaid smart layout respects an author-selected layout engine", () => {
  const source = [
    "---",
    "config:",
    "  layout: elk",
    "---",
    "graph TD",
    "  A --> B",
  ].join("\n");
  const info = mermaidFlowchartSourceInfo(source);

  assert.equal(info?.direction, "TB");
  assert.equal(info?.explicitLayout, true);
  assert.equal(mermaidShouldExploreSmartLayouts(info, {
    nodeCount: 20,
    edgeCount: 30,
    aspectRatio: 4,
  }), false);
});

test("Mermaid SVG metrics count topology and identify extreme aspect ratios", () => {
  const metrics = mermaidSvgMetrics(svgFixture({
    width: 3_200,
    height: 240,
    nodes: 9,
    edges: 10,
    clusters: 2,
  }));

  assert.deepEqual(metrics, {
    x: 0,
    y: 0,
    width: 3_200,
    height: 240,
    aspectRatio: 3_200 / 240,
    nodeCount: 9,
    edgeCount: 10,
    clusterCount: 2,
  });
  assert.equal(mermaidShouldExploreSmartLayouts(
    mermaidFlowchartSourceInfo("flowchart LR\nA --> B"),
    metrics,
  ), true);
});

test("Mermaid smart layout offers a top-to-bottom overview for a dense horizontal flowchart", () => {
  const info = mermaidFlowchartSourceInfo("flowchart LR\nA --> B");
  const candidates = mermaidSmartLayoutCandidateOptions(info, {
    nodeCount: 13,
    edgeCount: 16,
    aspectRatio: 5,
  });

  assert.deepEqual(candidates.map(({ id }) => id), [
    "dagre-tb",
  ]);
  assert.deepEqual(candidates.map(({ purpose }) => purpose), [
    "overview",
  ]);
  assert.equal(candidates[0]?.readingPriority, true);
});

test("Mermaid smart layout never turns a vertical flowchart horizontal", () => {
  const candidates = mermaidSmartLayoutCandidateOptions(
    mermaidFlowchartSourceInfo("flowchart TB\nA --> B"),
    { nodeCount: 13, edgeCount: 16, aspectRatio: 0.28 },
  );

  assert.deepEqual(candidates, []);
});

test("Mermaid smart layout selects a materially more legible candidate without losing topology", () => {
  const original = {
    id: "source",
    svg: svgFixture({ width: 3_200, height: 240, nodes: 13, edges: 16 }),
  };
  const balanced = {
    id: "dagre-tb",
    family: "layered",
    purpose: "overview",
    svg: svgFixture({ width: 1_050, height: 720, nodes: 13, edges: 16 }),
  };
  const incomplete = {
    id: "invalid",
    family: "layered",
    svg: svgFixture({ width: 800, height: 600, nodes: 12, edges: 16 }),
  };
  const selection = selectMermaidSmartLayout(original, [balanced, incomplete], {
    viewportWidth: 1_000,
  });

  assert.equal(selection?.improved, true);
  assert.equal(selection?.selected.id, "dagre-tb");
  assert.equal(selection?.candidates.some(({ id }) => id === "invalid"), false);
  assert.ok(selection.selected.presentation.fontSize > selection.original.presentation.fontSize);
});

test("Mermaid smart layout treats a safe vertical candidate as the reading default", () => {
  const original = {
    id: "source",
    svg: svgFixture({ width: 800, height: 400, nodes: 13, edges: 16 }),
  };
  const vertical = {
    id: "dagre-tb",
    family: "layered",
    purpose: "overview",
    readingPriority: true,
    svg: svgFixture({ width: 400, height: 1_600, nodes: 13, edges: 16 }),
  };

  const selection = selectMermaidSmartLayout(original, [vertical], { viewportWidth: 1_000 });
  assert.equal(selection?.improved, true);
  assert.equal(selection?.selected.id, "dagre-tb");
  assert.ok(selection.selected.presentation.fontSize < selection.original.presentation.fontSize);
});

test("Mermaid smart layout rejects a balanced candidate whose nodes overlap", () => {
  const original = {
    id: "source",
    svg: svgFixture({ width: 3_200, height: 240, nodes: 13, edges: 16 }),
  };
  const overlapping = {
    id: "overlapping-layout",
    family: "network",
    purpose: "overview",
    metrics: {
      ...mermaidSvgMetrics(svgFixture({ width: 900, height: 600, nodes: 13, edges: 16 })),
      overlapCount: 2,
    },
    svg: svgFixture({ width: 900, height: 600, nodes: 13, edges: 16 }),
  };

  const selection = selectMermaidSmartLayout(original, [overlapping], { viewportWidth: 1_000 });
  assert.equal(selection?.improved, false);
  assert.equal(selection?.selected.id, "source");
});

function svgFixture({ width, height, nodes, edges, clusters = 0 }) {
  return [
    `<svg viewBox="0 0 ${width} ${height}">`,
    ...Array.from({ length: nodes }, (_, index) => `<g class="node default" data-id="N${index}"></g>`),
    ...Array.from({ length: edges }, () => '<path class="edge-thickness-normal flowchart-link" />'),
    ...Array.from({ length: clusters }, () => '<g class="cluster"></g>'),
    "</svg>",
  ].join("");
}
