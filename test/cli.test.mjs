import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  findReusableGitLeafUrl,
  gitLeafCommandLineLooksLikeGitLeaf,
  processCommandLineCommand,
  registeredGitLeafProcessOnPort,
  reusableGitLeafUrl,
  stopRegisteredGitLeafProcessOnPort,
  tcpPortOwnerCommand,
  windowsNetstatShowsPidListeningOnPort,
} from "../src/cli.mjs";

test("reusableGitLeafUrl returns the localhost workbench URL for the same repository", async () => {
  const server = healthServer({ repoRoot: "/repo/a" });
  const port = await listen(server);

  try {
    assert.equal(
      await reusableGitLeafUrl({
        repoRoot: "/repo/a",
        port,
        relativePath: "",
        readRecord: async () => ({
          app: "git-leaf",
          repoRoot: "/repo/a",
          port,
          repoId: "docs-repo",
        }),
      }),
      `http://127.0.0.1:${port}/?repo=docs-repo`,
    );
  } finally {
    await close(server);
  }
});

test("reusableGitLeafUrl opens a requested document on an existing server", async () => {
  const server = healthServer({ repoRoot: "/repo/a" });
  const port = await listen(server);

  try {
    assert.equal(
      await reusableGitLeafUrl({
        repoRoot: "/repo/a",
        port,
        relativePath: "docs/repo structure.md",
      }),
      `http://127.0.0.1:${port}/?file=docs%2Frepo+structure.md`,
    );
  } finally {
    await close(server);
  }
});

test("reusableGitLeafUrl ignores a Git Leaf server for another repository", async () => {
  const server = healthServer({ repoRoot: "/repo/b" });
  const port = await listen(server);

  try {
    assert.equal(
      await reusableGitLeafUrl({
        repoRoot: "/repo/a",
        port,
        relativePath: "README.md",
      }),
      null,
    );
  } finally {
    await close(server);
  }
});

test("reusableGitLeafUrl requests a soft restart for a stale same-repository server", async () => {
  let restartRequested = false;
  let stale = true;
  const server = http.createServer((request, response) => {
    if (request.url?.startsWith("/api/health")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        app: "git-leaf",
        repoRoot: "/repo/a",
        toolFingerprint: stale ? "old" : "new",
        stale,
      }));
      return;
    }

    if (request.url === "/api/restart" && request.method === "POST") {
      restartRequested = true;
      stale = false;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ restarting: true }));
      return;
    }

    response.writeHead(404);
    response.end();
  });
  const port = await listen(server);

  try {
    assert.equal(
      await reusableGitLeafUrl({
        repoRoot: "/repo/a",
        port,
        relativePath: "README.md",
      }),
      `http://127.0.0.1:${port}/?file=README.md`,
    );
    assert.equal(restartRequested, true);
  } finally {
    await close(server);
  }
});

test("reusableGitLeafUrl ignores old Git Leaf servers without tool fingerprints", async () => {
  const server = healthServer({
    repoRoot: "/repo/a",
    toolFingerprint: undefined,
    stale: undefined,
  });
  const port = await listen(server);

  try {
    assert.equal(
      await reusableGitLeafUrl({
        repoRoot: "/repo/a",
        port,
        relativePath: "",
      }),
      null,
    );
  } finally {
    await close(server);
  }
});

