import assert from "node:assert/strict";
import test from "node:test";

import {
  clampDocumentOutlineWidth,
  clampSidebarWidth,
  documentOutlineWidthFromStorageValue,
  sidebarCollapsedFromStorageValue,
  sidebarWidthFromStorageValue,
} from "../public/layout.js";

test("clampSidebarWidth keeps the file explorer usable without crowding content", () => {
  assert.equal(clampSidebarWidth(100, 1400), 120);
  assert.equal(clampSidebarWidth(340, 1400), 340);
  assert.equal(clampSidebarWidth(700, 1400), 560);
  assert.equal(clampSidebarWidth(700, 900), 380);
});

test("sidebarWidthFromStorageValue falls back only when storage is empty or invalid", () => {
  assert.equal(sidebarWidthFromStorageValue(null), 320);
  assert.equal(sidebarWidthFromStorageValue(""), 320);
  assert.equal(sidebarWidthFromStorageValue("bad"), 320);
  assert.equal(sidebarWidthFromStorageValue("420"), 420);
});

test("document outline resize permits half the previous minimum and preserves document space", () => {
  assert.equal(clampDocumentOutlineWidth(40, 1400), 88);
  assert.equal(clampDocumentOutlineWidth(120, 1400), 120);
  assert.equal(clampDocumentOutlineWidth(320, 1400), 320);
  assert.equal(clampDocumentOutlineWidth(700, 1400), 480);
  assert.equal(clampDocumentOutlineWidth(700, 800), 274);
});

test("documentOutlineWidthFromStorageValue keeps the established default while restoring narrow widths", () => {
  assert.equal(documentOutlineWidthFromStorageValue(null), 176);
  assert.equal(documentOutlineWidthFromStorageValue(""), 176);
  assert.equal(documentOutlineWidthFromStorageValue("bad"), 176);
  assert.equal(documentOutlineWidthFromStorageValue("88"), 88);
  assert.equal(documentOutlineWidthFromStorageValue("304"), 304);
});

test("sidebarCollapsedFromStorageValue accepts desktop booleans and browser strings", () => {
  assert.equal(sidebarCollapsedFromStorageValue(true), true);
  assert.equal(sidebarCollapsedFromStorageValue(false), false);
  assert.equal(sidebarCollapsedFromStorageValue("true"), true);
  assert.equal(sidebarCollapsedFromStorageValue("false"), false);
  assert.equal(sidebarCollapsedFromStorageValue("bad"), false);
  assert.equal(sidebarCollapsedFromStorageValue(null, true), true);
});
