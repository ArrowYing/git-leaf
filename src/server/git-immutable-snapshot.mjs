import process from "node:process";

import { runExternalCommand } from "./external-command.mjs";

const OID_PATTERN = /^[0-9a-f]{40,64}$/i;
const SNAPSHOT_IDENTITY = Object.freeze({
  GIT_AUTHOR_NAME: "OpenPeek",
  GIT_AUTHOR_EMAIL: "snapshot@openpeek.invalid",
  GIT_COMMITTER_NAME: "OpenPeek",
  GIT_COMMITTER_EMAIL: "snapshot@openpeek.invalid",
});

export async function createImmutableGitTree({
  repoRoot,
  indexPath,
  commandRunner = runGitSnapshotCommand,
}) {
  const environment = snapshotEnvironment(indexPath);
  await commandRunner(repoRoot, ["read-tree", "HEAD"], { environment });
  await commandRunner(repoRoot, ["add", "-A", "--", "."], { environment });
  return parseGitOid(
    (await commandRunner(repoRoot, ["write-tree"], { environment })).stdout,
    "snapshot tree",
  );
}

export async function createImmutableGitSnapshot({
  repoRoot,
  indexPath,
  message = "OpenPeek local workspace snapshot",
  commandRunner = runGitSnapshotCommand,
}) {
  const tree = await createImmutableGitTree({
    repoRoot,
    indexPath,
    commandRunner,
  });
  const baseCommit = parseGitOid(
    (await commandRunner(repoRoot, ["rev-parse", "--verify", "HEAD"])).stdout,
    "base commit",
  );
  const snapshotCommit = parseGitOid(
    (await commandRunner(
      repoRoot,
      ["commit-tree", tree, "-p", baseCommit, "-m", message],
      { environment: SNAPSHOT_IDENTITY },
    )).stdout,
    "snapshot commit",
  );

  return {
    baseCommit,
    tree,
    snapshotCommit,
  };
}

export async function rebaseImmutableGitSnapshot({
  repoRoot,
  snapshotCommit,
  remoteCommit,
  message = "OpenPeek local workspace snapshot on remote",
  commandRunner = runGitSnapshotCommand,
}) {
  let mergeResult;
  try {
    mergeResult = await commandRunner(repoRoot, [
      "merge-tree",
      "--write-tree",
      remoteCommit,
      snapshotCommit,
    ]);
  } catch (error) {
    if (Number(error?.code) === 1) {
      return {
        ok: false,
        conflict: true,
      };
    }
    throw error;
  }

  const tree = parseGitOid(
    String(mergeResult.stdout ?? "").split(/\r?\n/, 1)[0],
    "merged tree",
  );
  const rebasedCommit = parseGitOid(
    (await commandRunner(
      repoRoot,
      ["commit-tree", tree, "-p", remoteCommit, "-m", message],
      { environment: SNAPSHOT_IDENTITY },
    )).stdout,
    "rebased snapshot commit",
  );

  return {
    ok: true,
    conflict: false,
    tree,
    rebasedCommit,
  };
}

export function parseGitOid(output, label = "commit id") {
  const value = String(output ?? "").trim();
  if (!OID_PATTERN.test(value)) {
    throw new Error(`Git returned an invalid ${label}: ${value || "<empty>"}`);
  }
  return value;
}

export function runGitSnapshotCommand(cwd, args, { environment = {} } = {}) {
  return runExternalCommand("git", args, {
    cwd,
    env: {
      ...process.env,
      ...environment,
    },
  });
}

function snapshotEnvironment(indexPath) {
  return {
    ...SNAPSHOT_IDENTITY,
    GIT_INDEX_FILE: indexPath,
    GIT_OPTIONAL_LOCKS: "0",
  };
}