test("findReusableGitLeafUrl moves a fallback server back to the primary port when it is free", async () => {
  const { primaryPort, fallbackPort } = await freePortPair();
  let restartRequested = false;
  let primaryServer = null;
  const fallbackServer = http.createServer((request, response) => {
    if (request.url?.startsWith("/api/health")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        app: "git-leaf",
        repoRoot: "/repo/a",
        toolFingerprint: "current",
        stale: false,
      }));
      return;
    }

    if (request.url === "/api/restart" && request.method === "POST") {
      restartRequested = true;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ restarting: true }));
      setTimeout(() => {
        fallbackServer.close();
        primaryServer = healthServer({
          repoRoot: "/repo/a",
          toolFingerprint: "current",
          stale: false,
        });
        primaryServer.listen(primaryPort, "127.0.0.1");
      }, 20);
      return;
    }

    response.writeHead(404);
    response.end();
  });
  await listenOn(fallbackServer, fallbackPort);

  try {
    assert.equal(
      await findReusableGitLeafUrl({
        repoRoot: "/repo/a",
        port: primaryPort,
        relativePath: "README.md",
      }),
      `http://127.0.0.1:${primaryPort}/?file=README.md`,
    );
    assert.equal(restartRequested, true);
  } finally {
    if (primaryServer) {
      await close(primaryServer);
    }
    await close(fallbackServer).catch(() => {});
  }
});

test("findReusableGitLeafUrl reuses a fallback port only when the primary port is busy", async () => {
  const { primaryPort, fallbackPort } = await freePortPair();
  const blocker = http.createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const fallbackServer = healthServer({ repoRoot: "/repo/a" });
  await listenOn(blocker, primaryPort);
  await listenOn(fallbackServer, fallbackPort);

  try {
    assert.equal(
      await findReusableGitLeafUrl({
        repoRoot: "/repo/a",
        port: primaryPort,
        relativePath: "README.md",
      }),
      `http://127.0.0.1:${fallbackPort}/?file=README.md`,
    );
  } finally {
    await close(fallbackServer);
    await close(blocker);
  }
});

test("reusableGitLeafUrl accepts stale restart when the fingerprint stays current", async () => {
  let restartRequested = false;
  let stale = true;
  const server = http.createServer((request, response) => {
    if (request.url?.startsWith("/api/health")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        app: "git-leaf",
        repoRoot: "/repo/a",
        toolFingerprint: "current",
        stale,
      }));
      return;
    }

    if (request.url === "/api/restart" && request.method === "POST") {
      restartRequested = true;
      stale = false;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ restarting: true }));
      return;
    }

    response.writeHead(404);
    response.end();
  });
  const port = await listen(server);

  try {
    assert.equal(
      await reusableGitLeafUrl({
        repoRoot: "/repo/a",
        port,
        relativePath: "README.md",
      }),
      `http://127.0.0.1:${port}/?file=README.md`,
    );
    assert.equal(restartRequested, true);
  } finally {
    await close(server);
  }
});

test("registeredGitLeafProcessOnPort confirms repo, port, pid, socket, and command", async () => {
  const record = await registeredGitLeafProcessOnPort({
    repoRoot: "/repo/a",
    port: 4317,
    readRecord: async () => ({
      app: "git-leaf",
      repoRoot: "/repo/a",
      port: 4317,
      pid: 1234,
    }),
    isProcessAlive: async (pid) => pid === 1234,
    pidOwnsPort: async (pid, port) => pid === 1234 && port === 4317,
    isGitLeafProcess: async (pid) => pid === 1234,
  });

  assert.deepEqual(record, {
    app: "git-leaf",
    repoRoot: "/repo/a",
    port: 4317,
    pid: 1234,
  });
});

test("registeredGitLeafProcessOnPort rejects stale records and unrelated processes", async () => {
  const base = {
    app: "git-leaf",
    repoRoot: "/repo/a",
    port: 4317,
    pid: 1234,
  };
  const defaults = {
    repoRoot: "/repo/a",
    port: 4317,
    isProcessAlive: async () => true,
    pidOwnsPort: async () => true,
    isGitLeafProcess: async () => true,
  };

  assert.equal(await registeredGitLeafProcessOnPort({
    ...defaults,
    readRecord: async () => ({ ...base, repoRoot: "/repo/b" }),
  }), null);
  assert.equal(await registeredGitLeafProcessOnPort({
    ...defaults,
    readRecord: async () => ({ ...base, port: 4318 }),
  }), null);
  assert.equal(await registeredGitLeafProcessOnPort({
    ...defaults,
    readRecord: async () => base,
    isProcessAlive: async () => false,
  }), null);
  assert.equal(await registeredGitLeafProcessOnPort({
    ...defaults,
    readRecord: async () => base,
    pidOwnsPort: async () => false,
  }), null);
  assert.equal(await registeredGitLeafProcessOnPort({
    ...defaults,
    readRecord: async () => base,
    isGitLeafProcess: async () => false,
  }), null);
});

