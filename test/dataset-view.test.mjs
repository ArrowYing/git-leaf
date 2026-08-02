import assert from "node:assert/strict";
import test from "node:test";

import {
  constrainGranularityButtons,
  datasetWarningMessages,
} from "../public/dataset-view.js";

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

test("dataset warnings explain omitted incomplete boundary periods", () => {
  assert.deepEqual(
    datasetWarningMessages({ omittedBoundaryPeriodCount: 2 }, "zh-CN"),
    ["已省略 2 个不完整的边界周期。"],
  );
  assert.deepEqual(
    datasetWarningMessages({ omittedBoundaryPeriodCount: 1 }, "en"),
    ["Incomplete boundary periods omitted: 1."],
  );
});
