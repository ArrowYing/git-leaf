import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  normalizeDesktopConfig,
  readDesktopConfig,
} from "./desktop-config.mjs";
import {
  assertPathIdentitiesDoNotOverlap,
  pathIdentity,
} from "./desktop-user-data.mjs";

const LEGACY_PROFILE_MARKER = ".git-leaf-dev-smoke-profile.json";
const LEGACY_PROFILE_MARKER_KIND = "git-leaf-development-profile";
const DURABLE_PROFILE_ENTRIES = [
  "desktop-config.json",
  "desktop-config.backup.json",
  "Local Storage",
  "Session Storage",
];

export function mergeHumanDesktopProfiles({
  productionConfig,
  developmentConfig,
}) {
  const productionPreferences = productionConfig.preferences ?? {};
  const developmentPreferences = developmentConfig.preferences ?? {};
  const preferences = {
    ...productionPreferences,
    ...developmentPreferences,
    treeDirectories: {
      ...(productionPreferences.treeDirectories ?? {}),
      ...(developmentPreferences.treeDirectories ?? {}),
    },
    workbenchSessions: {
      ...(productionPreferences.workbenchSessions ?? {}),
      ...(developmentPreferences.workbenchSessions ?? {}),
    },
  };

  return normalizeDesktopConfig({
    ...productionConfig,
    ...developmentConfig,
    openRepoRoots: uniqueStrings([
      ...(developmentConfig.openRepoRoots ?? []),
      ...(productionConfig.openRepoRoots ?? []),
    ]),
    preferences,
    repositoryFavorites: {
      ...(productionConfig.repositoryFavorites ?? {}),
      ...(developmentConfig.repositoryFavorites ?? {}),
    },
  });
}

