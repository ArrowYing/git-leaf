#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { DEFAULT_BIND_HOST, previewServerUrl } from "./network-address.mjs";
import { findRepoRoot, resolveOpenablePath } from "./paths.mjs";
import { createRepositoryInfo } from "./repositories.mjs";
import { createPreviewServer } from "./server.mjs";
import { createToolVersionMonitor } from "./tool-version.mjs";

const DEFAULT_PORT = 4317;
const RESTART_WAIT_TIMEOUT_MS = 5_000;
const RESTART_WAIT_INTERVAL_MS = 150;
const SERVER_RECORD_DIR = path.join(os.tmpdir(), "git-leaf");
const execFileAsync = promisify(execFile);

export async function runCli(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const repoRoot = await findRepoRoot(process.cwd());
  const inputFile = options.file
    ? path.isAbsolute(options.file)
      ? options.file
      : path.resolve(process.cwd(), options.file)
    : "";
  const initialFile = inputFile ? await resolveOpenablePath(repoRoot, inputFile) : null;
  const relativePath = initialFile?.relativePath ?? "";
  const reusableUrl = await findReusableGitLeafUrl({
    repoRoot,
    port: options.port,
    relativePath,
  });
  if (reusableUrl) {
    console.log(`Git Leaf already running at ${reusableUrl}`);
    if (options.open) {
      openBrowser(reusableUrl);
    }
    return;
  }

  const toolVersionMonitor = await createToolVersionMonitor();
  const repository = await createRepositoryInfo({
    repoRoot,
    initialFile,
  });
  let server;
  const restartSelf = createRestartSelf({
    args,
    cwd: repoRoot,
    getServer: () => server,
  });
  server = createPreviewServer({
    repoRoot,
    initialFile,
    toolVersionMonitor,
    restartSelf,
    repository,
  });
  const { port } = await listenWithFallback(server, {
    port: options.port,
  }, {
    repoRoot,
  });
  const url = previewServerUrl({
    port,
    relativePath: relativePath || repository.defaultFile,
    repoId: repository.id,
  });
  await writeServerRecord({
    repoRoot,
    port,
    repoId: repository.id,
  });

  console.log(`Git Leaf running at ${url}`);
  console.log("Press Ctrl+C to stop.");

  if (options.open) {
    openBrowser(url);
  }
}

export async function findReusableGitLeafUrl({
  repoRoot,
  port,
  relativePath,
  readRecord,
}) {
  const primaryUrl = await reusableGitLeafUrl({
    repoRoot,
    port,
    relativePath,
    readRecord,
  });
  if (primaryUrl) {
    return primaryUrl;
  }

  const primaryPortAvailable = await isPortAvailable({ host: DEFAULT_BIND_HOST, port });
  for (let offset = 1; offset < 20; offset += 1) {
    const fallbackPort = port + offset;
    const payload = await checkedHealthPayload(fallbackPort);
    if (!sameRepositoryGitLeaf(payload, repoRoot)) {
      continue;
    }

    if (primaryPortAvailable) {
      const restarted = await requestRestartAndWait({
        port: fallbackPort,
        repoRoot,
        expectedPort: port,
      });
      return restarted
        ? reusableUrlForPort({
            repoRoot,
            port,
            relativePath,
            readRecord,
          })
        : null;
    }

    const reusableUrl = await reusableGitLeafUrl({
      repoRoot,
      port: fallbackPort,
      relativePath,
      readRecord,
    });
    if (reusableUrl) {
      return reusableUrl;
    }
  }
  return null;
}

export async function reusableGitLeafUrl({
  repoRoot,
  port,
  relativePath,
  readRecord,
}) {
  const healthUrl = `http://127.0.0.1:${port}/api/health?check=1`;
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(200) });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    if (!sameRepositoryGitLeaf(payload, repoRoot)) {
      return null;
    }
    if (!payload.toolFingerprint) {
      return null;
    }
    if (payload.stale) {
      const restarted = await requestRestartAndWait({
        port,
        repoRoot,
        expectedPort: port,
      });
      if (!restarted) {
        return null;
      }
    }
    return reusableUrlForPort({
      repoRoot,
      port,
      relativePath,
      readRecord,
    });
  } catch {
    return null;
  }
}

