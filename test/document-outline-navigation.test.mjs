import assert from "node:assert/strict";
import test from "node:test";

import {
  createOutlineActiveViewportState,
  createOutlineClickViewportGuard,
} from "../public/outline.js";

test("outline click viewport guard stays active until content interaction", () => {
  const guard = createOutlineClickViewportGuard();

  assert.equal(guard.preserveForContentScroll(), false);

  guard.begin();
  assert.equal(guard.preserveForContentScroll(), true);
  assert.equal(guard.preserveForContentScroll(), true);
  assert.equal(guard.isActive(), true);

  guard.end();
  assert.equal(guard.isActive(), false);
  assert.equal(guard.preserveForContentScroll(), false);
});

test("outline refresh preserves its viewport while the same document section stays active", () => {
  const viewport = createOutlineActiveViewportState();

  assert.equal(viewport.transition({
    documentPath: "guide.md",
    activeId: "delivery",
  }), "center");
  assert.equal(viewport.transition({
    documentPath: "guide.md",
    activeId: "delivery",
  }), "preserve");
});

test("outline viewport still follows real section changes and explicit click navigation", () => {
  const viewport = createOutlineActiveViewportState();

  viewport.transition({ documentPath: "guide.md", activeId: "overview" });
  assert.equal(viewport.transition({
    documentPath: "guide.md",
    activeId: "delivery",
  }), "center");
  assert.equal(viewport.transition({
    documentPath: "guide.md",
    activeId: "appendix",
    preserveViewport: true,
  }), "preserve");
  assert.equal(viewport.transition({
    documentPath: "guide.md",
    activeId: undefined,
  }), "top");
});

test("outline viewport does not reuse active state after reset or across documents", () => {
  const viewport = createOutlineActiveViewportState();

  viewport.transition({ documentPath: "guide.md", activeId: "overview" });
  assert.equal(viewport.transition({
    documentPath: "reference.md",
    activeId: "overview",
  }), "center");

  viewport.reset();
  assert.equal(viewport.transition({
    documentPath: "reference.md",
    activeId: "overview",
  }), "center");
});