export async function migrateLegacyHumanProfile({
  productionUserDataDir,
  legacyDevelopmentUserDataDir,
  backupRoot = path.join(
    path.dirname(path.resolve(productionUserDataDir)),
    "git-leaf-profile-backups",
  ),
  now = new Date(),
} = {}) {
  const paths = validateMigrationPaths({
    productionUserDataDir,
    legacyDevelopmentUserDataDir,
    backupRoot,
  });
  await validateLegacyProfileMarker(paths);

  const productionConfig = await readDesktopConfig({
    userDataDir: paths.productionUserDataDir,
  });
  const developmentConfig = await readDesktopConfig({
    userDataDir: paths.legacyDevelopmentUserDataDir,
  });
  const mergedConfig = mergeHumanDesktopProfiles({
    productionConfig,
    developmentConfig,
  });
  const productionConfigSource = await currentConfigSource(
    paths.productionUserDataDir,
    productionConfig,
  );
  const before = {
    production: await profileFingerprint(paths.productionUserDataDir),
    legacyDevelopment: await profileFingerprint(paths.legacyDevelopmentUserDataDir),
  };

  const backupDir = await createProfileBackup({
    ...paths,
    now,
  });
  const afterBackup = {
    production: await profileFingerprint(paths.productionUserDataDir),
    legacyDevelopment: await profileFingerprint(paths.legacyDevelopmentUserDataDir),
  };
  if (
    afterBackup.production.sha256 !== before.production.sha256
    || afterBackup.legacyDevelopment.sha256 !== before.legacyDevelopment.sha256
  ) {
    throw new Error("A profile changed while its migration backup was being created.");
  }

  await replaceDurableProfileState({
    productionUserDataDir: paths.productionUserDataDir,
    legacyDevelopmentUserDataDir: paths.legacyDevelopmentUserDataDir,
    productionConfigSource,
    mergedConfigSource: `${JSON.stringify(mergedConfig, null, 2)}\n`,
  });

  const after = {
    production: await profileFingerprint(paths.productionUserDataDir),
    legacyDevelopment: await profileFingerprint(paths.legacyDevelopmentUserDataDir),
  };
  if (after.legacyDevelopment.sha256 !== before.legacyDevelopment.sha256) {
    throw new Error("The legacy development profile changed during migration.");
  }

  const receipt = {
    kind: "git-leaf-human-profile-migration",
    schemaVersion: 1,
    completedAt: now.toISOString(),
    productionUserDataDir: paths.productionUserDataDir,
    legacyDevelopmentUserDataDir: paths.legacyDevelopmentUserDataDir,
    backupDir,
    before,
    after,
    mergedState: {
      openRepositoryCount: mergedConfig.openRepoRoots.length,
      workbenchSessionCount: Object.keys(
        mergedConfig.preferences?.workbenchSessions ?? {},
      ).length,
      favoriteScopeCount: Object.keys(mergedConfig.repositoryFavorites ?? {}).length,
    },
  };
  await writeFile(
    path.join(backupDir, "migration-receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  return {
    backupDir,
    mergedConfig,
    receipt,
  };
}

function validateMigrationPaths({
  productionUserDataDir,
  legacyDevelopmentUserDataDir,
  backupRoot,
}) {
  if (!productionUserDataDir || !legacyDevelopmentUserDataDir || !backupRoot) {
    throw new Error("Production, legacy development, and backup paths are required.");
  }
  const productionIdentity = pathIdentity(productionUserDataDir, { rejectSymlink: true });
  const developmentIdentity = pathIdentity(legacyDevelopmentUserDataDir, {
    rejectSymlink: true,
  });
  assertPathIdentitiesDoNotOverlap({
    requestedIdentity: developmentIdentity,
    protectedIdentity: productionIdentity,
  });

  const backupIdentity = pathIdentity(backupRoot, { rejectSymlink: true });
  assertPathIdentitiesDoNotOverlap({
    requestedIdentity: backupIdentity,
    protectedIdentity: productionIdentity,
  });
  assertPathIdentitiesDoNotOverlap({
    requestedIdentity: backupIdentity,
    protectedIdentity: developmentIdentity,
  });
  return {
    productionUserDataDir: productionIdentity.logicalPath,
    legacyDevelopmentUserDataDir: developmentIdentity.logicalPath,
    backupRoot: backupIdentity.logicalPath,
  };
}

async function validateLegacyProfileMarker({
  productionUserDataDir,
  legacyDevelopmentUserDataDir,
}) {
  const markerPath = path.join(legacyDevelopmentUserDataDir, LEGACY_PROFILE_MARKER);
  let marker;
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8"));
  } catch (error) {
    throw new Error(`A valid legacy manual development profile marker is required: ${markerPath}`, {
      cause: error,
    });
  }

  const recordedProductionPath = marker.schemaVersion === 1
    ? marker.sourceUserDataDir
    : marker.productionUserDataDir;
  if (
    marker.kind !== LEGACY_PROFILE_MARKER_KIND
    || marker.profileMode !== "manual"
    || (marker.schemaVersion !== 1 && marker.schemaVersion !== 2)
    || path.resolve(marker.devUserDataDir || "") !== legacyDevelopmentUserDataDir
    || path.resolve(recordedProductionPath || "") !== productionUserDataDir
  ) {
    throw new Error(`Legacy manual development profile marker does not match: ${markerPath}`);
  }
}

async function currentConfigSource(userDataDir, normalizedConfig) {
  for (const filename of ["desktop-config.json", "desktop-config.backup.json"]) {
    try {
      const source = await readFile(path.join(userDataDir, filename), "utf8");
      const value = JSON.parse(source);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return source;
      }
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
  }
  return `${JSON.stringify(normalizedConfig, null, 2)}\n`;
}

async function createProfileBackup({
  productionUserDataDir,
  legacyDevelopmentUserDataDir,
  backupRoot,
  now,
}) {
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const timestamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupDir = await mkdtemp(path.join(backupRoot, `${timestamp}-`));
  try {
    await copyProfileEntries(
      productionUserDataDir,
      path.join(backupDir, "production"),
    );
    await copyProfileEntries(
      legacyDevelopmentUserDataDir,
      path.join(backupDir, "legacy-development"),
      { includeMarker: true },
    );
    return backupDir;
  } catch (error) {
    await rm(backupDir, { recursive: true, force: true });
    throw error;
  }
}

