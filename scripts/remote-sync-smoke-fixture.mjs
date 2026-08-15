import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const REMOTE_SYNC_SMOKE_FILE = "document.md";
export const REMOTE_SYNC_SMOKE_LOCAL_CONTENT = [
  "# Remote merge smoke",
  "",
  "Local draft is still being written.",
  "",
  "Remote baseline.",
  "",
].join("\n");
export const REMOTE_SYNC_SMOKE_MERGED_CONTENT = [
  "# Remote merge smoke",
  "",
  "Local draft is still being written.",
  "",
  "Remote update arrived.",
  "",
].join("\n");
export const REMOTE_SYNC_SMOKE_ACCEPTANCE = [
  "OpenGlance automatically merges the conflict-free remote update without a click.",
  "Remote becomes up to date, the local change remains unpublished,",
  "and the open editor contains both the local draft and remote update.",
].join(" ");

export function createRemoteSyncSmokeFixture({
  temporaryRoot = tmpdir(),
  runGit = runGitCommand,
  remoteAhead = true,
} = {}) {
  const root = mkdtempSync(path.join(path.resolve(temporaryRoot), "git-leaf-remote-sync-smoke-"));
  const bare = path.join(root, "remote.git");
  const repoRoot = path.join(root, "repo");
  const coworker = path.join(root, "coworker");
  try {
    mkdirSync(bare, { recursive: true });
    runGit(["init", "--bare", "--initial-branch=main"], bare);
    runGit(["clone", bare, repoRoot], root);
    configureIdentity(repoRoot, runGit);
    writeFileSync(path.join(repoRoot, REMOTE_SYNC_SMOKE_FILE), [
      "# Remote merge smoke",
      "",
      "Local baseline.",
      "",
      "Remote baseline.",
      "",
    ].join("\n"), "utf8");
    runGit(["add", "-A"], repoRoot);
    runGit(["commit", "-m", "Initial smoke fixture"], repoRoot);
    runGit(["push", "-u", "origin", "main"], repoRoot);

    runGit(["clone", bare, coworker], root);
    configureIdentity(coworker, runGit);
    if (remoteAhead) {
      publishRemoteSyncSmokeUpdate({ coworker }, { runGit });
    }

    writeFileSync(
      path.join(repoRoot, REMOTE_SYNC_SMOKE_FILE),
      REMOTE_SYNC_SMOKE_LOCAL_CONTENT,
      "utf8",
    );
    return {
      root,
      bare,
      repoRoot,
      coworker,
      file: REMOTE_SYNC_SMOKE_FILE,
      acceptance: REMOTE_SYNC_SMOKE_ACCEPTANCE,
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function publishRemoteSyncSmokeUpdate(fixture, { runGit = runGitCommand } = {}) {
  writeFileSync(path.join(fixture.coworker, REMOTE_SYNC_SMOKE_FILE), [
    "# Remote merge smoke",
    "",
    "Local baseline.",
    "",
    "Remote update arrived.",
    "",
  ].join("\n"), "utf8");
  runGit(["add", "-A"], fixture.coworker);
  runGit(["commit", "-m", "Remote smoke update"], fixture.coworker);
  runGit(["push", "origin", "main"], fixture.coworker);
}

export function verifyRemoteSyncSmokeFixture(fixture) {
  const content = readFileSync(path.join(fixture.repoRoot, REMOTE_SYNC_SMOKE_FILE), "utf8");
  const status = runGitCommand(["status", "--porcelain"], fixture.repoRoot).stdout;
  const localHead = runGitCommand(["rev-parse", "HEAD"], fixture.repoRoot).stdout.trim();
  const remoteHead = runGitCommand(["rev-parse", "main"], fixture.bare).stdout.trim();
  if (content !== REMOTE_SYNC_SMOKE_MERGED_CONTENT) {
    throw new Error("Remote sync smoke did not preserve the expected combined document.");
  }
  if (status !== ` M ${REMOTE_SYNC_SMOKE_FILE}\n`) {
    throw new Error(`Remote sync smoke left an unexpected Git status: ${status || "<clean>"}`);
  }
  if (localHead !== remoteHead) {
    throw new Error("Remote sync smoke did not advance the local branch to the remote commit.");
  }
}

export function cleanupRemoteSyncSmokeFixture(fixture) {
  const root = path.resolve(fixture?.root || "");
  const temporaryRoot = path.resolve(tmpdir());
  const relative = path.relative(temporaryRoot, root);
  if (
    relative.startsWith("..")
    || path.isAbsolute(relative)
    || !path.basename(root).startsWith("git-leaf-remote-sync-smoke-")
  ) {
    throw new Error(`Refusing to clean an unexpected remote sync smoke fixture: ${root}`);
  }
  rmSync(root, { recursive: true, force: true });
}

function configureIdentity(repoRoot, runGit) {
  runGit(["config", "user.name", "OpenGlance Smoke"], repoRoot);
  runGit(["config", "user.email", "smoke@git-leaf.invalid"], repoRoot);
}

function runGitCommand(args, cwd) {
  const result = spawnSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result;
}
