import assert from "node:assert/strict";
import test from "node:test";

import {
  clampSourcePreviewRatio,
  sourcePreviewRatioFromStorageValue,
} from "../public/source-split.js";

test("clampSourcePreviewRatio keeps preview and editor both usable", () => {
  assert.equal(clampSourcePreviewRatio(10), 25);
  assert.equal(clampSourcePreviewRatio(45), 45);
  assert.equal(clampSourcePreviewRatio(90), 75);
});

test("sourcePreviewRatioFromStorageValue accepts valid stored ratios", () => {
  assert.equal(sourcePreviewRatioFromStorageValue("62"), 62);
});

test("sourcePreviewRatioFromStorageValue falls back for invalid stored ratios", () => {
  assert.equal(sourcePreviewRatioFromStorageValue(""), 45);
  assert.equal(sourcePreviewRatioFromStorageValue("abc"), 45);
  assert.equal(sourcePreviewRatioFromStorageValue("90"), 45);
});
