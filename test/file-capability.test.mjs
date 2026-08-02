import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldShowReadonlyModeStatus,
  treeFileCapability,
} from "../public/file-capability.js";

const translate = (key) => ({
  "badge.detect": "检测",
  "badge.missing": "缺失",
  "badge.unsupported": "不支持",
  "file.editable": "可编辑文档",
  "file.missing": "当前工作树中不存在",
  "file.placeholder": "空文件夹占位文件",
  "file.readonly": "只读预览",
  "file.unknown": "打开后检测预览能力",
  "file.unsupported": "暂不支持预览",
})[key] ?? key;

test("ordinary read-only files do not add a repeated tree badge", () => {
  assert.deepEqual(treeFileCapability("csv", { translate }), {
    name: "readonly",
    label: "只读预览",
    badge: "",
  });
  assert.deepEqual(treeFileCapability("image", { translate }), {
    name: "readonly",
    label: "只读预览",
    badge: "",
  });
});

test("tree badges remain only for states that change the opening result", () => {
  assert.deepEqual(treeFileCapability("unknown", { translate }), {
    name: "unknown",
    label: "打开后检测预览能力",
    badge: "检测",
  });
  assert.deepEqual(treeFileCapability("unsupported", { translate }), {
    name: "unsupported",
    label: "暂不支持预览",
    badge: "不支持",
  });
  assert.deepEqual(treeFileCapability("markdown", {
    missing: true,
    translate,
  }), {
    name: "missing",
    label: "当前工作树中不存在",
    badge: "缺失",
  });
});

test("the mode bar identifies an opened document that cannot use the editor", () => {
  assert.equal(shouldShowReadonlyModeStatus({
    hasDocument: true,
    canUseEditor: false,
  }), true);
  assert.equal(shouldShowReadonlyModeStatus({
    hasDocument: true,
    canUseEditor: true,
  }), false);
  assert.equal(shouldShowReadonlyModeStatus({
    hasDocument: false,
    canUseEditor: false,
  }), false);
});
