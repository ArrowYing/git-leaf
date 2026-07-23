import assert from "node:assert/strict";
import test from "node:test";

import { desktopSecondInstanceAction } from "../src/desktop-instance-routing.mjs";

test("an empty second launch only focuses the app while startup is still finishing", () => {
  assert.equal(
    desktopSecondInstanceAction({
      isDesktopReady: false,
      request: {},
    }),
    "focus",
  );
});

test("a document deep link waits for startup before navigating", () => {
  assert.equal(
    desktopSecondInstanceAction({
      isDesktopReady: false,
      request: {
        repoRoot: "D:/docs",
        file: "docs/notes.md",
      },
    }),
    "queue",
  );
});

test("a document deep link opens immediately after startup", () => {
  assert.equal(
    desktopSecondInstanceAction({
      isDesktopReady: true,
      request: {
        repoRoot: "D:/docs",
        file: "docs/notes.md",
      },
    }),
    "open",
  );
});

test("an empty second launch never reloads an already open workbench", () => {
  assert.equal(
    desktopSecondInstanceAction({
      isDesktopReady: true,
      request: {},
    }),
    "focus",
  );
});
