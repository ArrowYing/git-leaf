import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_ELECTRON_MIRROR,
  DEFAULT_WINDOWS_RELEASE_OPTIONS,
  runWindowsReleaseCommand,
  stageWindowsUpdateMetadata,
  windowsCommandRequiresNewReleaseVersion,
  windowsUpdateMetadataPaths,
  windowsElectronPackagerArgs,
  windowsPortableSteps,
  windowsReleasePaths,
  windowsReleaseSteps,
  windowsZipCommand,
} from "../scripts/release-windows.mjs";

test("windows release package args include x64 target metadata", () => {
  const args = windowsElectronPackagerArgs({
    appName: "OpenPeek",
    version: "1.9.1",
    companyName: "Mango Future",
    productName: "OpenPeek",
    outDir: "dist",
  });

  assert.ok(args.includes("--platform=win32"));
  assert.ok(args.includes("--arch=x64"));
  assert.ok(args.includes("--app-version=1.9.1"));
  assert.ok(args.includes("--protocol=openpeek"));
  assert.ok(args.includes("--protocol-name=OpenPeek Document"));
  assert.ok(args.includes("--win32metadata.CompanyName=Mango Future"));
  assert.ok(args.includes("--win32metadata.ProductName=OpenPeek"));
  assert.ok(args.includes("--win32metadata.OriginalFilename=OpenPeek.exe"));
  assert.equal(
    args.some((arg) => arg.includes("requested-execution-level")),
    false,
    "the Electron default asInvoker manifest should not be rewritten",
  );
  assert.ok(args.includes("--ignore=^/test($|/)"));
  assert.ok(args.includes("--ignore=^/dist($|/)"));
});

test("windows release package args exclude internal docs, repository tools, and dev-only dependencies", () => {
  const args = windowsElectronPackagerArgs({
    appName: "OpenPeek",
    companyName: "Mango Future",
    productName: "OpenPeek",
    outDir: "dist",
  });
  const ignorePatterns = args
    .filter((arg) => arg.startsWith("--ignore="))
    .map((arg) => new RegExp(arg.slice("--ignore=".length)));
  const isIgnored = (filePath) => ignorePatterns.some((pattern) => pattern.test(filePath));

  for (const filePath of [
    "/scripts/release-windows.mjs",
    "/tools/generate-openpeek-open-link.mjs",
    "/Makefile",
    "/AGENTS.md",
    "/CLAUDE.md",
    "/CHANGELOG.md",
    "/CONTRIBUTING.md",
    "/README.zh-CN.md",
    "/SECURITY.md",
    "/docs/architecture.md",
    "/docs/release.md",
    "/docs/mdx-lite-guide.md",
    "/docs/windows-portable-guide.md",
    "/docs/app-usage-analytics-spec.md",
    "/.superpowers/brainstorm/demo/content/index.html",
    "/.gitignore",
    "/.gitleaks.toml",
    "/.github/workflows/windows-release-smoke.yml",
    "/.agents/skills/openpeek-release/SKILL.md",
    "/node_modules/@electron/get/package.json",
    "/node_modules/@esbuild/win32-x64/esbuild.exe",
    "/node_modules/@types/node/index.d.ts",
    "/node_modules/mermaid/package.json",
    "/node_modules/@lezer/css/test/test-css.js",
    "/node_modules/@lezer/markdown/test-markdown.js",
  ]) {
    assert.equal(isIgnored(filePath), true, `${filePath} should not be copied into app.asar`);
  }
});

test("windows release paths point to the packaged executable", () => {
  const paths = windowsReleasePaths({
    rootDir: "/repo",
    appName: "OpenPeek",
    version: "0.1.1",
  });

  assert.equal(slashPath(paths.appRoot), "/repo/dist/OpenPeek-win32-x64");
  assert.equal(slashPath(paths.exePath), "/repo/dist/OpenPeek-win32-x64/OpenPeek.exe");
  assert.equal(slashPath(paths.legacyExePath), "/repo/dist/OpenPeek-win32-x64/Git Leaf.exe");
  assert.equal(
    slashPath(paths.zipPath),
    "/repo/dist/OpenPeek-0.1.1-source-win32-x64.zip",
  );
});

test("windows internal release filenames cannot collide with the same public semver", () => {
  const paths = windowsReleasePaths({
    rootDir: "/repo",
    appName: "OpenPeek",
    version: "0.1.1",
    releaseTrack: "internal",
    buildId: "93458e1.20260705T114700Z",
  });

  assert.equal(
    slashPath(paths.zipPath),
    "/repo/dist/OpenPeek-0.1.1-internal-win32-x64.zip",
  );
});

test("windows update metadata paths mirror the update service update directory shape", () => {
  const paths = windowsUpdateMetadataPaths({
    rootDir: "/repo",
    channel: "stable",
    platformKey: "win32-x64",
  });

  assert.equal(slashPath(paths.updateDir), "/repo/dist/updates/git-leaf/stable/win32-x64");
  assert.equal(slashPath(paths.latestJsonPath), "/repo/dist/updates/git-leaf/stable/win32-x64/latest.json");
  assert.equal(slashPath(paths.sha256Path), "/repo/dist/updates/git-leaf/stable/win32-x64/sha256sums.txt");
});

