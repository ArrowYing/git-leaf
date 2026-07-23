import assert from "node:assert/strict";
import test from "node:test";

import { waitForWebContentsPaint } from "../src/desktop-paint.mjs";

test("desktop paint waits in the renderer when the page can paint", async () => {
  let calls = 0;
  let userGesture = false;
  await waitForWebContentsPaint({
    async executeJavaScript(_source, requestedUserGesture) {
      calls += 1;
      userGesture = requestedUserGesture;
    },
  });

  assert.equal(calls, 1);
  assert.equal(userGesture, true);
});

test("desktop paint cannot block a repository transition indefinitely", async () => {
  const startedAt = Date.now();
  await waitForWebContentsPaint({
    executeJavaScript() {
      return new Promise(() => {});
    },
  }, { timeoutMs: 10 });

  assert.ok(Date.now() - startedAt < 500);
});
