import assert from "node:assert/strict";
import test from "node:test";

import { constrainGranularityButtons } from "../public/dataset-view.js";

test("dataset controls remove views that are unavailable for the source granularity", () => {
  const buttons = ["day", "week", "month", "quarter"].map((granularity) => ({
    dataset: { datasetGranularity: granularity },
    removed: false,
    remove() {
      this.removed = true;
    },
  }));
  const view = {
    querySelectorAll() {
      return buttons;
    },
  };

  constrainGranularityButtons(view, ["week"]);

  assert.deepEqual(
    buttons.filter((button) => !button.removed).map((button) => button.dataset.datasetGranularity),
    ["week"],
  );
});