async function requestRestartAndWait({ port, repoRoot, expectedPort = port }) {
  const restartResponse = await fetch(`http://127.0.0.1:${port}/api/restart`, {
    method: "POST",
    signal: AbortSignal.timeout(500),
  });
  if (!restartResponse.ok) {
    return false;
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < RESTART_WAIT_TIMEOUT_MS) {
    await delay(RESTART_WAIT_INTERVAL_MS);
    const payload = await checkedHealthPayload(expectedPort);
    if (
      sameRepositoryGitLeaf(payload, repoRoot) &&
      payload.toolFingerprint &&
      !payload.stale
    ) {
      return true;
    }
  }

  return false;
}

async function checkedHealthPayload(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health?check=1`, {
      signal: AbortSignal.timeout(500),
    });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

function sameRepositoryGitLeaf(payload, repoRoot) {
  return Boolean(payload?.app === "git-leaf" && payload.repoRoot === repoRoot);
}

export async function registeredGitLeafProcessOnPort({
  repoRoot,
  port,
  readRecord = readServerRecord,
  isProcessAlive = processIsAlive,
  pidOwnsPort = processOwnsTcpPort,
  isGitLeafProcess = processCommandLooksLikeGitLeaf,
} = {}) {
  if (!repoRoot || !Number.isInteger(port)) {
    return null;
  }

  const record = await readRecord(repoRoot);
  if (
    !record ||
    record.app !== "git-leaf" ||
    record.repoRoot !== repoRoot ||
    record.port !== port ||
    !Number.isInteger(record.pid) ||
    record.pid <= 0
  ) {
    return null;
  }

  if (
    !(await isProcessAlive(record.pid)) ||
    !(await pidOwnsPort(record.pid, port)) ||
    !(await isGitLeafProcess(record.pid))
  ) {
    return null;
  }

  return record;
}

export async function stopRegisteredGitLeafProcessOnPort({
  repoRoot,
  port,
  host,
  readRecord = readServerRecord,
  isProcessAlive = processIsAlive,
  pidOwnsPort = processOwnsTcpPort,
  isGitLeafProcess = processCommandLooksLikeGitLeaf,
  stopProcess = terminateProcess,
  waitForPortAvailable = waitUntilPortAvailable,
} = {}) {
  const record = await registeredGitLeafProcessOnPort({
    repoRoot,
    port,
    readRecord,
    isProcessAlive,
    pidOwnsPort,
    isGitLeafProcess,
  });
  if (!record || record.pid === process.pid) {
    return false;
  }

  await stopProcess(record.pid, "SIGTERM");
  if (await waitForPortAvailable({ host, port, timeoutMs: 1_500 })) {
    return true;
  }

  await stopProcess(record.pid, "SIGKILL");
  return waitForPortAvailable({ host, port, timeoutMs: 1_500 });
}

async function writeServerRecord({ repoRoot, port, repoId }) {
  await mkdir(SERVER_RECORD_DIR, { recursive: true });
  await writeFile(
    serverRecordPath(repoRoot),
    `${JSON.stringify({
      app: "git-leaf",
      repoRoot,
      port,
      repoId,
      pid: process.pid,
      entrypoint: process.argv[1] ?? "",
      startedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    "utf8",
  );
}

async function readServerRecord(repoRoot) {
  try {
    return JSON.parse(await readFile(serverRecordPath(repoRoot), "utf8"));
  } catch {
    return null;
  }
}

function serverRecordPath(repoRoot) {
  const id = createHash("sha256").update(repoRoot).digest("hex");
  return path.join(SERVER_RECORD_DIR, `${id}.json`);
}

async function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function processOwnsTcpPort(pid, port) {
  try {
    const probe = tcpPortOwnerCommand({ pid, port });
    const { stdout } = await execFileAsync(probe.command, probe.args);
    return process.platform === "win32"
      ? windowsNetstatShowsPidListeningOnPort(stdout, pid, port)
      : stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function processCommandLooksLikeGitLeaf(pid) {
  try {
    const probe = processCommandLineCommand({ pid });
    const { stdout } = await execFileAsync(probe.command, probe.args);
    return gitLeafCommandLineLooksLikeGitLeaf(stdout);
  } catch {
    return false;
  }
}

export function tcpPortOwnerCommand({
  pid,
  port,
  platform = process.platform,
}) {
  if (platform === "win32") {
    return {
      command: "netstat",
      args: ["-ano", "-p", "tcp"],
    };
  }

  return {
    command: "lsof",
    args: [
      "-nP",
      "-a",
      "-p",
      String(pid),
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
    ],
  };
}

export function processCommandLineCommand({
  pid,
  platform = process.platform,
}) {
  if (platform === "win32") {
    const normalizedPid = Number(pid);
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${normalizedPid}").CommandLine`,
      ],
    };
  }

  return {
    command: "ps",
    args: ["-p", String(pid), "-o", "command="],
  };
}

export function windowsNetstatShowsPidListeningOnPort(output, pid, port) {
  const expectedPid = String(pid);
  const expectedPortSuffix = `:${port}`;
  return String(output ?? "")
    .split(/\r?\n/)
    .some((line) => {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5 || columns[0]?.toUpperCase() !== "TCP") {
        return false;
      }

      const localAddress = columns[1] ?? "";
      const state = columns[3] ?? "";
      const ownerPid = columns[4] ?? "";
      return (
        state.toUpperCase() === "LISTENING" &&
        ownerPid === expectedPid &&
        localAddress.endsWith(expectedPortSuffix)
      );
    });
}

export function gitLeafCommandLineLooksLikeGitLeaf(commandLine) {
  const command = String(commandLine ?? "").replaceAll("\\", "/").toLowerCase();
  return (
    command.includes("/src/cli.mjs") ||
    command.includes(" src/cli.mjs") ||
    command.includes("/git-leaf/src/cli.mjs") ||
    command.includes(" git-leaf/src/cli.mjs")
  );
}

async function terminateProcess(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function waitUntilPortAvailable({ host, port, timeoutMs = 1_500 }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortAvailable({ host, port })) {
      return true;
    }
    await delay(100);
  }
  return false;
}

