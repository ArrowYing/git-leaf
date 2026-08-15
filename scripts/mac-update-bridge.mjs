#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertMacAppNotRunning,
  readMacAppVersion,
  replaceMacAppContents,
  verifySignedMacApp,
} from "../src/desktop/mac-app-contents.mjs";

export {
  assertMacAppNotRunning,
  readMacAppVersion,
  replaceMacAppContents,
  verifySignedMacApp,
};

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function optionValue(args, name) {
  const index = args.indexOf(name);
  const value = index >= 0 ? String(args[index + 1] || "").trim() : "";
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage:
  node scripts/mac-update-bridge.mjs
    --source-app /path/to/signed/Git\\ Leaf.app
    --target-app /Applications/Git\\ Leaf.app
    --expected-version VERSION

The target App must already be stopped and writable by the current user. The
bridge replaces only Contents, verifies the final signature and version, and
rolls back on failure. It never invokes a privileged Helper.`);
}

function main(args = process.argv.slice(2)) {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const sourceAppPath = optionValue(args, "--source-app");
  const targetAppPath = optionValue(args, "--target-app");
  const expectedVersion = optionValue(args, "--expected-version");
  assertMacAppNotRunning(targetAppPath);
  const result = replaceMacAppContents({
    sourceAppPath,
    targetAppPath,
    expectedVersion,
  });
  console.log(
    `Installed OpenGlance ${result.version} by nonprivileged Contents replacement`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
