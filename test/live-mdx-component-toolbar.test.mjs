import assert from "node:assert/strict";
import test from "node:test";

import {
  createLiveMdxComponentInteraction,
  liveMdxToolbarControlDefinitions,
  updateMdxLiteComponentAttributes,
} from "../src/client/source-editor.mjs";
import { mdxLiteComponentOpeningAtLines } from "../src/content/mdx-lite-syntax.mjs";

test("each MDX-lite component exposes only its small component-specific toolbar", () => {
  const expectedControls = {
    DataTable: ["search", "freeze", "sticky", "copy"],
    Timeline: [],
    Chart: ["type", "labels"],
    DecisionBox: ["status"],
    MetricGrid: [],
    FlowDiagram: [],
  };

  for (const [component, expected] of Object.entries(expectedControls)) {
    assert.deepEqual(
      liveMdxToolbarControlDefinitions(component).map((control) => control.id),
      expected,
      component,
    );
  }
});

test("toolbar definitions reflect aliases without duplicating the shared source action", () => {
  const tableControls = liveMdxToolbarControlDefinitions("DataTable", {
    freeze: "true",
    copy: "false",
    dataset: "./company.dataset.json",
  });
  assert.equal(tableControls.find((control) => control.id === "freeze").pressed, true);
  assert.equal(tableControls.find((control) => control.id === "copy").pressed, false);
  assert.equal(tableControls.some((control) => control.kind === "action"), false);
  assert.deepEqual(
    tableControls.map((control) => control.id),
    liveMdxToolbarControlDefinitions("DataTable").map((control) => control.id),
  );

  const chartControls = liveMdxToolbarControlDefinitions("Chart", {
    type: "combo",
    labels: "none",
  });
  assert.equal(chartControls.find((control) => control.id === "type").value, "combo");
  assert.equal(chartControls.find((control) => control.id === "labels").pressed, false);
  assert.deepEqual(
    chartControls.map((control) => control.id),
    liveMdxToolbarControlDefinitions("Chart", {
      dataset: "./company.dataset.json",
      type: "combo",
      labels: "none",
    }).map((control) => control.id),
  );

  const decisionControls = liveMdxToolbarControlDefinitions("DecisionBox", {
    decisionStatus: "proposed",
  });
  assert.equal(decisionControls.find((control) => control.id === "status").value, "proposed");
});

test("component toolbar updates attributes without rewriting body data", () => {
  const source = [
    "<Chart",
    '  title="Revenue"',
    '  type="line"',
    ">",
    "```csv",
    "month,revenue",
    "2026-07,120",
    "```",
    "</Chart>",
  ].join("\n");

  const updated = updateMdxLiteComponentAttributes(source, {
    type: "bar",
    labels: "none",
  });
  assert.equal(updated, [
    "<Chart",
    '  title="Revenue"',
    '  type="bar"',
    '  labels="none"',
    ">",
    "```csv",
    "month,revenue",
    "2026-07,120",
    "```",
    "</Chart>",
  ].join("\n"));
  assert.equal(
    mdxLiteComponentOpeningAtLines(updated.split("\n"), 0).attributes.labels,
    "none",
  );

  assert.equal(
    updateMdxLiteComponentAttributes(updated, { labels: null }),
    source.replace('type="line"', 'type="bar"'),
  );
});

test("component toolbar canonicalizes a decision status in one source rewrite", () => {
  const source = [
    '<DecisionBox title="Owner" decisionStatus="proposed">',
    "label,value",
    "Decision,Keep one owner",
    "</DecisionBox>",
  ].join("\n");
  const updated = updateMdxLiteComponentAttributes(source, {
    status: "accepted",
    decisionStatus: null,
  });

  assert.equal(updated, [
    '<DecisionBox title="Owner" status="accepted">',
    "label,value",
    "Decision,Keep one owner",
    "</DecisionBox>",
  ].join("\n"));
});

test("an active component toolbar owns Escape and clears when the pointer leaves the editor", () => {
  const fixture = componentInteractionFixture();
  const selectEvent = fixture.pointerEvent(fixture.componentTarget);
  assert.equal(fixture.interaction.handlePointerDown(selectEvent), true);
  assert.equal(selectEvent.defaultPrevented, true);
  assert.equal(fixture.interaction.hasSelection(), true);
  assert.equal(fixture.toolbar.hidden, false);

  const escapeEvent = fixture.keyEvent("Escape");
  assert.equal(fixture.interaction.handleKeyDown(escapeEvent), true);
  assert.equal(escapeEvent.defaultPrevented, true);
  assert.equal(escapeEvent.propagationStopped, true);
  assert.equal(fixture.interaction.hasSelection(), false);
  assert.equal(fixture.toolbar.hidden, true);

  fixture.interaction.handlePointerDown(fixture.pointerEvent(fixture.componentTarget));
  assert.equal(
    fixture.interaction.handleDocumentPointerDown({ target: fixture.outsideTarget }),
    true,
  );
  assert.equal(fixture.interaction.hasSelection(), false);
  assert.equal(fixture.toolbar.hidden, true);
});

function componentInteractionFixture() {
  const toolbar = {
    hidden: true,
    style: {},
    getBoundingClientRect: () => ({ width: 280, height: 36 }),
  };
  const card = {
    getBoundingClientRect: () => ({
      left: 100,
      right: 700,
      top: 180,
      bottom: 500,
      width: 600,
      height: 320,
    }),
  };
  const selectedClasses = new Set();
  const container = {
    dataset: {
      liveBlockStart: "3",
      liveBlockEnd: "10",
      liveMdxComponent: "Chart",
    },
    classList: {
      toggle(name, enabled) {
        if (enabled) {
          selectedClasses.add(name);
        } else {
          selectedClasses.delete(name);
        }
      },
    },
    querySelector(selector) {
      if (selector === ".cm-live-component-toolbar") {
        return toolbar;
      }
      if (selector === ".cm-live-block-preview-card") {
        return card;
      }
      return null;
    },
  };
  const componentTarget = {
    closest(selector) {
      return selector === ".cm-live-block-preview-mdx" ? container : null;
    },
  };
  const outsideTarget = {};
  const view = {
    dom: {
      contains: (target) => target === componentTarget,
      querySelectorAll: (selector) => (
        selector === ".cm-live-block-preview-mdx" ? [container] : []
      ),
      querySelector: (selector) => (
        selector.includes('data-live-block-start="3"') ? container : null
      ),
    },
  };
  const interaction = createLiveMdxComponentInteraction({
    getView: () => view,
    getMode: () => "live",
    isEditable: () => true,
    locale: "en",
    documentRoot: {
      documentElement: { clientWidth: 1_200, clientHeight: 800 },
    },
  });

  return {
    interaction,
    toolbar,
    componentTarget,
    outsideTarget,
    pointerEvent(target) {
      return {
        target,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
    },
    keyEvent(key) {
      return {
        key,
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          this.propagationStopped = true;
        },
      };
    },
  };
}