test("stopRegisteredGitLeafProcessOnPort stops only a confirmed registered Git Leaf process", async () => {
  const stopped = [];
  const result = await stopRegisteredGitLeafProcessOnPort({
    repoRoot: "/repo/a",
    port: 4317,
    host: "127.0.0.1",
    readRecord: async () => ({
      app: "git-leaf",
      repoRoot: "/repo/a",
      port: 4317,
      pid: 1234,
    }),
    isProcessAlive: async () => true,
    pidOwnsPort: async () => true,
    isGitLeafProcess: async () => true,
    stopProcess: async (pid, signal) => {
      stopped.push([pid, signal]);
    },
    waitForPortAvailable: async () => true,
  });

  assert.equal(result, true);
  assert.deepEqual(stopped, [[1234, "SIGTERM"]]);
});

test("windows CLI process probes avoid Unix-only lsof and ps commands", () => {
  assert.deepEqual(tcpPortOwnerCommand({ pid: 1234, port: 4317, platform: "win32" }), {
    command: "netstat",
    args: ["-ano", "-p", "tcp"],
  });
  assert.deepEqual(processCommandLineCommand({ pid: 1234, platform: "win32" }), {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      '(Get-CimInstance Win32_Process -Filter "ProcessId = 1234").CommandLine',
    ],
  });
});

test("windows netstat listener output confirms the matching Git Leaf process", () => {
  const output = [
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    127.0.0.1:4317         0.0.0.0:0              LISTENING       1234",
    "  TCP    127.0.0.1:4318         0.0.0.0:0              LISTENING       1234",
    "  TCP    127.0.0.1:4317         0.0.0.0:0              ESTABLISHED     9999",
  ].join("\n");

  assert.equal(windowsNetstatShowsPidListeningOnPort(output, 1234, 4317), true);
  assert.equal(windowsNetstatShowsPidListeningOnPort(output, 9999, 4317), false);
  assert.equal(windowsNetstatShowsPidListeningOnPort(output, 1234, 14317), false);
});

test("Git Leaf command detection accepts Windows paths", () => {
  assert.equal(
    gitLeafCommandLineLooksLikeGitLeaf(
      'C:\\Program Files\\nodejs\\node.exe C:\\Users\\ops\\git-leaf\\src\\cli.mjs --no-open',
    ),
    true,
  );
  assert.equal(
    gitLeafCommandLineLooksLikeGitLeaf("C:\\Program Files\\nodejs\\node.exe C:\\tools\\other.mjs"),
    false,
  );
});

function healthServer(payload) {
  return http.createServer((request, response) => {
    if (request.url?.startsWith("/api/health")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        app: "git-leaf",
        toolFingerprint: "abc123",
        stale: false,
        ...payload,
      }));
      return;
    }

    response.writeHead(404);
    response.end();
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(address.port);
    });
  });
}

async function freePortPair() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const primaryPort = await randomFreePort();
    const fallbackPort = primaryPort + 1;
    if (await canListenOn(primaryPort) && await canListenOn(fallbackPort)) {
      return { primaryPort, fallbackPort };
    }
  }
  throw new Error("Unable to find adjacent free ports for Git Leaf CLI test");
}

async function randomFreePort() {
  const server = http.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function canListenOn(port) {
  const server = http.createServer();
  try {
    await listenOn(server, port);
    return true;
  } catch {
    return false;
  } finally {
    await close(server).catch(() => {});
  }
}

function listenOn(server, port) {
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
    server.listen(port, "127.0.0.1");
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
