import assert from "node:assert/strict";
import test from "node:test";

import {
  loadWebContentsUrl,
  waitForWebContentsPaint,
} from "../src/desktop/paint.mjs";

test("desktop progress navigation loads through the target web contents", async () => {
  const calls = [];
  const webContents = {
    async loadURL(url) {
      calls.push({ receiver: this, url });
    },
  };

  assert.equal(
    await loadWebContentsUrl(webContents, "data:text/html,Loading"),
    true,
  );
  assert.deepEqual(calls, [{
    receiver: webContents,
    url: "data:text/html,Loading",
  }]);
});

test("desktop progress navigation cannot block a repository transition indefinitely", async () => {
  const startedAt = Date.now();
  assert.equal(
    await loadWebContentsUrl({
      loadURL() {
        return new Promise(() => {});
      },
    }, "data:text/html,Loading", { timeoutMs: 10 }),
    false,
  );

  assert.ok(Date.now() - startedAt < 500);
});

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
