import assert from "node:assert/strict";
import { renameSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_RELEASE_OPTIONS,
  applyMacBundleIcon,
  assertDevelopmentSmokeUserDataPath,
  assertDevelopmentUserDataIsolation,
  cleanupDevelopmentSmokeUserData,
  codesignArgs,
  dmgLocaleFromValue,
  dmgTextForLocale,
  devInstallSteps,
  devSmokeSteps,
  developmentProfileFingerprint,
  developmentPackageCleanupPlan,
  developmentAppQuitCommands,
  developmentAppForceQuitCommands,
  developmentAppProcessQueries,
  electronCacheZipDir,
  electronPackagerArgs,
  ensureReleaseLoginKeychainSession,
  ensureManualDevelopmentUserData,
  launchDevelopmentAppCommand,
  macCommandRequiresNewReleaseVersion,
  macDevelopmentInstallOptions,
  macDevelopmentUserDataPaths,
  macBundleIconPaths,
  macDevelopmentInstallPaths,
  macDmgLayoutPaths,
  macEntitlementsPath,
  macUpdateMetadataPaths,
  macReleasePaths,
  dmgBackgroundSvg,
  dmgFinderLayoutScript,
  dmgStagingVolumeName,
  nestedMachOSigningTargets,
  prepareDevelopmentUserData,
  selectDevelopmentSmokeSource,
  releaseSteps,
  runReleaseCommand,
  runDevelopmentSmokeWorkflow,
  stageMacUpdateMetadata,
  universalMachOVerificationCommand,
  verifyProductionProfileUnchanged,
} from "../scripts/release-mac.mjs";

test("mac release prerequisites never attempt an automatic empty-password unlock", () => {
  const calls = [];
  assert.throws(
    () => ensureReleaseLoginKeychainSession({
      homeDir: "/Users/release",
      runCommand(command, args) {
        calls.push([command, args]);
        return { status: 51, stderr: "locked" };
      },
    }),
    /approved secure mechanism/,
  );
  assert.deepEqual(calls, [
    ["security", ["show-keychain-info", "/Users/release/Library/Keychains/login.keychain-db"]],
  ]);
});

test("mac release prerequisites leave an available login keychain unchanged", () => {
  const calls = [];
  const result = ensureReleaseLoginKeychainSession({
    homeDir: "/Users/release",
    runCommand(command, args) {
      calls.push([command, args]);
      return { status: 0, stderr: "" };
    },
  });

  assert.equal(result.unlocked, false);
  assert.equal(calls.length, 1);
});

test("mac release prerequisites fail before signing when keychain recovery is unavailable", () => {
  assert.throws(
    () => ensureReleaseLoginKeychainSession({
      homeDir: "/Users/release",
      runCommand: () => ({ status: 51, stderr: "keychain authentication failed" }),
    }),
    /approved secure mechanism/,
  );
});

test("mac release package args exclude tests and generated outputs", () => {
  const args = electronPackagerArgs({
    appName: "Git Leaf",
    version: "1.9.1",
    bundleId: "com.mangofuture.gitleaf",
    outDir: "dist",
  });

  assert.ok(args.includes("--protocol=git-leaf"));
  assert.ok(args.includes("--protocol-name=Git Leaf Document"));
  assert.ok(args.includes("--arch=universal"));
  assert.ok(args.includes("--app-version=1.9.1"));

  const ignoreValues = args
    .filter((arg) => arg.startsWith("--ignore="))
    .map((arg) => arg.slice("--ignore=".length));

  assert.ok(
    ignoreValues.includes("^/test($|/)"),
    "release packaging must exclude test files from app.asar",
  );
  assert.ok(ignoreValues.includes("^/dist($|/)"));
  assert.ok(ignoreValues.includes("^/\\.git($|/)"));
});

test("mac release package args exclude internal docs, release scripts, and dev-only dependencies", () => {
  const args = electronPackagerArgs({
    appName: "Git Leaf",
    bundleId: "com.mangofuture.gitleaf",
    outDir: "dist",
  });
  const ignorePatterns = args
    .filter((arg) => arg.startsWith("--ignore="))
    .map((arg) => new RegExp(arg.slice("--ignore=".length)));
  const isIgnored = (filePath) => ignorePatterns.some((pattern) => pattern.test(filePath));

  for (const filePath of [
    "/scripts/release-mac.mjs",
    "/Makefile",
    "/AGENTS.md",
    "/CLAUDE.md",
    "/CONTRIBUTING.md",
    "/SECURITY.md",
    "/architecture.md",
    "/release.md",
    "/mdx-lite-guide.md",
    "/mdx-lite-components-demo.mdx",
    "/windows-portable-guide.md",
    "/docs/app-usage-analytics-spec.md",
    "/.superpowers/brainstorm/demo/content/index.html",
    "/.gitignore",
    "/.gitleaks.toml",
    "/.github/workflows/windows-release-smoke.yml",
    "/assets/icons/git-leaf.png",
    "/node_modules/@electron/get/package.json",
    "/node_modules/@electron-internal/extract-zip/package.json",
    "/node_modules/@esbuild/darwin-arm64/bin/esbuild",
    "/node_modules/@types/node/index.d.ts",
    "/node_modules/@lezer/css/test/test-css.js",
    "/node_modules/@lezer/markdown/test-markdown.js",
  ]) {
    assert.equal(isIgnored(filePath), true, `${filePath} should not be copied into app.asar`);
  }
});

test("mac release package args can reuse a local Electron zip cache", () => {
  const args = electronPackagerArgs({
    appName: "Git Leaf",
    bundleId: "com.mangofuture.gitleaf",
    outDir: "dist",
    electronZipDir: "/Users/example/Library/Caches/electron/cache-id",
  });

  assert.ok(args.includes("--electron-zip-dir=/Users/example/Library/Caches/electron/cache-id"));
});

test("mac release package args include the Git Leaf app icon", () => {
  const args = electronPackagerArgs({
    appName: "Git Leaf",
    bundleId: "com.mangofuture.gitleaf",
    outDir: "dist",
    iconPath: "assets/icons/git-leaf",
  });

  assert.ok(args.includes("--icon=assets/icons/git-leaf"));
});

test("mac release signing targets include Electron nested binaries notarization checks reject", () => {
  const targets = nestedMachOSigningTargets("Example.app");

  assert.deepEqual(targets.map(slashPath), [
    "Example.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib",
    "Example.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libvk_swiftshader.dylib",
    "Example.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libGLESv2.dylib",
    "Example.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib",
    "Example.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler",
    "Example.app/Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt",
  ]);
});

