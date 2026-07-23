import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import {
  coreTestFiles,
  macReleaseTestFiles,
  testSuiteFiles,
  windowsReleaseTestFiles,
} from "../scripts/test-suite.mjs";

test("test suite partitions keep platform release tests out of core", async () => {
  const allTests = (await readdir("test"))
    .filter((fileName) => fileName.endsWith(".test.mjs"))
    .map((fileName) => `test/${fileName}`)
    .sort();
  const coreTests = coreTestFiles().sort();
  const macTests = macReleaseTestFiles().sort();
  const windowsTests = windowsReleaseTestFiles().sort();
  const assignedTests = [...coreTests, ...macTests, ...windowsTests].sort();

  assert.deepEqual(assignedTests, allTests);
  assert.equal(new Set(assignedTests).size, assignedTests.length);
  assert.equal(coreTests.includes("test/mac-release.test.mjs"), false);
  assert.equal(coreTests.includes("test/windows-release.test.mjs"), false);
  assert.equal(coreTests.includes("test/windows-smoke-workflow.test.mjs"), false);
});

test("CI suites combine shared core tests with only their release platform", () => {
  const windowsCiTests = testSuiteFiles("ci:win");
  const macCiTests = testSuiteFiles("ci:mac");

  assert.ok(windowsCiTests.includes("test/server.test.mjs"));
  assert.ok(windowsCiTests.includes("test/windows-release.test.mjs"));
  assert.ok(windowsCiTests.includes("test/windows-smoke-workflow.test.mjs"));
  assert.equal(windowsCiTests.includes("test/mac-release.test.mjs"), false);

  assert.ok(macCiTests.includes("test/server.test.mjs"));
  assert.ok(macCiTests.includes("test/mac-release.test.mjs"));
  assert.equal(macCiTests.includes("test/windows-release.test.mjs"), false);
  assert.equal(macCiTests.includes("test/windows-smoke-workflow.test.mjs"), false);
});

test("package scripts expose platform-specific CI test suites", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(packageJson.scripts.test, "node scripts/test-suite.mjs core");
  assert.equal(packageJson.scripts["test:all"], "node scripts/test-suite.mjs all");
  assert.equal(packageJson.scripts["test:core"], "node scripts/test-suite.mjs core");
  assert.equal(packageJson.scripts["test:ci:mac"], "node scripts/test-suite.mjs ci:mac");
  assert.equal(packageJson.scripts["test:ci:win"], "node scripts/test-suite.mjs ci:win");
});
