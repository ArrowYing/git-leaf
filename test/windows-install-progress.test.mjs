import assert from "node:assert/strict";
import test from "node:test";

import { windowsInstallProgressHtml } from "../src/windows-install-progress.mjs";

test("Windows update progress window explains the full handoff", () => {
  const html = windowsInstallProgressHtml({
    version: "1.4.0",
    mode: "update",
  });

  assert.match(html, /正在更新 Git Leaf 1\.4\.0/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow/);
  assert.match(html, /updateInstallProgress/);
  assert.match(html, /transition: width 320ms ease/);
  assert.match(html, /请稍候，Git Leaf 会自动完成并重新打开/);
  assert.match(html, /class="detail" id="detail" hidden/);
  assert.match(html, /detail\.hidden = !state\.detail/);
});

test("same-version redirect window says the fixed app will start", () => {
  const html = windowsInstallProgressHtml({
    version: "1.4.0",
    mode: "redirect",
  });

  assert.match(html, /正在启动 Git Leaf 1\.4\.0/);
  assert.match(html, /Git Leaf 会自动完成并重新打开/);
});

test("outdated package window starts in a visible handoff state", () => {
  const html = windowsInstallProgressHtml({
    version: "1.3.0",
    mode: "outdated",
  });

  assert.match(html, /正在启动 Git Leaf 1\.3\.0/);
  assert.match(html, /data-phase="starting"/);
  assert.match(html, /data-phase="outdated"/);
});
