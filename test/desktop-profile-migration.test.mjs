import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readDesktopConfig } from "../src/desktop/config.mjs";
import { migrateLegacyHumanProfile } from "../src/desktop/profile-migration.mjs";

async function makeProfiles() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-profile-migration-"));
  const productionUserDataDir = path.join(rootDir, "git-leaf");
  const legacyDevelopmentUserDataDir = path.join(rootDir, "git-leaf-dev");
  const backupRoot = path.join(rootDir, "profile-backups");
  for (const userDataDir of [productionUserDataDir, legacyDevelopmentUserDataDir]) {
    await mkdir(path.join(userDataDir, "Local Storage"), { recursive: true });
    await mkdir(path.join(userDataDir, "Session Storage"));
  }
  return {
    productionUserDataDir,
    legacyDevelopmentUserDataDir,
    backupRoot,
  };
}

async function writeLegacyMarker({ productionUserDataDir, legacyDevelopmentUserDataDir }) {
  await writeFile(
    path.join(legacyDevelopmentUserDataDir, ".git-leaf-dev-smoke-profile.json"),
    `${JSON.stringify({
      kind: "git-leaf-development-profile",
      schemaVersion: 2,
      profileMode: "manual",
      sourceUserDataDir: productionUserDataDir,
      devUserDataDir: legacyDevelopmentUserDataDir,
      productionUserDataDir,
      sourcePhysicalUserDataDir: await realpath(productionUserDataDir),
      devPhysicalUserDataDir: await realpath(legacyDevelopmentUserDataDir),
      productionPhysicalUserDataDir: await realpath(productionUserDataDir),
    }, null, 2)}\n`,
  );
}

test("legacy human profile migration merges real-use state and preserves both originals", async () => {
  const paths = await makeProfiles();
  const productionConfig = {
    repoRoot: "/repo/production-current",
    openRepoRoots: ["/repo/production-current", "/repo/shared"],
    preferences: {
      colorMode: "light",
      sidebarWidth: 182,
      treeDirectories: {
        productionRepo: { expanded: ["docs"] },
      },
      workbenchSessions: {
        productionRepo: {
          tabs: [{ path: "README.md" }],
          activeTabPath: "README.md",
        },
      },
    },
    repositoryFavorites: {
      "/repo/production": [{ type: "document", path: "README.md" }],
    },
    usageAnalyticsEnabled: true,
  };
  const developmentConfig = {
    repoRoot: "/repo/development-current",
    openRepoRoots: ["/repo/development-current", "/repo/shared"],
    preferences: {
      colorMode: "system",
      sidebarWidth: 205,
      treeDirectories: {
        developmentRepo: { expanded: ["notes"] },
      },
      workbenchSessions: {
        developmentRepo: {
          tabs: [{ path: "AGENTS.md" }],
          activeTabPath: "AGENTS.md",
        },
      },
    },
    repositoryFavorites: {
      "/repo/development": [{ type: "document", path: "AGENTS.md" }],
    },
    usageAnalyticsEnabled: false,
  };
  for (const [userDataDir, config] of [
    [paths.productionUserDataDir, productionConfig],
    [paths.legacyDevelopmentUserDataDir, developmentConfig],
  ]) {
    await writeFile(
      path.join(userDataDir, "desktop-config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    await writeFile(
      path.join(userDataDir, "desktop-config.backup.json"),
      `${JSON.stringify(config, null, 2)}\n`,
    );
  }
  await writeFile(
    path.join(paths.productionUserDataDir, "Local Storage", "state"),
    "production-local-storage",
  );
  await writeFile(
    path.join(paths.legacyDevelopmentUserDataDir, "Local Storage", "state"),
    "development-local-storage",
  );
  await writeFile(
    path.join(paths.productionUserDataDir, "Session Storage", "state"),
    "production-session-storage",
  );
  await writeFile(
    path.join(paths.legacyDevelopmentUserDataDir, "Session Storage", "state"),
    "development-session-storage",
  );
  await writeLegacyMarker(paths);

  const result = await migrateLegacyHumanProfile(paths);
  const merged = await readDesktopConfig({ userDataDir: paths.productionUserDataDir });

  assert.equal(merged.repoRoot, "/repo/development-current");
  assert.deepEqual(merged.openRepoRoots, [
    "/repo/development-current",
    "/repo/shared",
    "/repo/production-current",
  ]);
  assert.equal(merged.preferences.colorMode, "system");
  assert.equal(merged.preferences.sidebarWidth, 205);
  assert.deepEqual(Object.keys(merged.preferences.treeDirectories).sort(), [
    "developmentRepo",
    "productionRepo",
  ]);
  assert.deepEqual(Object.keys(merged.preferences.workbenchSessions).sort(), [
    "developmentRepo",
    "productionRepo",
  ]);
  assert.deepEqual(Object.keys(merged.repositoryFavorites).sort(), [
    "/repo/development",
    "/repo/production",
  ]);
  assert.equal(merged.usageAnalyticsEnabled, false);
  assert.equal(
    await readFile(path.join(paths.productionUserDataDir, "Local Storage", "state"), "utf8"),
    "development-local-storage",
  );
  assert.equal(
    await readFile(path.join(paths.productionUserDataDir, "Session Storage", "state"), "utf8"),
    "development-session-storage",
  );
  assert.equal(
    await readFile(
      path.join(paths.legacyDevelopmentUserDataDir, "Local Storage", "state"),
      "utf8",
    ),
    "development-local-storage",
  );
  assert.equal(
    JSON.parse(await readFile(
      path.join(paths.productionUserDataDir, "desktop-config.backup.json"),
      "utf8",
    )).repoRoot,
    "/repo/production-current",
  );
  assert.equal(
    JSON.parse(await readFile(
      path.join(result.backupDir, "production", "desktop-config.json"),
      "utf8",
    )).repoRoot,
    "/repo/production-current",
  );
  assert.equal(
    JSON.parse(await readFile(
      path.join(result.backupDir, "legacy-development", "desktop-config.json"),
      "utf8",
    )).repoRoot,
    "/repo/development-current",
  );
  assert.equal((await stat(path.join(result.backupDir, "migration-receipt.json"))).isFile(), true);
});

test("legacy human profile migration rejects an unmarked source without changing production", async () => {
  const paths = await makeProfiles();
  const productionSource = `${JSON.stringify({
    openRepoRoots: ["/repo/production"],
  }, null, 2)}\n`;
  await writeFile(
    path.join(paths.productionUserDataDir, "desktop-config.json"),
    productionSource,
  );
  await writeFile(
    path.join(paths.legacyDevelopmentUserDataDir, "desktop-config.json"),
    `${JSON.stringify({ openRepoRoots: ["/repo/development"] }, null, 2)}\n`,
  );

  await assert.rejects(
    migrateLegacyHumanProfile(paths),
    /legacy manual development profile marker/i,
  );
  assert.equal(
    await readFile(path.join(paths.productionUserDataDir, "desktop-config.json"), "utf8"),
    productionSource,
  );
});
