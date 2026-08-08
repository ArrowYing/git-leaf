import assert from "node:assert/strict";
import test from "node:test";

import { sidebarUpdateView } from "../public/update-ui.js";

test("sidebar update view stays hidden when no action is available", () => {
  for (const state of [undefined, "current", "checking", "error", "skipped"]) {
    assert.deepEqual(sidebarUpdateView({ state }), { hidden: true });
  }
});

test("sidebar update view downloads without an action and offers restart when ready", () => {
  assert.deepEqual(sidebarUpdateView({ state: "available", version: "1.7.0" }), {
    hidden: false,
    title: "Git Leaf 1.7.0",
    detail: "正在下载并准备新版本…",
    actionLabel: "",
    actionDisabled: true,
  });
  assert.deepEqual(sidebarUpdateView({ state: "downloading", version: "1.7.0" }), {
    hidden: false,
    title: "Git Leaf 1.7.0",
    detail: "正在下载并准备新版本…",
    actionLabel: "",
    actionDisabled: true,
  });
  assert.deepEqual(sidebarUpdateView({ state: "downloaded", version: "1.7.0" }), {
    hidden: false,
    title: "Git Leaf 1.7.0",
    detail: "已准备好，退出后自动安装",
    actionLabel: "立即重启",
    actionDisabled: false,
  });
});

test("sidebar update view supports English UI copy", () => {
  assert.deepEqual(sidebarUpdateView({ state: "available", version: "1.7.0" }, "en"), {
    hidden: false,
    title: "Git Leaf 1.7.0",
    detail: "Downloading and preparing the new version…",
    actionLabel: "",
    actionDisabled: true,
  });
});
