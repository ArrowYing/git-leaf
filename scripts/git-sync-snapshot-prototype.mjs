#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const OID_PATTERN = /^[0-9a-f]{40,64}$/i;

export async function createImmutableGitSnapshot({
  repoRoot,
  indexPath,
  message = "Git Leaf immutable snapshot prototype",
}) {
  const environment = {
    ...process.env,
    GIT_INDEX_FILE: indexPath,
    GIT_OPTIONAL_LOCKS: "0",
  };
  const timingsMs = {};

  await measure(timingsMs, "read_tree", () => runGit(repoRoot, ["read-tree", "HEAD"], environment));
  await measure(timingsMs, "stage_worktree", () => runGit(repoRoot, ["add", "-A", "--", "."], environment));
  const tree = parseOid((await measure(
    timingsMs,
    "write_tree",
    () => runGit(repoRoot, ["write-tree"], environment),
  )).stdout, "snapshot tree");
  const baseCommit = parseOid(
    (await runGit(repoRoot, ["rev-parse", "--verify", "HEAD"])).stdout,
    "base commit",
  );
  const snapshotCommit = parseOid((await measure(
    timingsMs,
    "commit_tree",
    () => runGit(repoRoot, ["commit-tree", tree, "-p", baseCommit, "-m", message]),
  )).stdout, "snapshot commit");

  return {
    baseCommit,
    tree,
    snapshotCommit,
    timingsMs,
    totalMs: sumTimings(timingsMs),
  };
}

export async function rebaseImmutableGitSnapshot({
  repoRoot,
  snapshotCommit,
  remoteCommit,
  message = "Git Leaf immutable snapshot prototype",
}) {
  const timingsMs = {};
  let mergeResult;
  try {
    mergeResult = await measure(
      timingsMs,
      "merge_tree",
      () => runGit(repoRoot, ["merge-tree", "--write-tree", remoteCommit, snapshotCommit]),
    );
  } catch (error) {
    if (Number(error?.code) === 1) {
      return {
        ok: false,
        conflict: true,
        timingsMs,
        totalMs: sumTimings(timingsMs),
      };
    }
    throw error;
  }

  const tree = parseOid(String(mergeResult.stdout).split(/\r?\n/, 1)[0], "merged tree");
  const rebasedCommit = parseOid((await measure(
    timingsMs,
    "commit_tree",
    () => runGit(repoRoot, ["commit-tree", tree, "-p", remoteCommit, "-m", message]),
  )).stdout, "rebased snapshot commit");

  return {
    ok: true,
    conflict: false,
    tree,
    rebasedCommit,
    timingsMs,
    totalMs: sumTimings(timingsMs),
  };
}

export async function benchmarkGitSnapshotStrategies({
  fileCount = 500,
  bytesPerFile = 4096,
  rounds = 3,
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "git-leaf-snapshot-benchmark-"));
  const repoRoot = path.join(root, "repo");
  const snapshotTimes = [];
  const worktreeLowerBoundTimes = [];
  try {
    await mkdir(repoRoot, { recursive: true });
    await runGit(repoRoot, ["init", "-b", "main"]);
    await runGit(repoRoot, ["config", "user.name", "Git Leaf Prototype"]);
    await runGit(repoRoot, ["config", "user.email", "prototype@git-leaf.invalid"]);
    const content = "x".repeat(Math.max(1, bytesPerFile - 1)) + "\n";
    for (let index = 0; index < fileCount; index += 1) {
      const directory = path.join(repoRoot, "docs", String(Math.floor(index / 100)));
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, `${index}.md`), content);
    }
    await runGit(repoRoot, ["add", "-A"]);
    await runGit(repoRoot, ["commit", "-m", "Benchmark fixture"]);

    await writeFile(path.join(repoRoot, "docs", "0", "0.md"), `${content}changed\n`);
    await writeFile(path.join(repoRoot, "new-attachment.bin"), Buffer.alloc(bytesPerFile, 7));

    for (let round = 0; round < rounds; round += 1) {
      const indexPath = path.join(root, `snapshot-${round}.index`);
      const snapshot = await createImmutableGitSnapshot({ repoRoot, indexPath });
      snapshotTimes.push(snapshot.totalMs);
      await unlink(indexPath).catch(() => {});

      const worktreePath = path.join(root, `worktree-${round}`);
      const startedAt = performance.now();
      await runGit(repoRoot, ["worktree", "add", "--detach", worktreePath, "HEAD"]);
      await runGit(repoRoot, ["worktree", "remove", "--force", worktreePath]);
      worktreeLowerBoundTimes.push(performance.now() - startedAt);
    }

    return {
      fixture: { fileCount, bytesPerFile, rounds },
      immutable_snapshot_ms: summarizeDurations(snapshotTimes),
      temp_worktree_lower_bound_ms: summarizeDurations(worktreeLowerBoundTimes),
      note: "The worktree number covers checkout and removal only; copying the click-time changes, merging, and network I/O would add more time.",
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function measure(timings, name, operation) {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    timings[name] = performance.now() - startedAt;
  }
}

function sumTimings(timings) {
  return Object.values(timings).reduce((sum, value) => sum + value, 0);
}

function summarizeDurations(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    min: round(sorted[0] ?? 0),
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1) ?? 0),
    mean: round(sorted.length === 0 ? 0 : total / sorted.length),
  };
}

function percentile(sorted, ratio) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function parseOid(output, label) {
  const value = String(output ?? "").trim();
  if (!OID_PATTERN.test(value)) {
    throw new Error(`Git returned an invalid ${label}: ${value || "<empty>"}`);
  }
  return value;
}

function runGit(cwd, args, extraEnvironment = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "utf8",
        env: { ...process.env, ...extraEnvironment },
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr });
          return;
        }
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      },
    );
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const report = await benchmarkGitSnapshotStrategies(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!["--files", "--bytes", "--rounds"].includes(flag)) {
      throw new Error(`Unknown option: ${flag}`);
    }
    const value = Number.parseInt(args[index += 1], 10);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${flag} requires a positive integer.`);
    }
    if (flag === "--files") options.fileCount = value;
    if (flag === "--bytes") options.bytesPerFile = value;
    if (flag === "--rounds") options.rounds = value;
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
