import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  BUILD_INFO_FILENAME,
  DEFAULT_DISTRIBUTION,
  DEFAULT_USAGE_ANALYTICS,
} from "../src/build-info.mjs";

export const RELEASE_PACKAGE_IGNORE_PATTERNS = [
  "^/test($|/)",
  "^/dist($|/)",
  "^/\\.git($|/)",
  "^/\\.github($|/)",
  "^/\\.superpowers($|/)",
  "^/scripts($|/)",
  "^/assets($|/)",
  "^/docs($|/)",
  "^/marketing($|/)",
  "^/Makefile$",
  "^/AGENTS\\.md$",
  "^/CLAUDE\\.md$",
  "^/CONTRIBUTING\\.md$",
  "^/README\\.md$",
  "^/SECURITY\\.md$",
  "^/architecture\\.md$",
  "^/release\\.md$",
  "^/mdx-lite-guide\\.md$",
  "^/mdx-lite-components-demo\\.mdx$",
  "^/package-lock\\.json$",
  "^/\\.gitignore$",
  "^/\\.gitleaks\\.toml$",
  "^/windows-portable-guide\\.md$",
  "^/node_modules/\\.package-lock\\.json$",
  "^/node_modules/.cache($|/)",
  "^/node_modules/@electron($|/)",
  "^/node_modules/@electron-internal($|/)",
  "^/node_modules/@esbuild($|/)",
  "^/node_modules/@malept($|/)",
  "^/node_modules/@types($|/)",
  "^/node_modules/@xmldom($|/)",
  "^/node_modules/electron($|/)",
  "^/node_modules/esbuild($|/)",
  "^/node_modules/.+/(test|tests|__tests__)($|/)",
  "^/node_modules/.+/[^/]+\\.(test|spec)\\.(js|mjs|cjs|ts|tsx|jsx)$",
  "^/node_modules/.+/(test[-_][^/]+|[^/]+[-_.]test)\\.(js|mjs|cjs|ts|tsx|jsx)$",
  "^/\\.DS_Store$",
];

export function releaseBuildInfoFromEnv({
  rootDir,
  env = process.env,
  now = () => new Date(),
  fallbackVersion = "0.0.0",
} = {}) {
  const profile = releaseProfileFromEnv({ env });
  const releaseProfileConfigured = Boolean(String(env.GIT_LEAF_RELEASE_PROFILE || "").trim());
  const builtAt = env.BUILT_AT || now().toISOString();
  const commit = env.GIT_COMMIT || currentGitCommit({ cwd: rootDir });
  const buildId = env.BUILD_ID || `${commit}.${compactTimestamp(builtAt)}`;

  return {
    version: env.VERSION || packageVersion({ rootDir, fallbackVersion }),
    commit,
    builtAt,
    buildId,
    releaseProfileConfigured,
    releaseProfileDistribution: profile.distribution,
    distribution: distributionValue(
      env.GIT_LEAF_DISTRIBUTION || profile.distribution || DEFAULT_DISTRIBUTION,
    ),
    usageAnalyticsDefault: booleanValue(
      env.GIT_LEAF_USAGE_ANALYTICS_DEFAULT,
      profile.usageAnalyticsDefault,
      DEFAULT_USAGE_ANALYTICS,
    ),
  };
}

export function releaseProfileFromEnv({ env = process.env } = {}) {
  const profilePath = String(env.GIT_LEAF_RELEASE_PROFILE || "").trim();
  if (!profilePath) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path.resolve(profilePath), "utf8"));
  } catch (error) {
    throw new Error(`Could not read GIT_LEAF_RELEASE_PROFILE: ${profilePath}`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("GIT_LEAF_RELEASE_PROFILE must contain one JSON object.");
  }
  return parsed;
}

export function assertOfficialReleaseProfile(options) {
  if (
    options?.releaseProfileConfigured !== true
    || options?.releaseProfileDistribution !== "official"
    || options?.distribution !== "official"
  ) {
    throw new Error(
      "Official release commands require GIT_LEAF_RELEASE_PROFILE whose distribution is official.",
    );
  }
}

export function releaseArtifactFileName({ version, platformKey, extension } = {}) {
  const cleanVersion = String(version || "").trim();
  const cleanPlatformKey = String(platformKey || "").trim();
  const cleanExtension = String(extension || "").trim().replace(/^\./, "");
  if (!cleanVersion || !cleanPlatformKey || !cleanExtension) {
    throw new Error("Release artifact file name requires version, platformKey, and extension");
  }
  return `GitLeaf-${cleanVersion}-${cleanPlatformKey}.${cleanExtension}`;
}