async function copyProfileEntries(sourceDir, destinationDir, { includeMarker = false } = {}) {
  await mkdir(destinationDir, { recursive: true, mode: 0o700 });
  const entries = [
    ...DURABLE_PROFILE_ENTRIES,
    ...(includeMarker ? [LEGACY_PROFILE_MARKER] : []),
  ];
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry);
    if (!(await pathExists(sourcePath))) {
      continue;
    }
    await cp(sourcePath, path.join(destinationDir, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
}

async function replaceDurableProfileState({
  productionUserDataDir,
  legacyDevelopmentUserDataDir,
  productionConfigSource,
  mergedConfigSource,
}) {
  const transactionId = `${process.pid}-${randomUUID()}`;
  const staged = [];
  const swaps = [];

  try {
    for (const targetName of ["Local Storage", "Session Storage"]) {
      const sourcePath = path.join(legacyDevelopmentUserDataDir, targetName);
      if (!(await pathExists(sourcePath))) {
        continue;
      }
      const stagedPath = path.join(
        productionUserDataDir,
        `.profile-migration-${transactionId}-${staged.length}`,
      );
      await cp(sourcePath, stagedPath, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      staged.push({ stagedPath, targetName });
    }

    for (const [targetName, source] of [
      ["desktop-config.backup.json", productionConfigSource],
      ["desktop-config.json", mergedConfigSource],
    ]) {
      const stagedPath = path.join(
        productionUserDataDir,
        `.profile-migration-${transactionId}-${staged.length}`,
      );
      await writeFile(stagedPath, source, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      staged.push({ stagedPath, targetName });
    }

    for (const { stagedPath, targetName } of staged) {
      const targetPath = path.join(productionUserDataDir, targetName);
      const rollbackPath = path.join(
        productionUserDataDir,
        `.profile-rollback-${transactionId}-${swaps.length}`,
      );
      const hadTarget = await pathExists(targetPath);
      if (hadTarget) {
        await rename(targetPath, rollbackPath);
      }
      try {
        await rename(stagedPath, targetPath);
      } catch (error) {
        if (hadTarget) {
          await rename(rollbackPath, targetPath);
        }
        throw error;
      }
      swaps.push({ targetPath, rollbackPath, hadTarget });
    }
  } catch (error) {
    for (const swap of swaps.reverse()) {
      await rm(swap.targetPath, { recursive: true, force: true });
      if (swap.hadTarget) {
        await rename(swap.rollbackPath, swap.targetPath);
      }
    }
    throw error;
  } finally {
    for (const { stagedPath } of staged) {
      await rm(stagedPath, { recursive: true, force: true });
    }
  }

  for (const swap of swaps) {
    if (swap.hadTarget) {
      await rm(swap.rollbackPath, { recursive: true, force: true });
    }
  }
}

async function profileFingerprint(userDataDir) {
  const hash = createHash("sha256");
  let fileCount = 0;
  for (const entry of DURABLE_PROFILE_ENTRIES) {
    const entryPath = path.join(userDataDir, entry);
    for (const filePath of await profileFiles(entryPath)) {
      hash.update(path.relative(userDataDir, filePath));
      hash.update("\0");
      hash.update(await readFile(filePath));
      hash.update("\0");
      fileCount += 1;
    }
  }
  return {
    sha256: hash.digest("hex"),
    fileCount,
  };
}

async function profileFiles(entryPath) {
  let entryStat;
  try {
    entryStat = await lstat(entryPath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return [];
    }
    throw error;
  }
  if (entryStat.isSymbolicLink()) {
    throw new Error(`Profile migration cannot copy symbolic links: ${entryPath}`);
  }
  if (!entryStat.isDirectory()) {
    return [entryPath];
  }
  const entries = await readdir(entryPath);
  const nested = await Promise.all(
    entries.sort().map((entry) => profileFiles(path.join(entryPath, entry))),
  );
  return nested.flat();
}

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))];
}
