#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(path.dirname(SCRIPT_PATH));
const TEST_DIR = path.join(REPO_ROOT, "test");

export const MAC_RELEASE_TEST_FILES = [
  "test/mac-release.test.mjs",
];

export const WINDOWS_RELEASE_TEST_FILES = [
  "test/windows-release.test.mjs",
  "test/windows-smoke-workflow.test.mjs",
];

export function allTestFiles({ testDir = TEST_DIR } = {}) {
  return readdirSync(testDir)
    .filter((fileName) => fileName.endsWith(".test.mjs"))
    .map((fileName) => `test/${fileName}`)
    .sort();
}

export function macReleaseTestFiles() {
  return [...MAC_RELEASE_TEST_FILES];
}

export function windowsReleaseTestFiles() {
  return [...WINDOWS_RELEASE_TEST_FILES];
}

export function coreTestFiles(options = {}) {
  const platformTests = new Set([
    ...MAC_RELEASE_TEST_FILES,
    ...WINDOWS_RELEASE_TEST_FILES,
  ]);
  return allTestFiles(options).filter((filePath) => !platformTests.has(filePath));
}

export function testSuiteFiles(suiteName, options = {}) {
  switch (suiteName) {
    case "all":
      return allTestFiles(options);
    case "core":
      return coreTestFiles(options);
    case "release:mac":
      return macReleaseTestFiles();
    case "release:win":
      return windowsReleaseTestFiles();
    case "ci:mac":
      return [...coreTestFiles(options), ...macReleaseTestFiles()];
    case "ci:win":
      return [...coreTestFiles(options), ...windowsReleaseTestFiles()];
    default:
      throw new Error(`Unknown test suite: ${suiteName}`);
  }
}

function printHelp() {
  console.log(`Usage: node scripts/test-suite.mjs <suite>

Suites:
  all          Run every test file
  core         Run shared cross-platform tests
  release:mac Run macOS release tests only
  release:win Run Windows release tests only
  ci:mac       Run shared core tests plus macOS release tests
  ci:win       Run shared core tests plus Windows release tests
`);
}

function runSuite(suiteName) {
  const files = testSuiteFiles(suiteName);
  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const suiteName = process.argv[2] || "all";
  try {
    if (["help", "--help", "-h"].includes(suiteName)) {
      printHelp();
    } else {
      runSuite(suiteName);
    }
  } catch (error) {
    printHelp();
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
