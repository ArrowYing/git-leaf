import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_BIND_HOST,
  isLocalRequestAddress,
  previewServerUrl,
} from "../src/server/network-address.mjs";

test("Git Leaf URLs stay on localhost and contain no sharing token", () => {
  assert.equal(DEFAULT_BIND_HOST, "127.0.0.1");
  assert.equal(
    previewServerUrl({
      port: 4317,
      relativePath: "docs/repo structure.md",
      repoId: "content-repo",
    }),
    "http://127.0.0.1:4317/?repo=content-repo&file=docs%2Frepo+structure.md",
  );
});

test("previewServerUrl supports opening Git Leaf without a selected document", () => {
  assert.equal(
    previewServerUrl({ port: 4317, relativePath: "" }),
    "http://127.0.0.1:4317/",
  );
});

test("isLocalRequestAddress accepts only loopback addresses", () => {
  assert.equal(isLocalRequestAddress("127.0.0.1"), true);
  assert.equal(isLocalRequestAddress("::1"), true);
  assert.equal(isLocalRequestAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLocalRequestAddress("192.168.31.42"), false);
  assert.equal(isLocalRequestAddress(""), false);
});
