#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrateLegacyHumanProfile } from "../src/desktop/profile-migration.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function valueAfter(argv, name) {
  const inlinePrefix = `${name}=`;
  const inline = argv.find((argument) => argument.startsWith(inlinePrefix));
  if (inline) {
    return inline.slice(inlinePrefix.length);
  }
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : "";
}

function assertOpenGlanceStopped() {
  for (const [command, args] of [
    ["pgrep", ["-x", "OpenGlance"]],
    ["pgrep", ["-x", "Git Leaf"]],
    ["pgrep", ["-f", "/OpenGlance.app/Contents/MacOS/OpenGlance"]],
    ["pgrep", ["-f", "/OpenGlance.app/Contents/MacOS/Git Leaf"]],
    ["pgrep", ["-f", "/Git Leaf.app/Contents/MacOS/OpenGlance"]],
    ["pgrep", ["-f", "/Git Leaf.app/Contents/MacOS/Git Leaf"]],
    ["pgrep", ["-f", "electron src/desktop/main.mjs"]],
  ]) {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.status === 0) {
      throw new Error(
        `Close OpenGlance before migrating its profile. Running process: ${result.stdout.trim()}`,
      );
    }
  }
}

export async function runLegacyHumanProfileMigration(argv = process.argv.slice(2)) {
  if (!argv.includes("--apply")) {
    throw new Error(
      "Profile migration changes real user data. Re-run with --apply after closing OpenGlance.",
    );
  }
  if (process.platform !== "darwin") {
    throw new Error("The legacy human Profile migration is supported only on macOS.");
  }

  const applicationSupportDir = path.join(homedir(), "Library", "Application Support");
  const productionUserDataDir = path.resolve(
    valueAfter(argv, "--target") || path.join(applicationSupportDir, "git-leaf"),
  );
  const legacyDevelopmentUserDataDir = path.resolve(
    valueAfter(argv, "--source") || path.join(applicationSupportDir, "git-leaf-dev"),
  );
  const backupRoot = path.resolve(
    valueAfter(argv, "--backup-root")
      || path.join(applicationSupportDir, "git-leaf-profile-backups"),
  );

  assertOpenGlanceStopped();
  const result = await migrateLegacyHumanProfile({
    productionUserDataDir,
    legacyDevelopmentUserDataDir,
    backupRoot,
  });
  console.log(`Merged real human Profile: ${productionUserDataDir}`);
  console.log(`Legacy Profile preserved: ${legacyDevelopmentUserDataDir}`);
  console.log(`Rollback backup: ${result.backupDir}`);
  console.log(
    `Merged ${result.receipt.mergedState.openRepositoryCount} repositories and `
      + `${result.receipt.mergedState.workbenchSessionCount} workbench sessions.`,
  );
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  runLegacyHumanProfileMigration().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
