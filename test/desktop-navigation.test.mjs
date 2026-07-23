import assert from "node:assert/strict";
import test from "node:test";

import { classifyDesktopNavigation } from "../src/desktop-navigation.mjs";

test("desktop navigation keeps only same-origin Git Leaf URLs inside the app", () => {
  const currentUrl = "http://127.0.0.1:4317/?repo=docs-repo&file=README.md";

  assert.equal(
    classifyDesktopNavigation({
      currentUrl,
      targetUrl: "http://127.0.0.1:4317/?repo=docs-repo&file=docs%2Fguide.md",
    }),
    "internal",
  );
  assert.equal(
    classifyDesktopNavigation({
      currentUrl,
      targetUrl: "https://github.com/example-org/docs-repo",
    }),
    "external",
  );
  assert.equal(
    classifyDesktopNavigation({
      currentUrl,
      targetUrl: "mailto:ops@example.com",
    }),
    "external",
  );
  assert.equal(
    classifyDesktopNavigation({
      currentUrl,
      targetUrl: "file:///Users/maintainer/secret.md",
    }),
    "blocked",
  );
  assert.equal(
    classifyDesktopNavigation({
      currentUrl,
      targetUrl: "javascript:alert(1)",
    }),
    "blocked",
  );
});
