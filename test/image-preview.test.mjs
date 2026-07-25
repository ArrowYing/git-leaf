import assert from "node:assert/strict";
import test from "node:test";

import { imageLoadFailureMessage } from "../public/image-preview.js";

test("imageLoadFailureMessage identifies local asset paths and likely causes", () => {
  assert.equal(
    imageLoadFailureMessage({
      src: "/raw?repo=company-docs&file=docs%2F_assets%2Freport.png",
      alt: "六月报表",
    }),
    "图片加载失败：docs/_assets/report.png（文件不存在、路径错误或图片格式无法解码）",
  );
});

test("imageLoadFailureMessage explains remote image failures separately", () => {
  assert.equal(
    imageLoadFailureMessage({ src: "https://cdn.example.com/report.png" }),
    "图片加载失败：https://cdn.example.com/report.png（网络不可用、访问受限或链接已经失效）",
  );
});

test("imageLoadFailureMessage supports English UI copy", () => {
  assert.equal(
    imageLoadFailureMessage({
      src: "/raw?repo=company-docs&file=docs%2F_assets%2Freport.png",
    }, "en"),
    "Image failed to load: docs/_assets/report.png (File missing, path incorrect, or image format could not be decoded)",
  );
});