test("mac release verification checks every Mach-O for both supported architectures", () => {
  const [command, args] = universalMachOVerificationCommand("/repo/dist/Git Leaf.app");

  assert.equal(command, "bash");
  assert.match(args[1], /find "\$1" -type f -print0/);
  assert.match(args[1], /lipo "\$target" -verify_arch arm64 x86_64/);
  assert.equal(args.at(-1), "/repo/dist/Git Leaf.app");
});

test("mac release paths use friendly versioned artifact filenames", () => {
  const paths = macReleasePaths({
    rootDir: "/repo",
    appName: "Git Leaf",
    version: "0.1.1",
  });

  assert.equal(slashPath(paths.appDir), "/repo/dist/Git Leaf-darwin-universal/Git Leaf.app");
  assert.equal(
    slashPath(paths.dmgPath),
    "/repo/dist/GitLeaf-0.1.1-source-darwin-universal.dmg",
  );
  assert.equal(
    slashPath(paths.zipPath),
    "/repo/dist/GitLeaf-0.1.1-source-darwin-universal.zip",
  );
});

test("mac internal release filenames cannot collide with the same public semver", () => {
  const paths = macReleasePaths({
    rootDir: "/repo",
    appName: "Git Leaf",
    version: "0.1.1",
    releaseTrack: "internal",
    buildId: "93458e1.20260705T114700Z",
  });

  assert.equal(
    slashPath(paths.dmgPath),
    "/repo/dist/GitLeaf-0.1.1-internal-darwin-universal.dmg",
  );
  assert.equal(
    slashPath(paths.zipPath),
    "/repo/dist/GitLeaf-0.1.1-internal-darwin-universal.zip",
  );
});

test("mac development install paths reuse friendly release artifact filenames", () => {
  const paths = macDevelopmentInstallPaths({
    rootDir: "/repo",
    appName: "Git Leaf",
    version: "0.1.2",
    buildId: "71560e5557a8.20260706T031909Z",
  });

  assert.equal(
    slashPath(paths.dmgPath),
    "/repo/dist/GitLeaf-0.1.2-source-darwin-universal.dmg",
  );
  assert.equal(
    slashPath(paths.zipPath),
    "/repo/dist/GitLeaf-0.1.2-source-darwin-universal.zip",
  );
});

test("mac update metadata paths mirror the update service update directory shape", () => {
  const paths = macUpdateMetadataPaths({
    rootDir: "/repo",
    channel: "stable",
    platformKey: "darwin-arm64",
  });

  assert.equal(paths.updateDir, "/repo/dist/updates/git-leaf/stable/darwin-arm64");
  assert.equal(paths.latestJsonPath, "/repo/dist/updates/git-leaf/stable/darwin-arm64/latest.json");
  assert.equal(paths.releasesJsonPath, "/repo/dist/updates/git-leaf/stable/darwin-arm64/releases.json");
  assert.equal(paths.sha256Path, "/repo/dist/updates/git-leaf/stable/darwin-arm64/sha256sums.txt");
});

