import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  confirmOpenPeekHandoff,
  openPeekHandoffConfirmUrl,
  normalizeOpenPeekHandoffId,
  reportOpenPeekShareHandoffState,
  writeDesktopDeepLinkLog,
} from "../src/desktop/handoff.mjs";

test("OpenPeek confirms only safe one-time handoff ids to the fixed update service endpoint", async () => {
  const requests = [];
  const handoff = "handoff_1234567890abcdef";

  assert.equal(normalizeOpenPeekHandoffId(handoff), handoff);
  assert.equal(normalizeOpenPeekHandoffId("short"), "");
  assert.equal(
    openPeekHandoffConfirmUrl(handoff),
    "https://gitleaf.mangofuture.com/open/confirm?id=handoff_1234567890abcdef",
  );
  assert.equal(await confirmOpenPeekHandoff(handoff, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true };
    },
  }), true);
  assert.deepEqual(requests, [{
    url: "https://gitleaf.mangofuture.com/open/confirm?id=handoff_1234567890abcdef",
    options: { method: "POST", cache: "no-store" },
  }]);
});

test("OpenPeek reports only safe shared-link handoff states", async () => {
  const requests = [];
  const handoff = "handoff_1234567890abcdef";
  assert.equal(await reportOpenPeekShareHandoffState(handoff, "cancelled", {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true };
    },
  }), true);
  assert.deepEqual(requests, [{
    url: "https://gitleaf.mangofuture.com/share/state?id=handoff_1234567890abcdef&state=cancelled",
    options: { method: "POST", cache: "no-store" },
  }]);
  assert.equal(await reportOpenPeekShareHandoffState(handoff, "opened"), false);
  assert.equal(await reportOpenPeekShareHandoffState("short", "failed"), false);
});

test("OpenPeek handoff confirmation fails closed for invalid ids and network errors", async () => {
  let fetchCalls = 0;
  assert.equal(await confirmOpenPeekHandoff("short", {
    fetchImpl: async () => {
      fetchCalls += 1;
    },
  }), false);
  assert.equal(fetchCalls, 0);

  assert.equal(await confirmOpenPeekHandoff("handoff_1234567890abcdef", {
    fetchImpl: async () => {
      throw new Error("offline");
    },
  }), false);
});

test("OpenPeek writes durable deep-link lifecycle records for later diagnosis", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "git-leaf-handoff-log-"));
  const request = {
    repository: "exampleorg/company-docs",
    file: "AGENTS.md",
    worktree: "0123456789abcdef",
    handoff: "handoff_1234567890abcdef",
  };

  assert.equal(await writeDesktopDeepLinkLog({
    userDataDir,
    event: "opened",
    request,
  }), true);
  const entries = (await readFile(path.join(userDataDir, "deep-link.log"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].event, "opened");
  assert.equal(entries[0].handoff, request.handoff);
  assert.equal(entries[0].repository, request.repository);
  assert.equal(entries[0].file, request.file);
  assert.equal(entries[0].worktree, request.worktree);
  assert.match(entries[0].at, /^\d{4}-\d{2}-\d{2}T/);
});
