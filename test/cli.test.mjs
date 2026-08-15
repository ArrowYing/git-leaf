import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  findReusableOpenGlanceUrl,
  openGlanceCommandLineLooksLikeOpenGlance,
  processCommandLineCommand,
  registeredOpenGlanceProcessOnPort,
  reusableOpenGlanceUrl,
  stopRegisteredOpenGlanceProcessOnPort,
  tcpPortOwnerCommand,
  windowsNetstatShowsPidListeningOnPort,
} from "../src/cli.mjs";

test("reusableOpenGlanceUrl returns the localhost workbench URL for the same repository", async () => {
  const server = healthServer({ repoRoot: "/repo/a" });
  const port = await listen(server);

  try {
    assert.equal(
      await reusableOpenGlanceUrl({
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

test("reusableOpenGlanceUrl tolerates a loaded runner without delaying ordinary CLI startup", async () => {
  const server = healthServer({ repoRoot: "/repo/a" }, { delayMs: 250 });
  const port = await listen(server);

  try {
    assert.equal(
      await reusableOpenGlanceUrl({
        repoRoot: "/repo/a",
        port,
        relativePath: "README.md",
      }),
      `http://127.0.0.1:${port}/?file=README.md`,
    );
  } finally {
    await close(server);
  }
});

test("reusableOpenGlanceUrl accepts a healthy Git Leaf 1.x server for the same repository", async () => {
  const server = healthServer({ app: "git-leaf", repoRoot: "/repo/a" });
  const port = await listen(server);

  try {
    assert.equal(await reusableOpenGlanceUrl({
      repoRoot: "/repo/a",
      port,
      relativePath: "README.md",
      readRecord: async () => ({ app: "git-leaf", repoRoot: "/repo/a", port }),
    }), `http://127.0.0.1:${port}/?file=README.md`);
  } finally {
    await close(server);
  }
});

test("reusableOpenGlanceUrl accepts a healthy OpenPeek 2.x server for the same repository", async () => {
  const server = healthServer({ app: "openpeek", repoRoot: "/repo/a" });
  const port = await listen(server);

  try {
    assert.equal(await reusableOpenGlanceUrl({
      repoRoot: "/repo/a",
      port,
      relativePath: "README.md",
      readRecord: async () => ({ app: "openpeek", repoRoot: "/repo/a", port }),
    }), `http://127.0.0.1:${port}/?file=README.md`);
  } finally {
    await close(server);
  }
});

test("reusableOpenGlanceUrl opens a requested document on an existing server", async () => {
  const server = healthServer({ repoRoot: "/repo/a" });
  const port = await listen(server);

  try {
    assert.equal(
      await reusableOpenGlanceUrl({
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

test("reusableOpenGlanceUrl ignores an OpenGlance server for another repository", async () => {
  const server = healthServer({ repoRoot: "/repo/b" });
  const port = await listen(server);

  try {
    assert.equal(
      await reusableOpenGlanceUrl({
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

test("reusableOpenGlanceUrl requests a soft restart for a stale same-repository server", async () => {
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
      await reusableOpenGlanceUrl({
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

test("reusableOpenGlanceUrl ignores old OpenGlance servers without tool fingerprints", async () => {
  const server = healthServer({
    repoRoot: "/repo/a",
    toolFingerprint: undefined,
    stale: undefined,
  });
  const port = await listen(server);

  try {
    assert.equal(
      await reusableOpenGlanceUrl({
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

test("findReusableOpenGlanceUrl moves a fallback server back to the primary port when it is free", async () => {
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
      await findReusableOpenGlanceUrl({
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

test("findReusableOpenGlanceUrl reuses a fallback port only when the primary port is busy", async () => {
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
      await findReusableOpenGlanceUrl({
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

test("reusableOpenGlanceUrl accepts stale restart when the fingerprint stays current", async () => {
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
      await reusableOpenGlanceUrl({
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

test("registeredOpenGlanceProcessOnPort confirms repo, port, pid, socket, and command", async () => {
  const record = await registeredOpenGlanceProcessOnPort({
    repoRoot: "/repo/a",
    port: 4317,
    readRecord: async () => ({
      app: "openglance",
      repoRoot: "/repo/a",
      port: 4317,
      pid: 1234,
    }),
    isProcessAlive: async (pid) => pid === 1234,
    pidOwnsPort: async (pid, port) => pid === 1234 && port === 4317,
    isOpenGlanceProcess: async (pid) => pid === 1234,
  });

  assert.deepEqual(record, {
    app: "openglance",
    repoRoot: "/repo/a",
    port: 4317,
    pid: 1234,
  });
});

test("registeredOpenGlanceProcessOnPort rejects stale records and unrelated processes", async () => {
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
    isOpenGlanceProcess: async () => true,
  };

  assert.equal(await registeredOpenGlanceProcessOnPort({
    ...defaults,
    readRecord: async () => ({ ...base, repoRoot: "/repo/b" }),
  }), null);
  assert.equal(await registeredOpenGlanceProcessOnPort({
    ...defaults,
    readRecord: async () => ({ ...base, port: 4318 }),
  }), null);
  assert.equal(await registeredOpenGlanceProcessOnPort({
    ...defaults,
    readRecord: async () => base,
    isProcessAlive: async () => false,
  }), null);
  assert.equal(await registeredOpenGlanceProcessOnPort({
    ...defaults,
    readRecord: async () => base,
    pidOwnsPort: async () => false,
  }), null);
  assert.equal(await registeredOpenGlanceProcessOnPort({
    ...defaults,
    readRecord: async () => base,
    isOpenGlanceProcess: async () => false,
  }), null);
});

test("stopRegisteredOpenGlanceProcessOnPort stops only a confirmed registered OpenGlance process", async () => {
  const stopped = [];
  const result = await stopRegisteredOpenGlanceProcessOnPort({
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
    isOpenGlanceProcess: async () => true,
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

test("windows netstat listener output confirms the matching OpenGlance process", () => {
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

test("OpenGlance command detection accepts Windows paths", () => {
  assert.equal(
    openGlanceCommandLineLooksLikeOpenGlance(
      'C:\\Program Files\\nodejs\\node.exe C:\\Users\\ops\\git-leaf\\src\\cli.mjs --no-open',
    ),
    true,
  );
  assert.equal(
    openGlanceCommandLineLooksLikeOpenGlance(
      "C:\\Program Files\\nodejs\\node.exe C:\\Users\\ops\\openpeek\\src\\cli.mjs --no-open",
    ),
    true,
  );
  assert.equal(
    openGlanceCommandLineLooksLikeOpenGlance("C:\\Program Files\\nodejs\\node.exe C:\\tools\\other.mjs"),
    false,
  );
});

function healthServer(payload, { delayMs = 0 } = {}) {
  return http.createServer((request, response) => {
    if (request.url?.startsWith("/api/health")) {
      setTimeout(() => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          app: "openglance",
          toolFingerprint: "abc123",
          stale: false,
          ...payload,
        }));
      }, delayMs);
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
  throw new Error("Unable to find adjacent free ports for OpenGlance CLI test");
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
