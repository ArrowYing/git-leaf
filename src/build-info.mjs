import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUILD_INFO_FILENAME = "git-leaf-build-info.json";

const APP_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_VERSION = "0.0.0";
const DEFAULT_COMMIT = "dev";
const DEFAULT_BUILD_ID = "dev";
export const DEFAULT_DISTRIBUTION = "source";
export const DEFAULT_USAGE_ANALYTICS = false;
const DISTRIBUTIONS = new Set(["source", "official"]);

export const BUILD_INFO = readBuildInfo();

export function readBuildInfo({ rootDir = APP_ROOT, env = process.env, now = () => new Date() } = {}) {
  const packageJson = readJsonFile(path.join(rootDir, "package.json"));
  const generated = readJsonFile(path.join(rootDir, BUILD_INFO_FILENAME));
  const builtAt = stringValue(generated.builtAt) || stringValue(env.GIT_LEAF_BUILT_AT) || now().toISOString();

  return normalizeBuildInfo({
    version: stringValue(generated.version) || stringValue(env.GIT_LEAF_VERSION) || stringValue(packageJson.version) || DEFAULT_VERSION,
    commit: stringValue(generated.commit) || stringValue(env.GIT_LEAF_COMMIT) || DEFAULT_COMMIT,
    builtAt,
    buildId: stringValue(generated.buildId) || stringValue(env.GIT_LEAF_BUILD_ID) || DEFAULT_BUILD_ID,
    dev: booleanValue(generated.dev) ?? booleanValue(env.GIT_LEAF_DEV) ?? false,
    distribution:
      distributionValue(generated.distribution)
      || distributionValue(env.GIT_LEAF_DISTRIBUTION)
      || DEFAULT_DISTRIBUTION,
    usageAnalyticsDefault:
      booleanValue(generated.usageAnalyticsDefault)
      ?? booleanValue(env.GIT_LEAF_USAGE_ANALYTICS_DEFAULT)
      ?? DEFAULT_USAGE_ANALYTICS,
  });
}

export function normalizeBuildInfo(info) {
  return {
    version: stringValue(info?.version) || DEFAULT_VERSION,
    commit: stringValue(info?.commit) || DEFAULT_COMMIT,
    builtAt: stringValue(info?.builtAt) || new Date(0).toISOString(),
    buildId: stringValue(info?.buildId) || DEFAULT_BUILD_ID,
    dev: info?.dev === true,
    distribution: distributionValue(info?.distribution) || DEFAULT_DISTRIBUTION,
    usageAnalyticsDefault: info?.usageAnalyticsDefault === true,
  };
}

export function isOfficialDistribution(buildInfo) {
  return buildInfo?.distribution === "official" && buildInfo?.dev !== true;
}

export function buildDistributionLabel(buildInfo) {
  if (buildInfo?.dev === true) {
    return "开发构建";
  }
  return isOfficialDistribution(buildInfo) ? "官方构建" : "源码构建";
}

export function appDisplayName(buildInfo) {
  return buildInfo?.dev === true ? "Git Leaf dev" : "Git Leaf";
}

export function releaseDateLabel(buildInfo) {
  const builtAt = stringValue(buildInfo?.builtAt);
  if (!builtAt) {
    return "";
  }

  const builtAtDate = new Date(builtAt);
  if (Number.isNaN(builtAtDate.getTime())) {
    return "";
  }

  return `发布于 ${builtAtDate.toISOString().slice(0, 10)}`;
}

export function aboutPanelCopyright(buildInfo) {
  const lines = [];
  const releaseDate = releaseDateLabel(buildInfo);
  const commit = stringValue(buildInfo?.commit);
  if (releaseDate) {
    lines.push(releaseDate);
  }
  if (buildInfo?.dev === true && commit) {
    lines.push(`Commit ${commit}`);
  }
  return lines.join("\n");
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function booleanValue(value) {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function distributionValue(value) {
  const normalized = stringValue(value).toLowerCase();
  return DISTRIBUTIONS.has(normalized) ? normalized : "";
}
