import assert from "node:assert/strict";
import test from "node:test";

import { saveAndSyncDesktopPreferences } from "../desktop/preference-sync.mjs";

test("renderer preference saves update persistence and server state without echoing", async () => {
  const calls = [];
  const result = await saveAndSyncDesktopPreferences({
    preferences: { colorMode: "dark" },
    persistPreferences: async (preferences) => {
      calls.push(["persist", preferences]);
      return { repoRoot: "/repo", preferences: { ...preferences, documentFontSize: 16 } };
    },
    updateServerPreferences: (preferences) => calls.push(["server", preferences]),
    sendRendererPreferences: async (preferences) => calls.push(["renderer", preferences]),
    notifyRenderer: false,
  });

  assert.deepEqual(result, {
    state: {
      repoRoot: "/repo",
      preferences: { colorMode: "dark", documentFontSize: 16 },
    },
    preferences: { colorMode: "dark", documentFontSize: 16 },
  });
  assert.deepEqual(calls, [
    ["persist", { colorMode: "dark" }],
    ["server", { colorMode: "dark", documentFontSize: 16 }],
  ]);
});

test("settings preference saves broadcast the persisted result once", async () => {
  const calls = [];
  await saveAndSyncDesktopPreferences({
    preferences: { fileTreeMode: "all" },
    persistPreferences: async (preferences) => ({ preferences }),
    updateServerPreferences: (preferences) => calls.push(["server", preferences]),
    sendRendererPreferences: async (preferences) => calls.push(["renderer", preferences]),
  });

  assert.deepEqual(calls, [
    ["server", { fileTreeMode: "all" }],
    ["renderer", { fileTreeMode: "all" }],
  ]);
});
