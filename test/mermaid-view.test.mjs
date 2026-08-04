import assert from "node:assert/strict";
import test from "node:test";

import {
  MERMAID_MAX_SOURCE_LENGTH,
  mermaidConfiguration,
  renderMermaidDiagram,
  safeMermaidSvg,
} from "../src/client/mermaid-renderer.mjs";
import {
  clampMermaidViewState,
  initialMermaidViewState,
  mermaidViewStateAfterAction,
} from "../public/mermaid-view.js";

test("Mermaid rendering uses the strict local security boundary in both themes", () => {
  const light = mermaidConfiguration("light");
  const dark = mermaidConfiguration("dark");

  assert.equal(light.startOnLoad, false);
  assert.equal(light.securityLevel, "strict");
  assert.equal(light.suppressErrorRendering, true);
  assert.equal(light.maxTextSize, MERMAID_MAX_SOURCE_LENGTH);
  assert.equal(light.flowchart.useMaxWidth, true);
  assert.notEqual(light.themeVariables.background, dark.themeVariables.background);
  assert.notEqual(light.themeVariables.primaryTextColor, dark.themeVariables.primaryTextColor);
});

test("Mermaid SVG validation rejects executable markup", () => {
  assert.equal(
    safeMermaidSvg('<svg viewBox="0 0 10 10"><path marker-end="url(#arrow)" d="M0 0h10" /><use href="#node" /></svg>'),
    '<svg viewBox="0 0 10 10"><path marker-end="url(#arrow)" d="M0 0h10" /><use href="#node" /></svg>',
  );

  for (const unsafe of [
    "<div>not svg</div>",
    "<svg><script>alert(1)</script></svg>",
    '<svg onload="alert(1)"></svg>',
    '<svg><a href="javascript:alert(1)">open</a></svg>',
    '<svg><image href="https://example.com/tracker.png" /></svg>',
    '<svg><use href="https://example.com/icons.svg#node" /></svg>',
    '<svg><style>@import "https://example.com/style.css"</style></svg>',
  ]) {
    assert.throws(() => safeMermaidSvg(unsafe), /unsafe SVG/);
  }
});

test("Mermaid rendering rejects oversized source before invoking the browser renderer", async () => {
  await assert.rejects(
    renderMermaidDiagram("x".repeat(MERMAID_MAX_SOURCE_LENGTH + 1)),
    /exceeds the supported size/,
  );
});

test("Mermaid view controls clamp zoom and reset pan when returning to fit", () => {
  let state = initialMermaidViewState();
  assert.deepEqual(state, { scale: 1, x: 0, y: 0, sourceVisible: false });

  for (let index = 0; index < 20; index += 1) {
    state = mermaidViewStateAfterAction(state, "zoom-in");
  }
  assert.equal(state.scale, 3);

  state = clampMermaidViewState({ ...state, x: 999, y: -999 }, {
    width: 400,
    height: 200,
  });
  assert.deepEqual({ x: state.x, y: state.y }, { x: 400, y: -200 });

  state = mermaidViewStateAfterAction(state, "source");
  assert.equal(state.sourceVisible, true);
  state = mermaidViewStateAfterAction(state, "fit");
  assert.deepEqual(state, initialMermaidViewState());

  for (let index = 0; index < 20; index += 1) {
    state = mermaidViewStateAfterAction(state, "zoom-out");
  }
  assert.equal(state.scale, 0.75);
  assert.deepEqual({ x: state.x, y: state.y }, { x: 0, y: 0 });
});
