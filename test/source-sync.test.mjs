import assert from "node:assert/strict";
import test from "node:test";

import {
  sourceLineFromPreviewScroll,
  shouldIgnoreWatchedChange,
  sourceLineForPreviewSync,
  syncLabelForState,
} from "../public/source-sync.js";

test("shouldIgnoreWatchedChange ignores writes that match the last OpenGlance write", () => {
  assert.equal(
    shouldIgnoreWatchedChange({
      currentMode: "source",
      watchedHash: "abc123",
      lastWrittenHash: "abc123",
    }),
    true,
  );
});

test("shouldIgnoreWatchedChange also ignores matching OpenGlance writes in Live mode", () => {
  assert.equal(
    shouldIgnoreWatchedChange({
      currentMode: "live",
      watchedHash: "abc123",
      lastWrittenHash: "abc123",
    }),
    true,
  );
});

test("shouldIgnoreWatchedChange reloads external changes", () => {
  assert.equal(
    shouldIgnoreWatchedChange({
      currentMode: "source",
      watchedHash: "external",
      lastWrittenHash: "local",
    }),
    false,
  );
});

test("syncLabelForState only surfaces error states", () => {
  assert.equal(syncLabelForState("idle"), "");
  assert.equal(syncLabelForState("syncing"), "");
  assert.equal(syncLabelForState("external"), "");
  assert.equal(syncLabelForState("error"), "同步失败");
  assert.equal(syncLabelForState("error", "en"), "Sync failed");
});

test("sourceLineForPreviewSync chooses the nearest rendered line at or before the source line", () => {
  assert.equal(sourceLineForPreviewSync(72, [47, 49, 55, 68, 76, 81]), 68);
});

test("sourceLineForPreviewSync falls forward when the source line is before the first rendered line", () => {
  assert.equal(sourceLineForPreviewSync(2, [10, 20, 30]), 10);
});

test("sourceLineForPreviewSync returns null without rendered lines", () => {
  assert.equal(sourceLineForPreviewSync(2, []), null);
});

test("sourceLineFromPreviewScroll chooses the first visible rendered source line", () => {
  assert.equal(
    sourceLineFromPreviewScroll({
      contentTop: 100,
      lineRects: [
        { line: 20, top: 40 },
        { line: 30, top: 110 },
        { line: 40, top: 180 },
      ],
    }),
    30,
  );
});

test("sourceLineFromPreviewScroll falls back to the last preceding source line", () => {
  assert.equal(
    sourceLineFromPreviewScroll({
      contentTop: 100,
      lineRects: [
        { line: 20, top: 40 },
        { line: 30, top: 80 },
      ],
    }),
    30,
  );
});
