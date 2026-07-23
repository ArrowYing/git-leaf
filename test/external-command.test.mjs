import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ExternalCommandOutputError,
  externalCommandState,
  runExternalCommand,
} from "../src/external-command.mjs";

function commandError({ code, signal, stderr = "", message = "command failed" } = {}) {
  const error = new Error(message);
  if (code !== undefined) error.code = code;
  if (signal !== undefined) error.signal = signal;
  error.stderr = stderr;
  return error;
}

test("externalCommandState covers the external dependency lifecycle", () => {
  assert.equal(externalCommandState(), "ok");
  assert.equal(externalCommandState(commandError({ code: "ENOENT" })), "unavailable");
  assert.equal(externalCommandState(commandError({ code: "EACCES" })), "permission_denied");
  assert.equal(externalCommandState(commandError({
    code: 129,
    stderr: "error: unknown switch `z'\nusage: git worktree list [<options>]",
  })), "unsupported");
  assert.equal(externalCommandState(commandError({
    code: 128,
    stderr: "fatal: not a git repository (or any of the parent directories): .git",
  })), "invalid_context");
  assert.equal(externalCommandState(commandError({
    code: 128,
    stderr: "fatal: Authentication failed for 'https://github.com/example/repo.git/'",
  })), "authentication_required");
  assert.equal(externalCommandState(commandError({
    code: 128,
    stderr: "fatal: unable to access 'https://github.com/example/repo.git/': Could not resolve host: github.com",
  })), "network_unavailable");
  assert.equal(externalCommandState(commandError({ signal: "SIGTERM" })), "interrupted");
  assert.equal(
    externalCommandState(new ExternalCommandOutputError("git", ["--version"], "empty output")),
    "invalid_output",
  );
  assert.equal(externalCommandState(commandError({
    code: 128,
    stderr: "fatal: bad object HEAD",
  })), "failed");
});

test("externalCommandState does not mistake every Git usage error for unsupported capability", () => {
  assert.equal(externalCommandState(commandError({
    code: 129,
    stderr: "usage: git worktree list [<options>]",
  })), "failed");
});

test("runExternalCommand distinguishes a missing command from a removed working directory", async () => {
  await assert.rejects(
    () => runExternalCommand("definitely-missing-git-leaf-command", [], { cwd: process.cwd() }),
    (error) => error.externalCommandState === "unavailable",
  );

  const missingCwd = path.join(tmpdir(), `git-leaf-missing-cwd-${Date.now()}`);
  await assert.rejects(
    () => runExternalCommand(process.execPath, ["--version"], { cwd: missingCwd }),
    (error) => error.externalCommandState === "invalid_context",
  );
});
