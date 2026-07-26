import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { replaceMacAppContents } from "../scripts/mac-update-bridge.mjs";

function fixtureApp(root, name, version) {
  const appPath = path.join(root, name);
  mkdirSync(path.join(appPath, "Contents"), { recursive: true });
  writeFileSync(path.join(appPath, "Contents", "version.txt"), version);
  return appPath;
}

function readFixtureVersion(appPath) {
  return readFileSync(path.join(appPath, "Contents", "version.txt"), "utf8");
}

test("mac update bridge replaces only Contents and preserves the App inode", () => {
  const root = mkdtempSync(path.join(tmpdir(), "git-leaf-update-bridge-test."));
  try {
    const source = fixtureApp(root, "source.app", "2.0.0");
    const target = fixtureApp(root, "target.app", "1.0.0");
    const inode = statSync(target).ino;
    const result = replaceMacAppContents({
      sourceAppPath: source,
      targetAppPath: target,
      expectedVersion: "2.0.0",
      verifyApp() {},
      readVersion: readFixtureVersion,
      copyContents: (from, to) => cpSync(from, to, { recursive: true }),
    });
    assert.equal(result.installMode, "contents-bridge");
    assert.equal(readFixtureVersion(target), "2.0.0");
    assert.equal(statSync(target).ino, inode);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mac update bridge rolls back when final verification fails", () => {
  const root = mkdtempSync(path.join(tmpdir(), "git-leaf-update-bridge-test."));
  try {
    const source = fixtureApp(root, "source.app", "2.0.0");
    const target = fixtureApp(root, "target.app", "1.0.0");
    let verificationCount = 0;
    assert.throws(
      () => replaceMacAppContents({
        sourceAppPath: source,
        targetAppPath: target,
        expectedVersion: "2.0.0",
        verifyApp() {
          verificationCount += 1;
          if (verificationCount === 2) {
            throw new Error("synthetic final verification failure");
          }
        },
        readVersion: readFixtureVersion,
        copyContents: (from, to) => cpSync(from, to, { recursive: true }),
      }),
      /synthetic final verification failure/,
    );
    assert.equal(readFixtureVersion(target), "1.0.0");
    assert.equal(
      existsSync(path.join(target, "Contents", "version.txt")),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