async function reusableUrlForPort({
  repoRoot,
  port,
  relativePath,
  readRecord = readServerRecord,
}) {
  const record = await readRecord(repoRoot);
  const reusableRecord =
    record?.app === "git-leaf" &&
    record.repoRoot === repoRoot &&
    record.port === port
      ? record
      : null;
  return previewServerUrl({
    port,
    relativePath,
    repoId: reusableRecord?.repoId,
  });
}

function isPortAvailable({ host, port }) {
  return new Promise((resolve) => {
    const server = net.createServer();
    const onError = () => {
      server.off("listening", onListening);
      resolve(false);
    };
    const onListening = () => {
      server.off("error", onError);
      server.close(() => resolve(true));
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function createRestartSelf({ args, cwd, getServer }) {
  let restartScheduled = false;
  return async () => {
    if (restartScheduled) {
      return;
    }
    restartScheduled = true;
    setTimeout(() => {
      const server = getServer();
      server.close();
      setTimeout(() => {
        const child = spawn(process.execPath, restartArgs(args), {
          cwd,
          detached: true,
          stdio: "ignore",
          env: {
            ...process.env,
            GIT_LEAF_RESTARTED: "1",
          },
        });
        child.unref();
        setTimeout(() => process.exit(0), 200).unref();
      }, 150).unref();
      setTimeout(() => process.exit(0), 1_500).unref();
    }, 100).unref();
  };
}

function restartArgs(args) {
  const entrypoint = process.argv[1];
  const nextArgs = [entrypoint, ...args];
  return args.includes("--no-open") ? nextArgs : [...nextArgs, "--no-open"];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(args) {
  const options = {
    file: "",
    port: DEFAULT_PORT,
    open: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--host") {
      throw new Error("--host is no longer supported; Git Leaf only listens on localhost.");
    }
    if (arg === "--port") {
      options.port = Number(args[++index] ?? DEFAULT_PORT);
      continue;
    }
    if (arg === "--no-open") {
      options.open = false;
      continue;
    }
    if (!options.file) {
      options.file = arg;
    }
  }

  return options;
}

async function listenWithFallback(server, options, { repoRoot } = {}) {
  for (let offset = 0; offset < 20; offset += 1) {
    const port = options.port + offset;
    try {
      await listen(server, DEFAULT_BIND_HOST, port);
      return { port };
    } catch (error) {
      if (error?.code !== "EADDRINUSE") {
        throw error;
      }

      const stopped = await stopRegisteredGitLeafProcessOnPort({
        repoRoot,
        port,
        host: DEFAULT_BIND_HOST,
      });
      if (stopped) {
        try {
          await listen(server, DEFAULT_BIND_HOST, port);
          return { port };
        } catch (retryError) {
          if (retryError?.code !== "EADDRINUSE") {
            throw retryError;
          }
        }
      }
    }
  }

  await listen(server, DEFAULT_BIND_HOST, 0);
  const address = server.address();
  return { port: typeof address === "object" && address ? address.port : options.port };
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function openBrowser(url) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function printUsage() {
  console.error(`Usage: git-leaf [path-to-doc.md] [--no-open]

Examples:
  git-leaf
  git-leaf docs/notes/example.md
  git-leaf docs/repo-structure.md --no-open
`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
