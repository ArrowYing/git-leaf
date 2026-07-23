import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEVELOPMENT_USER_DATA_ARG,
  DEVELOPMENT_USER_DATA_ENV,
  applyDevelopmentUserDataOverride,
  assertDevelopmentUserDataOverride,
  requestedDevelopmentUserDataDir,
} from "../src/desktop-user-data.mjs";

test("development user-data flag takes precedence over the environment", () => {
  assert.equal(
    requestedDevelopmentUserDataDir({
      argv: ["electron", `${DEVELOPMENT_USER_DATA_ARG}=/tmp/git-leaf-smoke`],
      env: { [DEVELOPMENT_USER_DATA_ENV]: "/tmp/git-leaf-dev" },
    }),
    "/tmp/git-leaf-smoke",
  );
});

test("development user data cannot point at or inside production", () => {
  const defaultDir = "/Users/test/Library/Application Support/git-leaf";
  assert.throws(
    () => assertDevelopmentUserDataOverride({ requestedDir: defaultDir, defaultDir }),
    /Refusing development user-data path/,
  );
  assert.throws(
    () => assertDevelopmentUserDataOverride({
      requestedDir: path.join(defaultDir, "smoke"),
      defaultDir,
    }),
    /Refusing development user-data path/,
  );
  assert.throws(
    () => assertDevelopmentUserDataOverride({ requestedDir: "relative/dev", defaultDir }),
    /absolute path/,
  );
  assert.throws(
    () => assertDevelopmentUserDataOverride({
      requestedDir: "/Users/test/Library/Application Support",
      defaultDir,
    }),
    /Refusing development user-data path/,
  );
});

test("development user data rejects symlink targets and physical overlap", {
  skip: process.platform === "win32" && "directory symlinks require elevated Windows privileges",
}, async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-user-data-isolation-"));
  const productionDir = path.join(rootDir, "production");
  const ordinaryDevDir = path.join(rootDir, "ordinary-dev");
  const targetSymlink = path.join(rootDir, "dev-link");
  const productionAlias = path.join(rootDir, "production-alias");
  await mkdir(productionDir);
  await mkdir(ordinaryDevDir);
  await symlink(ordinaryDevDir, targetSymlink, "dir");
  await symlink(productionDir, productionAlias, "dir");

  assert.throws(
    () => assertDevelopmentUserDataOverride({
      requestedDir: targetSymlink,
      defaultDir: productionDir,
    }),
    /symbolic-link user-data path/,
  );
  assert.throws(
    () => assertDevelopmentUserDataOverride({
      requestedDir: path.join(productionAlias, "smoke"),
      defaultDir: productionDir,
    }),
    /production profile/,
  );
});

test("formal builds keep Electron default paths without an explicit override", () => {
  const calls = [];
  const result = applyDevelopmentUserDataOverride({
    app: {
      getPath: (name) => `/formal/${name}`,
      setPath: (...args) => calls.push(args),
    },
    argv: [],
    env: {},
    isDevBuild: false,
  });

  assert.deepEqual(result, { applied: false });
  assert.deepEqual(calls, []);
});

test("dev builds explicitly isolate both userData and sessionData", () => {
  const calls = [];
  const made = [];
  const logs = [];
  const defaultDir = path.resolve("/profiles/git-leaf");
  const sessionDir = path.resolve("/sessions/git-leaf");
  const developmentDir = `${defaultDir}-dev`;
  const result = applyDevelopmentUserDataOverride({
    app: {
      getPath: (name) => name === "userData" ? defaultDir : sessionDir,
      setPath: (...args) => calls.push(args),
    },
    argv: [],
    env: {},
    isDevBuild: true,
    makeDir: (...args) => made.push(args),
    log: (message) => logs.push(message),
  });

  assert.equal(result.userDataDir, developmentDir);
  assert.deepEqual(made, [[developmentDir, { recursive: true }]]);
  assert.deepEqual(calls, [
    ["userData", developmentDir],
    ["sessionData", developmentDir],
  ]);
  assert.deepEqual(logs, [
    `[Git Leaf dev] Isolated userData/sessionData: ${developmentDir}`,
  ]);
});

test("one-time smoke override replaces the stable dev default", () => {
  const calls = [];
  const defaultDir = path.resolve("/profiles/git-leaf");
  const smokeDir = path.resolve("/tmp/git-leaf-agent-smoke");
  const result = applyDevelopmentUserDataOverride({
    app: {
      getPath: () => defaultDir,
      setPath: (...args) => calls.push(args),
    },
    argv: [`${DEVELOPMENT_USER_DATA_ARG}=/tmp/git-leaf-agent-smoke`],
    env: {},
    isDevBuild: true,
    makeDir: () => {},
    log: () => {},
  });

  assert.equal(result.userDataDir, smokeDir);
  assert.deepEqual(calls, [
    ["userData", smokeDir],
    ["sessionData", smokeDir],
  ]);
});