test("mac update staging keeps artifacts universal and publishes only an ARM migration manifest", async () => {
  const rootDir = await mkdtempPath("git-leaf-universal-update-");
  try {
    const dmgPath = path.join(rootDir, "GitLeaf-1.9.0-internal-darwin-universal.dmg");
    const zipPath = path.join(rootDir, "GitLeaf-1.9.0-internal-darwin-universal.zip");
    await writeFile(dmgPath, "universal dmg");
    await writeFile(zipPath, "universal zip");

    const { universalPaths, arm64MigrationPaths } = stageMacUpdateMetadata({
      appName: "Git Leaf",
      updateBaseUrl: "https://updates.mangofuture.com/git-leaf",
      updateChannel: "internal-stable",
      releaseTrack: "internal",
      version: "1.9.0",
      buildId: "build-1",
      commit: "abc123",
      builtAt: "2026-07-14T00:00:00.000Z",
    }, { dmgPath, zipPath }, { rootDir });

    assert.deepEqual((await readdir(universalPaths.updateDir)).sort(), [
      "GitLeaf-1.9.0-internal-darwin-universal.dmg",
      "GitLeaf-1.9.0-internal-darwin-universal.zip",
      "latest.json",
      "releases.json",
      "sha256sums.txt",
    ]);
    assert.deepEqual((await readdir(arm64MigrationPaths.updateDir)).sort(), [
      "latest.json",
      "releases.json",
    ]);

    const universalManifest = JSON.parse(await readFile(universalPaths.latestJsonPath, "utf8"));
    const migrationManifest = JSON.parse(await readFile(arm64MigrationPaths.latestJsonPath, "utf8"));
    assert.equal(universalManifest.platform, "darwin-universal");
    assert.equal(universalManifest.channel, "internal-stable");
    assert.equal(universalManifest.releaseTrack, "internal");
    assert.equal(universalManifest.buildId, "build-1.internal");
    assert.equal(migrationManifest.platform, "darwin-arm64");
    assert.equal(migrationManifest.releaseTrack, "internal");
    assert.equal(migrationManifest.files.zip.url, universalManifest.files.zip.url);
    assert.match(
      migrationManifest.files.zip.url,
      /\/internal-stable\/darwin-universal\/GitLeaf-1\.9\.0-internal-darwin-universal\.zip$/,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("formal mac package fails closed before packaging when its release profile is absent", () => {
  assert.throws(
    () => runReleaseCommand("package", {
      formalRelease: true,
      distribution: "source",
      releaseTrack: "source",
      usageAnalyticsDefault: false,
    }),
    /Official release commands require GIT_LEAF_RELEASE_PROFILE/,
  );
});

test("mac bundle icon uses a Git Leaf resource name instead of the Electron default", () => {
  const paths = macBundleIconPaths({
    rootDir: "/repo",
    appDir: "/repo/dist/Git Leaf-darwin-universal/Git Leaf.app",
    iconPath: "assets/icons/git-leaf",
  });

  assert.equal(slashPath(paths.sourceIconPath), "/repo/assets/icons/git-leaf.icns");
  assert.equal(paths.bundleIconFile, "git-leaf.icns");
  assert.equal(
    slashPath(paths.bundleIconPath),
    "/repo/dist/Git Leaf-darwin-universal/Git Leaf.app/Contents/Resources/git-leaf.icns",
  );
});

test("mac bundle icon application refreshes the app bundle mtime for LaunchServices", async () => {
  const tempDir = await mkdtempPath("git-leaf-mac-icon-");
  try {
    const appDir = path.join(tempDir, "Git Leaf.app");
    const resourcesDir = path.join(appDir, "Contents", "Resources");
    await mkdir(resourcesDir, { recursive: true });
    await writeFile(
      path.join(appDir, "Contents", "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIconFile</key>
  <string>electron.icns</string>
</dict>
</plist>
`,
      "utf8",
    );
    const oldDate = new Date("2000-01-01T00:00:00.000Z");
    await utimes(appDir, oldDate, oldDate);

    applyMacBundleIcon({ iconPath: DEFAULT_RELEASE_OPTIONS.iconPath }, { appDir });

    const appStat = await stat(appDir);
    const infoPlist = await readFile(path.join(appDir, "Contents", "Info.plist"), "utf8");
    assert.match(infoPlist, /<string>git-leaf\.icns<\/string>/);
    assert.ok(
      appStat.mtimeMs > oldDate.getTime(),
      "the .app root mtime must change so macOS refreshes cached app icons",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mac release signing uses Electron hardened runtime entitlements", () => {
  const entitlementsPath = macEntitlementsPath({
    rootDir: "/repo",
    entitlementsPath: "assets/entitlements.mac.plist",
  });
  const args = codesignArgs("/repo/dist/Git Leaf.app", "Developer ID Application: Example", {
    entitlementsPath,
  });

  assert.deepEqual(args, [
    "--force",
    "--timestamp",
    "--options",
    "runtime",
    "--entitlements",
    "/repo/assets/entitlements.mac.plist",
    "--sign",
    "Developer ID Application: Example",
    "/repo/dist/Git Leaf.app",
  ]);
});

test("mac release DMG signing does not use app entitlements", () => {
  const args = codesignArgs("/repo/dist/Git Leaf.dmg", "Developer ID Application: Example", {
    hardenedRuntime: false,
    entitlementsPath: "/repo/assets/entitlements.mac.plist",
  });

  assert.deepEqual(args, [
    "--force",
    "--timestamp",
    "--sign",
    "Developer ID Application: Example",
    "/repo/dist/Git Leaf.dmg",
  ]);
});

test("mac DMG layout stages the app and Finder background", () => {
  const paths = macReleasePaths({
    rootDir: "/repo",
    appName: "Git Leaf",
    version: "1.2.3",
  });
  const layout = macDmgLayoutPaths(paths, { appName: "Git Leaf" });

  assert.equal(slashPath(layout.stageDir), "/repo/dist/Git Leaf-dmg-stage");
  assert.equal(slashPath(layout.stagedAppPath), "/repo/dist/Git Leaf-dmg-stage/Git Leaf.app");
  assert.equal(slashPath(layout.backgroundPngPath), "/repo/dist/Git Leaf-dmg-stage/.background/background.png");
  assert.equal(slashPath(layout.readWriteDmgPath), "/repo/dist/Git Leaf-dmg.rw.dmg");
});

test("mac DMG uses a unique staging volume name", () => {
  assert.equal(
    dmgStagingVolumeName({ appName: "Git Leaf", processId: 4242 }),
    "Git Leaf Installer 4242",
  );
});

test("mac DMG locale detection maps Chinese and English locale values", () => {
  assert.equal(dmgLocaleFromValue("zh-Hans_US"), "zh-Hans");
  assert.equal(dmgLocaleFromValue("zh_CN.UTF-8"), "zh-Hans");
  assert.equal(dmgLocaleFromValue("en_US.UTF-8"), "en");
});

test("mac DMG text is localized for Chinese builds", () => {
  assert.deepEqual(dmgTextForLocale({ appName: "Git Leaf", locale: "zh-Hans_US" }), {
    title: "安装 Git Leaf",
    instruction: "将 Git Leaf.app 拖到“应用程序”",
    applicationsLabel: "应用程序",
  });
});

test("mac DMG background gives users the drag-to-Applications instruction", () => {
  const svg = dmgBackgroundSvg({ appName: "Git Leaf" });

  assert.match(svg, /Install Git Leaf/);
  assert.match(svg, /Drag Git Leaf\.app to Applications/);
  assert.match(svg, /<path d="M336 176 L318 164 L318 188 Z"/);
});

test("mac DMG background uses Chinese copy for Chinese builds", () => {
  const svg = dmgBackgroundSvg({ appName: "Git Leaf", locale: "zh-Hans_US" });

  assert.match(svg, /安装 Git Leaf/);
  assert.match(svg, /将 Git Leaf\.app 拖到“应用程序”/);
});

test("mac DMG Finder layout positions app and Applications icons", () => {
  const script = dmgFinderLayoutScript({
    appName: "Git Leaf",
    mountPoint: "/repo/dist/Git Leaf-dmg-mount",
    backgroundPngPath: "/Volumes/Git Leaf/.background/background.png",
  }).join("\n");

  assert.match(script, /set applicationsFolder to folder "Applications" of startup disk/);
  assert.match(
    script,
    /set targetFolder to POSIX file "\/repo\/dist\/Git Leaf-dmg-mount" as alias/,
  );
  assert.match(script, /set targetWindow to container window of targetFolder/);
  assert.doesNotMatch(script, /tell disk/);
  assert.match(
    script,
    /make new alias file at targetFolder to applicationsFolder with properties \{name:"Applications"\}/,
  );
  assert.match(
    script,
    /set background picture of viewOptions to \(POSIX file "\/Volumes\/Git Leaf\/\.background\/background\.png" as alias\)/,
  );
  assert.match(script, /repeat with attempt from 1 to 20/);
  assert.match(
    script,
    /if \(exists item "Git Leaf\.app" of targetFolder\) and \(exists item "Applications" of targetFolder\) then exit repeat/,
  );
  assert.match(script, /delay 0\.25/);
  assert.match(script, /set position of item "Git Leaf\.app" of targetFolder to \{150, 190\}/);
  assert.match(script, /set position of item "Applications" of targetFolder to \{410, 190\}/);
  assert.match(script, /set icon size of viewOptions to 96/);
});

test("mac DMG Finder layout uses the localized Applications item name", () => {
  const script = dmgFinderLayoutScript({
    appName: "Git Leaf",
    locale: "zh-Hans_US",
    mountPoint: "/repo/dist/Git Leaf-dmg-mount",
  }).join("\n");

  assert.match(script, /set position of item "Applications" of targetFolder to \{410, 190\}/);
});

test("electron cache zip dir locates the matching cached Electron zip", () => {
  assert.equal(
    slashPath(electronCacheZipDir({
      homeDir: "/Users/example",
      version: "43.0.0",
      platform: "darwin",
      arch: "arm64",
      exists: (filePath) =>
        slashPath(filePath) ===
        "/Users/example/Library/Caches/electron/cache-id/electron-v43.0.0-darwin-arm64.zip",
      listDir: (dirPath) => {
        assert.equal(slashPath(dirPath), "/Users/example/Library/Caches/electron");
        return ["cache-id"];
      },
    })),
    "/Users/example/Library/Caches/electron/cache-id",
  );
});

test("release runs the full distribution sequence", () => {
  assert.deepEqual(releaseSteps, [
    "check-version",
    "check-prereqs",
    "test",
    "package",
    "sign",
    "dmg",
    "notarize",
    "staple",
    "zip",
    "verify",
    "tag",
  ]);
});

test("mac formal distribution commands require an unpublished version", () => {
  for (const command of [
    "sign",
    "dmg",
    "notarize",
    "staple",
    "zip",
    "stage-updates",
    "publish-updates",
  ]) {
    assert.equal(macCommandRequiresNewReleaseVersion(command), true, command);
  }

  for (const command of [
    "check-version",
    "check-prereqs",
    "test",
    "package",
    "verify",
    "tag",
    "dev-install",
    "dev-smoke",
    "help",
  ]) {
    assert.equal(macCommandRequiresNewReleaseVersion(command), false, command);
  }

  assert.equal(macCommandRequiresNewReleaseVersion("sign", { dev: true }), false);
});

test("dev install updates the local Applications app and launches it", () => {
  assert.deepEqual(devInstallSteps, [
    "package",
    "quit-dev-app",
    "prepare-dev-user-data",
    "install-dev-app",
    "cleanup-dev-package",
    "refresh-dev-app-icon",
    "launch-dev-app",
    "verify-production-profile",
  ]);
  assert.deepEqual(devSmokeSteps, [
    "validate-smoke-user-data",
    "package",
    "quit-dev-app",
    "prepare-dev-user-data",
    "install-dev-app",
    "cleanup-dev-package",
    "refresh-dev-app-icon",
    "launch-dev-app-and-wait",
    "verify-production-profile",
    "cleanup-smoke-user-data",
  ]);

  const paths = macDevelopmentInstallPaths({
    rootDir: "/repo",
    appName: "Git Leaf",
    applicationsDir: "/Applications",
  });

  assert.equal(slashPath(paths.appDir), "/repo/dist/Git Leaf-darwin-universal/Git Leaf.app");
  assert.equal(slashPath(paths.installedAppDir), "/Applications/Git Leaf.app");
});

test("manual dev install and Agent smoke use separate isolated profile paths", () => {
  assert.deepEqual(macDevelopmentUserDataPaths({ homeDir: "/Users/test" }), {
    productionUserDataDir: "/Users/test/Library/Application Support/git-leaf",
    devUserDataDir: "/Users/test/Library/Application Support/git-leaf-dev",
  });
  assert.deepEqual(macDevelopmentUserDataPaths({
    homeDir: "/Users/test",
    devUserDataDir: "/tmp/git-leaf-agent-smoke",
  }), {
    productionUserDataDir: "/Users/test/Library/Application Support/git-leaf",
    devUserDataDir: "/tmp/git-leaf-agent-smoke",
  });
});

test("development profile snapshot copies durable state and detects production mutation", async () => {
  const homeDir = await mkdtempPath("git-leaf-mac-dev-profile-");
  const paths = macDevelopmentUserDataPaths({ homeDir });
  await mkdir(path.join(paths.productionUserDataDir, "Local Storage", "leveldb"), { recursive: true });
  await mkdir(path.join(paths.productionUserDataDir, "Session Storage"), { recursive: true });
  await writeFile(
    path.join(paths.productionUserDataDir, "desktop-config.json"),
    JSON.stringify({ openRepoRoots: ["/repo/company-docs"], preferences: { colorMode: "dark" } }),
  );
  await writeFile(
    path.join(paths.productionUserDataDir, "desktop-config.backup.json"),
    JSON.stringify({ openRepoRoots: ["/repo/company-docs"] }),
  );
  await writeFile(
    path.join(paths.productionUserDataDir, "Local Storage", "leveldb", "000001.log"),
    "theme=dark",
  );
  await writeFile(
    path.join(paths.productionUserDataDir, "Session Storage", "000001.log"),
    "active-document=README.md",
  );
  await writeFile(path.join(paths.productionUserDataDir, "telemetry-queue.json"), "not copied");

  const before = developmentProfileFingerprint(paths);
  const snapshot = prepareDevelopmentUserData(paths);
  assert.deepEqual(snapshot.copiedEntries, [
    "desktop-config.json",
    "desktop-config.backup.json",
    "Local Storage",
    "Session Storage",
  ]);
  assert.equal(snapshot.sourceFingerprint.sha256, before.sha256);
  assert.equal(
    await readFile(path.join(paths.devUserDataDir, "desktop-config.json"), "utf8"),
    await readFile(path.join(paths.productionUserDataDir, "desktop-config.json"), "utf8"),
  );
  assert.equal(
    await readFile(path.join(paths.devUserDataDir, "desktop-config.backup.json"), "utf8"),
    await readFile(path.join(paths.productionUserDataDir, "desktop-config.backup.json"), "utf8"),
  );
  assert.equal(
    await readFile(path.join(paths.devUserDataDir, "Local Storage", "leveldb", "000001.log"), "utf8"),
    "theme=dark",
  );
  await assert.rejects(
    readFile(path.join(paths.devUserDataDir, "telemetry-queue.json"), "utf8"),
    /ENOENT/,
  );
  const verification = verifyProductionProfileUnchanged(paths);
  assert.deepEqual(verification.productionFingerprint, before);
  assert.deepEqual(verification.sourceFingerprint, before);

  await writeFile(path.join(paths.productionUserDataDir, "desktop-config.json"), "changed");
  assert.throws(
    () => verifyProductionProfileUnchanged(paths),
    /Production profile changed during development smoke/,
  );
});

test("manual dev install preserves the familiar state already chosen in the development profile", async () => {
  const homeDir = await mkdtempPath("git-leaf-mac-familiar-dev-profile-");
  const paths = macDevelopmentUserDataPaths({ homeDir });
  const productionConfig = {
    repoRoot: "/repo/company-docs",
    openRepoRoots: ["/repo/company-docs"],
    preferences: {
      colorMode: "light",
      documentFontSize: 16,
      sidebarCollapsed: false,
    },
  };
  const familiarDevelopmentConfig = {
    repoRoot: "/repo/git-leaf",
    openRepoRoots: ["/repo/company-docs", "/repo/git-leaf", "/repo/content-repo"],
    preferences: {
      colorMode: "system",
      documentFontSize: 18,
      sidebarCollapsed: true,
      workbenchSessions: {
        "known-repo": {
          tabs: [{ path: "AGENTS.md" }],
          activeTabPath: "AGENTS.md",
        },
      },
    },
  };
  await mkdir(paths.productionUserDataDir, { recursive: true });
  await writeFile(
    path.join(paths.productionUserDataDir, "desktop-config.json"),
    `${JSON.stringify(productionConfig, null, 2)}\n`,
  );

  prepareDevelopmentUserData(paths, { profileMode: "manual" });
  await writeFile(
    path.join(paths.devUserDataDir, "desktop-config.json"),
    `${JSON.stringify(familiarDevelopmentConfig, null, 2)}\n`,
  );
  await writeFile(path.join(paths.devUserDataDir, "familiar-dev-state"), "must survive reinstall");

  const result = ensureManualDevelopmentUserData(paths);

  assert.equal(result.reused, true);
  assert.equal(
    await readFile(path.join(paths.devUserDataDir, "desktop-config.json"), "utf8"),
    `${JSON.stringify(familiarDevelopmentConfig, null, 2)}\n`,
  );
  assert.equal(
    await readFile(path.join(paths.devUserDataDir, "familiar-dev-state"), "utf8"),
    "must survive reinstall",
  );
  assert.equal(
    await readFile(path.join(paths.productionUserDataDir, "desktop-config.json"), "utf8"),
    `${JSON.stringify(productionConfig, null, 2)}\n`,
  );
});

test("manual dev install initializes from production only when no development profile exists", async () => {
  const homeDir = await mkdtempPath("git-leaf-mac-first-manual-profile-");
  const paths = macDevelopmentUserDataPaths({ homeDir });
  const productionConfig = {
    openRepoRoots: ["/repo/company-docs", "/repo/git-leaf"],
    preferences: { colorMode: "system", documentFontSize: 18 },
  };
  await mkdir(paths.productionUserDataDir, { recursive: true });
  await writeFile(
    path.join(paths.productionUserDataDir, "desktop-config.json"),
    `${JSON.stringify(productionConfig, null, 2)}\n`,
  );

  const result = ensureManualDevelopmentUserData(paths);

  assert.equal(result.reused, false);
  assert.equal(
    await readFile(path.join(paths.devUserDataDir, "desktop-config.json"), "utf8"),
    `${JSON.stringify(productionConfig, null, 2)}\n`,
  );
});

test("manual dev install upgrades a legacy profile marker without replacing familiar settings", async () => {
  const homeDir = await mkdtempPath("git-leaf-mac-legacy-manual-profile-");
  const paths = macDevelopmentUserDataPaths({ homeDir });
  const productionConfig = {
    openRepoRoots: ["/repo/company-docs"],
    preferences: { colorMode: "light" },
  };
  const familiarDevelopmentConfig = {
    openRepoRoots: ["/repo/company-docs", "/repo/git-leaf", "/repo/content-repo"],
    preferences: { colorMode: "system" },
  };
  await mkdir(paths.productionUserDataDir, { recursive: true });
  await mkdir(paths.devUserDataDir, { recursive: true });
  await writeFile(
    path.join(paths.productionUserDataDir, "desktop-config.json"),
    `${JSON.stringify(productionConfig, null, 2)}\n`,
  );
  await writeFile(
    path.join(paths.devUserDataDir, "desktop-config.json"),
    `${JSON.stringify(familiarDevelopmentConfig, null, 2)}\n`,
  );
  const productionFingerprint = developmentProfileFingerprint(paths);
  await writeFile(
    path.join(paths.devUserDataDir, ".git-leaf-dev-smoke-profile.json"),
    `${JSON.stringify({
      kind: "git-leaf-development-profile",
      schemaVersion: 1,
      profileMode: "manual",
      sourceUserDataDir: paths.productionUserDataDir,
      devUserDataDir: paths.devUserDataDir,
      sourcePhysicalUserDataDir: await realpath(paths.productionUserDataDir),
      devPhysicalUserDataDir: await realpath(paths.devUserDataDir),
      sourceFingerprint: productionFingerprint,
      copiedFingerprint: productionFingerprint,
      copiedEntries: ["desktop-config.json"],
    }, null, 2)}\n`,
  );

  const result = ensureManualDevelopmentUserData(paths);
  const upgradedMarker = JSON.parse(await readFile(
    path.join(paths.devUserDataDir, ".git-leaf-dev-smoke-profile.json"),
    "utf8",
  ));

  assert.equal(result.reused, true);
  assert.equal(upgradedMarker.schemaVersion, 2);
  assert.equal(
    await readFile(path.join(paths.devUserDataDir, "desktop-config.json"), "utf8"),
    `${JSON.stringify(familiarDevelopmentConfig, null, 2)}\n`,
  );
});

test("development smoke clones the familiar manual profile instead of stale production settings", async () => {
  const homeDir = await mkdtempPath("git-leaf-mac-familiar-smoke-profile-");
  const stablePaths = macDevelopmentUserDataPaths({ homeDir });
  const smokePaths = macDevelopmentUserDataPaths({
    homeDir,
    devUserDataDir: path.join(homeDir, "smoke-profile"),
  });
  const productionConfig = {
    openRepoRoots: ["/repo/company-docs"],
    preferences: { colorMode: "light" },
  };
  const familiarDevelopmentConfig = {
    openRepoRoots: ["/repo/company-docs", "/repo/git-leaf", "/repo/content-repo"],
    preferences: {
      colorMode: "system",
      workbenchSessions: {
        "known-repo": {
          tabs: [{ path: "AGENTS.md" }],
          activeTabPath: "AGENTS.md",
        },
      },
    },
  };
  await mkdir(stablePaths.productionUserDataDir, { recursive: true });
  await writeFile(
    path.join(stablePaths.productionUserDataDir, "desktop-config.json"),
    `${JSON.stringify(productionConfig, null, 2)}\n`,
  );
  prepareDevelopmentUserData(stablePaths, { profileMode: "manual" });
  await writeFile(
    path.join(stablePaths.devUserDataDir, "desktop-config.json"),
    `${JSON.stringify(familiarDevelopmentConfig, null, 2)}\n`,
  );

  const sourceUserDataDir = selectDevelopmentSmokeSource({
    productionUserDataDir: stablePaths.productionUserDataDir,
    manualDevUserDataDir: stablePaths.devUserDataDir,
  });
  const productionBefore = developmentProfileFingerprint(stablePaths);
  const manualBefore = developmentProfileFingerprint({
    productionUserDataDir: stablePaths.devUserDataDir,
  });
  prepareDevelopmentUserData(smokePaths, {
    profileMode: "smoke",
    sourceUserDataDir,
  });

  assert.equal(sourceUserDataDir, stablePaths.devUserDataDir);
  assert.equal(
    await readFile(path.join(smokePaths.devUserDataDir, "desktop-config.json"), "utf8"),
    `${JSON.stringify(familiarDevelopmentConfig, null, 2)}\n`,
  );
  assert.deepEqual(developmentProfileFingerprint(stablePaths), productionBefore);
  assert.deepEqual(
    developmentProfileFingerprint({ productionUserDataDir: stablePaths.devUserDataDir }),
    manualBefore,
  );
  const verification = verifyProductionProfileUnchanged(smokePaths);
  assert.deepEqual(verification.productionFingerprint, productionBefore);
  assert.deepEqual(verification.sourceFingerprint, manualBefore);

  await writeFile(
    path.join(stablePaths.devUserDataDir, "desktop-config.json"),
    `${JSON.stringify({ ...familiarDevelopmentConfig, changedDuringSmoke: true }, null, 2)}\n`,
  );
  assert.throws(
    () => verifyProductionProfileUnchanged(smokePaths),
    /snapshot source changed during smoke/i,
  );
});

test("development smoke falls back to production only before a manual profile exists", async () => {
  const homeDir = await mkdtempPath("git-leaf-mac-first-smoke-profile-");
  const paths = macDevelopmentUserDataPaths({ homeDir });
  await mkdir(paths.productionUserDataDir, { recursive: true });

  assert.equal(selectDevelopmentSmokeSource({
    productionUserDataDir: paths.productionUserDataDir,
    manualDevUserDataDir: paths.devUserDataDir,
  }), paths.productionUserDataDir);
});

test("development smoke fails closed when an existing manual profile is not a valid snapshot", async () => {
  const homeDir = await mkdtempPath("git-leaf-mac-invalid-manual-profile-");
  const paths = macDevelopmentUserDataPaths({ homeDir });
  await mkdir(paths.productionUserDataDir, { recursive: true });
  await mkdir(paths.devUserDataDir, { recursive: true });
  await writeFile(path.join(paths.devUserDataDir, "desktop-config.json"), "{}");

  assert.throws(() => selectDevelopmentSmokeSource({
    productionUserDataDir: paths.productionUserDataDir,
    manualDevUserDataDir: paths.devUserDataDir,
  }), /development profile marker/i);
});

test("development profile isolation rejects symlink aliases into production", {
  skip: process.platform === "win32" && "directory symlinks require elevated Windows privileges",
}, async () => {
  const rootDir = await mkdtempPath("git-leaf-mac-dev-symlink-");
  const productionUserDataDir = path.join(rootDir, "production");
  const productionAlias = path.join(rootDir, "production-alias");
  const devTarget = path.join(rootDir, "dev-target");
  const devSymlink = path.join(rootDir, "dev-link");
  await mkdir(productionUserDataDir);
  await mkdir(devTarget);
  const { symlink } = await import("node:fs/promises");
  await symlink(productionUserDataDir, productionAlias, "dir");
  await symlink(devTarget, devSymlink, "dir");

  assert.throws(
    () => assertDevelopmentUserDataIsolation({
      productionUserDataDir,
      devUserDataDir: path.join(productionAlias, "smoke"),
    }),
    /must be isolated/,
  );
  assert.throws(
    () => assertDevelopmentUserDataIsolation({ productionUserDataDir, devUserDataDir: devSymlink }),
    /symbolic-link user-data path/,
  );
});

test("development smoke path must be a logical and physical child of tmp before packaging", {
  skip: process.platform === "win32" && "directory symlinks require elevated Windows privileges",
}, async () => {
  const temporaryRoot = await mkdtempPath("git-leaf-mac-smoke-preflight-");
  const outsideRoot = await mkdtempPath("git-leaf-mac-smoke-outside-");
  const productionUserDataDir = path.join(outsideRoot, "production");
  const escapeAlias = path.join(temporaryRoot, "escape");
  await mkdir(productionUserDataDir);
  const { symlink } = await import("node:fs/promises");
  await symlink(outsideRoot, escapeAlias, "dir");

  assert.doesNotThrow(() => assertDevelopmentSmokeUserDataPath({
    productionUserDataDir,
    devUserDataDir: path.join(temporaryRoot, "smoke-profile"),
  }, { temporaryRoot }));
  assert.throws(
    () => assertDevelopmentSmokeUserDataPath({
      productionUserDataDir,
      devUserDataDir: path.join(escapeAlias, "smoke-profile"),
    }, { temporaryRoot }),
    /strict child of the temporary directory/,
  );
  assert.throws(
    () => assertDevelopmentSmokeUserDataPath({
      productionUserDataDir,
      devUserDataDir: temporaryRoot,
    }, { temporaryRoot }),
    /strict child of the temporary directory/,
  );
});

test("development profile staging failure preserves the previous dev snapshot", async () => {
  const rootDir = await mkdtempPath("git-leaf-mac-dev-swap-");
  const paths = {
    productionUserDataDir: path.join(rootDir, "production"),
    devUserDataDir: path.join(rootDir, "development"),
  };
  await mkdir(paths.productionUserDataDir);
  await mkdir(paths.devUserDataDir);
  await writeFile(path.join(paths.productionUserDataDir, "desktop-config.json"), "new snapshot");
  await writeFile(path.join(paths.devUserDataDir, "old-snapshot.txt"), "keep me");

  let renameCount = 0;
  assert.throws(
    () => prepareDevelopmentUserData(paths, {
      rename: (sourcePath, destinationPath) => {
        renameCount += 1;
        if (renameCount === 2) {
          throw new Error("injected staging rename failure");
        }
        renameSync(sourcePath, destinationPath);
      },
    }),
    /injected staging rename failure/,
  );
  assert.equal(await readFile(path.join(paths.devUserDataDir, "old-snapshot.txt"), "utf8"), "keep me");
  assert.deepEqual(
    (await readdir(rootDir)).filter((entry) => entry.includes(".staging-") || entry.includes(".previous-")),
    [],
  );
});

test("one-time smoke cleanup requires a matching marker under the temporary root", async () => {
  const temporaryRoot = await mkdtempPath("git-leaf-mac-smoke-cleanup-");
  const paths = {
    productionUserDataDir: path.join(temporaryRoot, "production"),
    devUserDataDir: path.join(temporaryRoot, "smoke-profile"),
  };
  await mkdir(paths.productionUserDataDir);
  await writeFile(path.join(paths.productionUserDataDir, "desktop-config.json"), "snapshot");
  prepareDevelopmentUserData(paths, { profileMode: "smoke" });

  const verifiedProductionFingerprint = verifyProductionProfileUnchanged(paths);
  assert.equal(cleanupDevelopmentSmokeUserData(paths, {
    temporaryRoot,
    verifiedProductionFingerprint,
  }).cleaned, true);
  await assert.rejects(stat(paths.devUserDataDir), /ENOENT/);

  await mkdir(paths.devUserDataDir);
  await writeFile(path.join(paths.devUserDataDir, "keep.txt"), "no marker");
  assert.throws(
    () => cleanupDevelopmentSmokeUserData(paths, { temporaryRoot }),
    /Missing development profile marker/,
  );
  assert.equal(await readFile(path.join(paths.devUserDataDir, "keep.txt"), "utf8"), "no marker");
});

test("smoke cleanup verifies both production and the familiar manual source", async () => {
  const temporaryRoot = await mkdtempPath("git-leaf-mac-dual-source-cleanup-");
  const productionUserDataDir = path.join(temporaryRoot, "production");
  const manualDevUserDataDir = path.join(temporaryRoot, "manual-development");
  const manualPaths = {
    productionUserDataDir,
    devUserDataDir: manualDevUserDataDir,
  };
  await mkdir(productionUserDataDir);
  await writeFile(
    path.join(productionUserDataDir, "desktop-config.json"),
    JSON.stringify({ preferences: { colorMode: "light" } }),
  );
  prepareDevelopmentUserData(manualPaths, { profileMode: "manual" });
  await writeFile(
    path.join(manualDevUserDataDir, "desktop-config.json"),
    JSON.stringify({ preferences: { colorMode: "system" } }),
  );

  const firstSmokePaths = {
    productionUserDataDir,
    devUserDataDir: path.join(temporaryRoot, "smoke-success"),
  };
  prepareDevelopmentUserData(firstSmokePaths, {
    profileMode: "smoke",
    sourceUserDataDir: manualDevUserDataDir,
  });
  const firstVerification = verifyProductionProfileUnchanged(firstSmokePaths);
  assert.equal(cleanupDevelopmentSmokeUserData(firstSmokePaths, {
    temporaryRoot,
    verifiedProductionFingerprint: firstVerification,
  }).cleaned, true);
  await assert.rejects(stat(firstSmokePaths.devUserDataDir), /ENOENT/);

  const secondSmokePaths = {
    productionUserDataDir,
    devUserDataDir: path.join(temporaryRoot, "smoke-preserved"),
  };
  prepareDevelopmentUserData(secondSmokePaths, {
    profileMode: "smoke",
    sourceUserDataDir: manualDevUserDataDir,
  });
  const secondVerification = verifyProductionProfileUnchanged(secondSmokePaths);
  await writeFile(
    path.join(manualDevUserDataDir, "desktop-config.json"),
    JSON.stringify({ preferences: { colorMode: "dark" } }),
  );

  assert.throws(
    () => cleanupDevelopmentSmokeUserData(secondSmokePaths, {
      temporaryRoot,
      verifiedProductionFingerprint: secondVerification,
    }),
    /snapshot source changed after verification/i,
  );
  assert.equal((await stat(secondSmokePaths.devUserDataDir)).isDirectory(), true);
});

test("development smoke verifies before cleanup even when an earlier step fails", () => {
  const calls = [];
  assert.throws(
    () => runDevelopmentSmokeWorkflow({
      runStep: (step) => {
        calls.push(step);
        if (step === "launch-dev-app-and-wait") {
          throw new Error("injected launch failure");
        }
        if (step === "verify-production-profile") {
          return { sha256: "verified" };
        }
      },
    }),
    /injected launch failure/,
  );
  assert.deepEqual(calls, devSmokeSteps);
  assert.ok(
    calls.indexOf("verify-production-profile") < calls.indexOf("cleanup-smoke-user-data"),
  );
});

test("development smoke preflight stops before package", () => {
  const calls = [];
  assert.throws(
    () => runDevelopmentSmokeWorkflow({
      runStep: (step) => {
        calls.push(step);
        throw new Error("unsafe smoke path");
      },
    }),
    /unsafe smoke path/,
  );
  assert.deepEqual(calls, ["validate-smoke-user-data"]);
});

test("development smoke preserves its profile when production verification fails", () => {
  const calls = [];
  const verificationFailures = [];
  assert.throws(
    () => runDevelopmentSmokeWorkflow({
      runStep: (step) => {
        calls.push(step);
        if (step === "verify-production-profile") {
          throw new Error("production fingerprint changed");
        }
      },
      onVerificationFailure: (error) => verificationFailures.push(error.message),
    }),
    /production fingerprint changed/,
  );
  assert.deepEqual(calls, devSmokeSteps.slice(0, -1));
  assert.deepEqual(verificationFailures, ["production fingerprint changed"]);
  assert.equal(calls.includes("cleanup-smoke-user-data"), false);
});

test("dev install quits stale dist app and launches the installed Applications app", () => {
  const paths = macDevelopmentInstallPaths({
    rootDir: "/repo",
    appName: "Git Leaf",
    applicationsDir: "/Applications",
  });

  assert.deepEqual(developmentAppQuitCommands("Git Leaf", paths), [
    ["osascript", ["-e", "tell application \"Git Leaf\" to quit"]],
    ["pkill", ["-x", "Git Leaf"]],
    ["pkill", ["-f", "/Applications/Git Leaf.app"]],
    ["pkill", ["-f", "/repo/dist/Git Leaf-darwin-universal/Git Leaf.app"]],
  ]);
  assert.deepEqual(developmentAppForceQuitCommands("Git Leaf", paths), [
    ["pkill", ["-9", "-x", "Git Leaf"]],
    ["pkill", ["-9", "-f", "/Applications/Git Leaf.app"]],
    ["pkill", ["-9", "-f", "/repo/dist/Git Leaf-darwin-universal/Git Leaf.app"]],
  ]);
  assert.deepEqual(developmentAppProcessQueries("Git Leaf", paths), [
    ["-x", "Git Leaf"],
    ["-f", "/Applications/Git Leaf.app"],
    ["-f", "/repo/dist/Git Leaf-darwin-universal/Git Leaf.app"],
  ]);
  assert.deepEqual(launchDevelopmentAppCommand(paths, {
    userDataDir: "/tmp/git-leaf-dev-smoke",
  }), [
    "open",
    [
      "-n",
      "/Applications/Git Leaf.app",
      "--args",
      "--git-leaf-dev-user-data-dir=/tmp/git-leaf-dev-smoke",
    ],
  ]);
  assert.deepEqual(launchDevelopmentAppCommand(paths, {
    userDataDir: "/tmp/git-leaf-agent-smoke",
    wait: true,
  }), [
    "open",
    [
      "-W",
      "-n",
      "/Applications/Git Leaf.app",
      "--args",
      "--git-leaf-dev-user-data-dir=/tmp/git-leaf-agent-smoke",
    ],
  ]);
  assert.deepEqual(launchDevelopmentAppCommand(paths, {
    userDataDir: "/tmp/git-leaf-agent-smoke",
    wait: true,
    repoRoot: "/tmp/git-leaf-tree-tooltip-smoke-123",
    file: "research/projects/long-document-name.md",
  }), [
    "open",
    [
      "-W",
      "-n",
      "/Applications/Git Leaf.app",
      "--args",
      "--git-leaf-dev-user-data-dir=/tmp/git-leaf-agent-smoke",
      "--repo=/tmp/git-leaf-tree-tooltip-smoke-123",
      "--file=research/projects/long-document-name.md",
    ],
  ]);
  assert.throws(
    () => launchDevelopmentAppCommand(paths, {
      userDataDir: "/tmp/git-leaf-agent-smoke",
      repoRoot: "relative/repo",
    }),
    /absolute path/,
  );
  assert.throws(
    () => launchDevelopmentAppCommand(paths, {
      userDataDir: "/tmp/git-leaf-agent-smoke",
      repoRoot: "/tmp/repo",
      file: "../outside.md",
    }),
    /safe repository-relative path/,
  );
});

test("dev install removes the temporary packaged app after copying into Applications", () => {
  const paths = macDevelopmentInstallPaths({
    rootDir: "/repo",
    appName: "Git Leaf",
    applicationsDir: "/Applications",
  });

  assert.deepEqual(
    developmentPackageCleanupPlan(paths, {
      lsregisterPath: "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
      lsregisterExists: () => true,
    }),
    {
      unregisterCommand: [
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
        ["-u", "/repo/dist/Git Leaf-darwin-universal/Git Leaf.app"],
      ],
      removeDir: "/repo/dist/Git Leaf-darwin-universal",
    },
  );
});

test("dev install marks the same app identity as a development build", () => {
  const options = macDevelopmentInstallOptions({
    appName: "Git Leaf",
    bundleId: "com.mangofuture.gitleaf",
  });

  assert.deepEqual(options, {
    appName: "Git Leaf",
    bundleId: "com.mangofuture.gitleaf",
    dev: true,
  });
  assert.equal(
    macDevelopmentInstallPaths({
      rootDir: "/repo",
      applicationsDir: "/Applications",
      ...options,
    }).installedAppDir,
    "/Applications/Git Leaf.app",
  );
});

test("default release options use the Mango Future Developer ID profile", () => {
  assert.equal(
    DEFAULT_RELEASE_OPTIONS.identity,
    "Developer ID Application: Shenzhen Mango Future Technology Co., Ltd. (HN6X79BUSR)",
  );
  assert.equal(DEFAULT_RELEASE_OPTIONS.notaryProfile, "");
  assert.equal(DEFAULT_RELEASE_OPTIONS.iconPath, "assets/icons/git-leaf");
  assert.equal(DEFAULT_RELEASE_OPTIONS.entitlementsPath, "assets/entitlements.mac.plist");
  assert.equal(DEFAULT_RELEASE_OPTIONS.arch, "universal");
});

test("mac release version follows package.json", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(DEFAULT_RELEASE_OPTIONS.version, packageJson.version);
});

test("npm mac package script uses the release packager wrapper", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(packageJson.scripts["package:mac"], "node scripts/release-mac.mjs package");
  assert.equal(packageJson.scripts["release:mac"], "node scripts/release-mac.mjs release");
  assert.equal(
    packageJson.scripts["publish:updates:mac"],
    "node scripts/release-mac.mjs publish-updates",
  );
  assert.equal(
    packageJson.scripts["install:mac:dev"],
    "node scripts/release-mac.mjs dev-install",
  );
  assert.equal(packageJson.scripts["test:ci:mac"], "node scripts/test-suite.mjs ci:mac");
});

test("Makefile exposes the local dev install app target", async () => {
  const makefile = await readFile("Makefile", "utf8");

  assert.match(makefile, /^install-dev-mac:/m);
  assert.match(makefile, /^\tnpm run install:mac:dev$/m);
  assert.match(makefile, /^smoke-dev-mac:/m);
  assert.match(makefile, /^\tnode scripts\/release-mac\.mjs dev-smoke$/m);
  assert.match(makefile, /^smoke-tree-tooltip-mac:/m);
  assert.match(makefile, /^\tnode scripts\/smoke-tree-tooltip-mac\.mjs$/m);
  assert.match(makefile, /^publish-updates-mac:/m);
  assert.match(makefile, /^GIT_LEAF_RELEASE_PROFILE \?=$/m);
  assert.doesNotMatch(makefile, /^(?:UPDATE_REMOTE_HOST|UPDATE_REMOTE_ROOT|NOTARY_PROFILE) \?=/m);
});

function slashPath(value) {
  return value.replace(/\\/g, "/").replace(/^[A-Za-z]:(?=\/)/, "");
}

async function mkdtempPath(prefix) {
  return mkdtemp(path.join(tmpdir(), prefix));
}