test("windows release sequence creates an unsigned portable package", () => {
  assert.deepEqual(windowsPortableSteps, [
    "package",
    "zip",
    "verify",
  ]);
  assert.deepEqual(windowsReleaseSteps, [
    "check-version",
    "test",
    "package",
    "zip",
    "verify",
    "tag",
  ]);
  assert.equal(
    DEFAULT_WINDOWS_RELEASE_OPTIONS.companyName,
    "OpenPeek Community",
  );
  assert.equal(DEFAULT_WINDOWS_RELEASE_OPTIONS.productName, "OpenPeek Community Build");
  assert.equal(DEFAULT_ELECTRON_MIRROR, "https://npmmirror.com/mirrors/electron/");
});

test("windows internal update manifest keeps the track and track-qualified build ID", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "git-leaf-windows-update-"));
  try {
    const releasePaths = windowsReleasePaths({
      rootDir,
      version: "1.11.3",
      releaseTrack: "internal",
    });
    await mkdir(path.dirname(releasePaths.zipPath), { recursive: true });
    await writeFile(releasePaths.zipPath, "internal windows zip");

    const metadata = stageWindowsUpdateMetadata({
      appName: "OpenPeek",
      updateBaseUrl: "https://updates.mangofuture.com/git-leaf",
      updateChannel: "internal-stable",
      version: "1.11.3",
      releaseTrack: "internal",
      buildId: "abc123.20260723T000000Z",
      commit: "abc123",
      builtAt: "2026-07-23T00:00:00.000Z",
    }, { rootDir });
    const manifest = JSON.parse(await readFile(metadata.latestJsonPath, "utf8"));

    assert.equal(manifest.channel, "internal-stable");
    assert.equal(manifest.releaseTrack, "internal");
    assert.equal(manifest.buildId, "abc123.20260723T000000Z.internal");
    assert.match(
      manifest.files.zip.url,
      /\/internal-stable\/win32-x64\/OpenPeek-1\.11\.3-internal-win32-x64\.zip$/,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("formal Windows package fails closed before packaging when its release profile is absent", () => {
  assert.throws(
    () => runWindowsReleaseCommand("package", {
      formalRelease: true,
      distribution: "source",
      releaseTrack: "source",
      usageAnalyticsDefault: false,
    }),
    /Official release commands require OPENPEEK_RELEASE_PROFILE/,
  );
});

test("windows publish commands require an unpublished version without blocking smoke portable builds", () => {
  for (const command of ["stage-updates", "publish-updates"]) {
    assert.equal(windowsCommandRequiresNewReleaseVersion(command), true, command);
  }

  for (const command of ["test", "package", "zip", "verify", "tag", "portable", "help"]) {
    assert.equal(windowsCommandRequiresNewReleaseVersion(command), false, command);
  }
});

test("windows zip command uses PowerShell on Windows hosts", () => {
  const command = windowsZipCommand({
    platform: "win32",
    appRoot: "C:\\repo\\dist\\OpenPeek-win32-x64",
    zipPath: "C:\\repo\\dist\\OpenPeek-0.1.1-source-win32-x64.zip",
  });

  assert.equal(command.command, "powershell.exe");
  const commandText = command.args.at(-1);

  assert.match(commandText, /Compress-Archive/);
  assert.match(commandText, /-LiteralPath 'C:\\repo\\dist\\OpenPeek-win32-x64'/);
  assert.match(
    commandText,
    /-DestinationPath 'C:\\repo\\dist\\OpenPeek-0\.1\.1-source-win32-x64\.zip'/,
  );
  assert.equal(command.args.includes("C:\\repo\\dist\\OpenPeek-win32-x64"), false);
});

test("windows zip command keeps zip on POSIX hosts", () => {
  const command = windowsZipCommand({
    platform: "darwin",
    appRoot: "/repo/dist/OpenPeek-win32-x64",
    zipPath: "/repo/dist/OpenPeek-0.1.1-source-win32-x64.zip",
  });

  assert.equal(command.command, "zip");
  assert.deepEqual(command.args, [
    "-qry",
    "/repo/dist/OpenPeek-0.1.1-source-win32-x64.zip",
    "OpenPeek-win32-x64",
  ]);
  assert.equal(command.cwd, "/repo/dist");
});

test("windows release version follows package.json", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(DEFAULT_WINDOWS_RELEASE_OPTIONS.version, packageJson.version);
});

test("npm windows package scripts use the release packager wrapper", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(packageJson.scripts["package:win"], "node scripts/release-windows.mjs package");
  assert.equal(packageJson.scripts["portable:win"], "node scripts/release-windows.mjs portable");
  assert.equal(packageJson.scripts["release:win"], "node scripts/release-windows.mjs release");
  assert.equal(packageJson.scripts["test:ci:win"], "node scripts/test-suite.mjs ci:win");
  assert.equal(
    packageJson.scripts["publish:updates:win"],
    "node scripts/release-windows.mjs publish-updates",
  );
});

test("Makefile exposes Windows package and release targets", async () => {
  const makefile = await readFile("Makefile", "utf8");

  assert.match(makefile, /^package-win:/m);
  assert.match(makefile, /^release-win:/m);
  assert.match(makefile, /^publish-updates-win:/m);
});

function slashPath(value) {
  return value.replace(/\\/g, "/");
}