export function releaseTagName({ version } = {}) {
  const cleanVersion = String(version || "").trim();
  if (!cleanVersion) {
    throw new Error("Release version is required before creating a git tag");
  }
  return cleanVersion.startsWith("v") ? cleanVersion : `v${cleanVersion}`;
}

export function assertReleaseVersionIsNew({
  rootDir,
  version,
  runCommand = spawnSync,
} = {}) {
  const tagName = releaseTagName({ version });
  const tagResult = runCommand("git", ["rev-parse", "--verify", `refs/tags/${tagName}^{}`], {
    cwd: rootDir,
    encoding: "utf8",
  });

  if (tagResult.status === 0) {
    throw new Error(
      `Release version ${version} has already been published as tag ${tagName}. ` +
        "Bump package.json before creating another distributable build.",
    );
  }
}

export function electronPackagerCommand({ rootDir = process.cwd() } = {}) {
  return {
    command: process.execPath,
    args: [
      path.join(rootDir, "node_modules", "@electron", "packager", "bin", "electron-packager.mjs"),
    ],
  };
}

export function ensureReleaseGitTag({
  rootDir,
  version,
  runCommand = spawnSync,
} = {}) {
  const tagName = releaseTagName({ version });
  const headCommit = gitOutput(["rev-parse", "HEAD"], { cwd: rootDir, runCommand }).trim();
  const tagResult = runCommand("git", ["rev-parse", "--verify", `refs/tags/${tagName}^{}`], {
    cwd: rootDir,
    encoding: "utf8",
  });

  if (tagResult.status === 0) {
    const taggedCommit = String(tagResult.stdout || "").trim();
    if (taggedCommit !== headCommit) {
      throw new Error(
        `Release tag ${tagName} already points to ${taggedCommit}, not current HEAD ${headCommit}`,
      );
    }
    return { tagName, commit: headCommit, created: false };
  }

  gitRun(["tag", "-a", tagName, "-m", `Git Leaf ${version}`], {
    cwd: rootDir,
    runCommand,
  });
  return { tagName, commit: headCommit, created: true };
}

export function packageVersion({ rootDir, fallbackVersion = "0.0.0" } = {}) {
  try {
    const packageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
    return String(packageJson.version || fallbackVersion);
  } catch {
    return fallbackVersion;
  }
}

export function compactTimestamp(value) {
  return String(value)
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "")
    .replace(/\.\d+/, "");
}

export function withReleaseBuildInfoFile({ rootDir, buildInfo }, callback) {
  const filePath = path.join(rootDir, BUILD_INFO_FILENAME);
  writeFileSync(filePath, `${JSON.stringify(buildInfoPayload(buildInfo), null, 2)}\n`, "utf8");
  try {
    return callback();
  } finally {
    rmSync(filePath, { force: true });
  }
}

function buildInfoPayload(buildInfo) {
  return {
    version: String(buildInfo.version || ""),
    commit: String(buildInfo.commit || ""),
    builtAt: String(buildInfo.builtAt || ""),
    buildId: String(buildInfo.buildId || ""),
    ...(buildInfo.dev === true ? { dev: true } : {}),
    distribution: distributionValue(buildInfo.distribution || DEFAULT_DISTRIBUTION),
    usageAnalyticsDefault: buildInfo.usageAnalyticsDefault === true,
  };
}

function distributionValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "source" || normalized === "official") {
    return normalized;
  }
  throw new Error(`Unsupported Git Leaf distribution: ${value}`);
}

function booleanValue(environmentValue, profileValue, fallback) {
  if (environmentValue !== undefined && environmentValue !== "") {
    const normalized = String(environmentValue).trim().toLowerCase();
    if (["1", "true", "yes"].includes(normalized)) return true;
    if (["0", "false", "no"].includes(normalized)) return false;
    throw new Error(`Invalid boolean build setting: ${environmentValue}`);
  }
  if (typeof profileValue === "boolean") {
    return profileValue;
  }
  return fallback === true;
}

function currentGitCommit({ cwd } = {}) {
  const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function gitOutput(args, { cwd, runCommand }) {
  const result = runCommand("git", args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `Command failed: git ${args.join(" ")}`);
  }
  return String(result.stdout || "");
}

function gitRun(args, { cwd, runCommand }) {
  const result = runCommand("git", args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `Command failed: git ${args.join(" ")}`);
  }
}
