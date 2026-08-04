import assert from "node:assert/strict";
import test from "node:test";

import {
  mermaidFlowchartSourceInfo,
  mermaidFocusDiagram,
  mermaidGraphEntryNode,
  mermaidGraphFocus,
  mermaidNodeOverlapCount,
  mermaidShouldGuideReading,
  mermaidShouldExploreSmartLayouts,
  mermaidShouldOfferFocus,
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

test("Mermaid smart layout separates overview candidates from a local focus candidate", () => {
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

test("Mermaid node focus keeps the selected node and its direct inputs and outputs", () => {
  const graph = {
    nodes: ["A", "B", "C", "D", "E", "F", "G"].map((id) => ({ id, label: id })),
    edges: [
      { id: "ab", start: "A", end: "B" },
      { id: "bc", start: "B", end: "C" },
      { id: "db", start: "D", end: "B" },
      { id: "ef", start: "E", end: "F" },
    ],
  };
  const focus = mermaidGraphFocus(graph, "B");

  assert.deepEqual([...focus.nodeIds].sort(), ["A", "B", "C", "D"]);
  assert.deepEqual([...focus.edgeIds].sort(), ["ab", "bc", "db"]);
  assert.equal(focus.incoming, 2);
  assert.equal(focus.outgoing, 1);
  assert.equal(mermaidShouldOfferFocus(graph), true);
  assert.equal(mermaidGraphEntryNode(graph), "A");
});

test("Mermaid guided reading starts from topology instead of business vocabulary", () => {
  const graph = {
    nodes: ["middle", "entry", "tail", "other"].map((id) => ({ id, label: id })),
    edges: [
      { start: "entry", end: "middle" },
      { start: "middle", end: "tail" },
    ],
  };
  const selection = {
    selected: {
      metrics: { aspectRatio: 8 },
      presentation: { fontSize: 7 },
    },
  };

  assert.equal(mermaidGraphEntryNode(graph), "entry");
  assert.equal(mermaidShouldGuideReading(selection, {
    graph,
    info: mermaidFlowchartSourceInfo("flowchart LR\nentry --> middle"),
  }), false);

  const complexGraph = {
    nodes: Array.from({ length: 7 }, (_, index) => ({ id: `N${index}` })),
    edges: Array.from({ length: 6 }, (_, index) => ({ start: `N${index}`, end: `N${index + 1}` })),
  };
  assert.equal(mermaidShouldGuideReading(selection, {
    graph: complexGraph,
    info: mermaidFlowchartSourceInfo("flowchart LR\nN0 --> N1"),
  }), true);
});

test("Mermaid focus view derives a portable one-hop diagram without business rules", () => {
  const graph = {
    nodes: ["A", "B", "C", "D", "E", "F", "G"].map((id) => ({ id, label: `Node ${id}` })),
    edges: [
      { id: "ab", start: "A", end: "B" },
      { id: "bc", start: "B", end: "C", label: "next" },
      { id: "db", start: "D", end: "B" },
      { id: "ef", start: "E", end: "F" },
    ],
  };
  const focus = mermaidFocusDiagram(graph, "B");

  assert.equal(focus?.focus.nodeIds.size, 4);
  assert.deepEqual(Object.values(focus?.nodeIdByAlias ?? {}), ["A", "B", "C", "D"]);
  assert.match(focus?.source ?? "", /^flowchart LR/m);
  assert.match(focus?.source ?? "", /Node A/);
  assert.match(focus?.source ?? "", /-->\|next\|/);
  assert.doesNotMatch(focus?.source ?? "", /Node E|Node F|Node G/);
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
