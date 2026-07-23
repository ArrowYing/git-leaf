import assert from "node:assert/strict";
import test from "node:test";

import { createOutlineClickViewportGuard } from "../public/outline.js";

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
