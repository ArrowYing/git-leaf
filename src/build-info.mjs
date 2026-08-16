import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OPENGLANCE_DEVELOPMENT_NAME,
  OPENGLANCE_PRODUCT_NAME,
} from "./product-identity.mjs";

export const BUILD_INFO_FILENAME = "openglance-build-info.json";
export const GIT_LEAF_BUILD_INFO_FILENAME = "git-leaf-build-info.json";
export const LEGACY_BUILD_INFO_FILENAME = GIT_LEAF_BUILD_INFO_FILENAME;
export const LEGACY_BUILD_INFO_FILENAMES = Object.freeze([
  GIT_LEAF_BUILD_INFO_FILENAME,
]);

const APP_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_VERSION = "0.0.0";
const DEFAULT_COMMIT = "dev";
const DEFAULT_BUILD_ID = "dev";
export const DEFAULT_DISTRIBUTION = "source";
export const DEFAULT_RELEASE_TRACK = "source";
export const DEFAULT_USAGE_ANALYTICS = false;
const DISTRIBUTIONS = new Set(["source", "official"]);
const RELEASE_TRACKS = new Set(["source", "public", "internal"]);

export const BUILD_INFO = readBuildInfo();

export function readBuildInfo({ rootDir = APP_ROOT, env = process.env, now = () => new Date() } = {}) {
  const packageJson = readJsonFile(path.join(rootDir, "package.json"));
  const generatedPath = [BUILD_INFO_FILENAME, ...LEGACY_BUILD_INFO_FILENAMES]
    .map((filename) => path.join(rootDir, filename))
    .find((candidate) => existsSync(candidate))
    || path.join(rootDir, BUILD_INFO_FILENAME);
  const generated = readJsonFile(generatedPath);
  const hasGeneratedBuildInfo = existsSync(generatedPath);
  const builtAt = stringValue(generated.builtAt)
    || stringValue(envValue(env, "BUILT_AT"))
    || now().toISOString();
  const distribution =
    distributionValue(generated.distribution)
    || (!hasGeneratedBuildInfo
      ? distributionValue(envValue(env, "DISTRIBUTION"))
      : "")
    || DEFAULT_DISTRIBUTION;

  const rawBuildInfo = {
    version: stringValue(generated.version)
      || stringValue(envValue(env, "VERSION"))
      || stringValue(packageJson.version)
      || DEFAULT_VERSION,
    commit: stringValue(generated.commit)
      || stringValue(envValue(env, "COMMIT"))
      || DEFAULT_COMMIT,
    builtAt,
    buildId: stringValue(generated.buildId)
      || stringValue(envValue(env, "BUILD_ID"))
      || DEFAULT_BUILD_ID,
    dev: booleanValue(generated.dev)
      ?? booleanValue(envValue(env, "DEV"))
      ?? false,
    distribution,
    usageAnalyticsDefault: hasGeneratedBuildInfo
      ? booleanValue(generated.usageAnalyticsDefault) ?? DEFAULT_USAGE_ANALYTICS
      : booleanValue(envValue(
        env,
        "USAGE_ANALYTICS_DEFAULT",
      )) ?? DEFAULT_USAGE_ANALYTICS,
  };
  if (hasGeneratedBuildInfo) {
    if (hasOwn(generated, "releaseTrack")) {
      rawBuildInfo.releaseTrack = generated.releaseTrack;
    }
  } else {
    const releaseTrack = envValue(env, "RELEASE_TRACK");
    if (releaseTrack !== undefined) {
      rawBuildInfo.releaseTrack = releaseTrack;
    }
  }
  return normalizeBuildInfo(rawBuildInfo);
}

export function normalizeBuildInfo(info) {
  const distribution = distributionValue(info?.distribution) || DEFAULT_DISTRIBUTION;
  return {
    version: stringValue(info?.version) || DEFAULT_VERSION,
    commit: stringValue(info?.commit) || DEFAULT_COMMIT,
    builtAt: stringValue(info?.builtAt) || new Date(0).toISOString(),
    buildId: stringValue(info?.buildId) || DEFAULT_BUILD_ID,
    dev: info?.dev === true,
    distribution,
    releaseTrack: releaseTrackForDistribution({
      distribution,
      releaseTrack: info?.releaseTrack,
      hasReleaseTrack: hasOwn(info, "releaseTrack"),
    }),
    usageAnalyticsDefault: info?.usageAnalyticsDefault === true,
  };
}

export function releaseTrackForBuildInfo(buildInfo) {
  return releaseTrackForDistribution({
    distribution: distributionValue(buildInfo?.distribution) || DEFAULT_DISTRIBUTION,
    releaseTrack: buildInfo?.releaseTrack,
    hasReleaseTrack: hasOwn(buildInfo, "releaseTrack"),
  });
}

export function isOfficialDistribution(buildInfo) {
  return buildInfo?.distribution === "official" && buildInfo?.dev !== true;
}

export function buildDistributionLabel(buildInfo, { language = "en" } = {}) {
  const isChinese = chineseLanguage(language);
  if (buildInfo?.dev === true) {
    return isChinese ? "开发构建" : "Development build";
  }
  if (!isOfficialDistribution(buildInfo)) {
    return isChinese ? "社区构建" : "Community build";
  }
  const releaseTrack = releaseTrackForBuildInfo(buildInfo);
  if (releaseTrack === "internal") {
    return isChinese ? "官方内部构建" : "Official internal build";
  }
  if (releaseTrack === "public") {
    return isChinese ? "官方公开构建" : "Official public build";
  }
  return isChinese ? "官方构建（无更新轨道）" : "Official build (no update track)";
}

export function appDisplayName(buildInfo) {
  return buildInfo?.dev === true ? OPENGLANCE_DEVELOPMENT_NAME : OPENGLANCE_PRODUCT_NAME;
}

export function releaseDateLabel(buildInfo, { language = "en" } = {}) {
  const builtAt = stringValue(buildInfo?.builtAt);
  if (!builtAt) {
    return "";
  }

  const builtAtDate = new Date(builtAt);
  if (Number.isNaN(builtAtDate.getTime())) {
    return "";
  }

  const date = builtAtDate.toISOString().slice(0, 10);
  return chineseLanguage(language) ? `发布于 ${date}` : `Released ${date}`;
}

export function aboutPanelCopyright(buildInfo, { language = "en" } = {}) {
  const lines = [];
  const releaseDate = releaseDateLabel(buildInfo, { language });
  const commit = stringValue(buildInfo?.commit);
  if (releaseDate) {
    lines.push(releaseDate);
  }
  if (buildInfo?.dev === true && commit) {
    lines.push(`Commit ${commit}`);
  }
  return lines.join("\n");
}

function chineseLanguage(value) {
  const normalized = String(value ?? "").trim().replaceAll("_", "-").toLowerCase();
  return normalized === "zh" || normalized.startsWith("zh-");
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

function releaseTrackValue(value) {
  const normalized = stringValue(value).toLowerCase();
  return RELEASE_TRACKS.has(normalized) ? normalized : "";
}

function releaseTrackForDistribution({ distribution, releaseTrack, hasReleaseTrack = false }) {
  if (distribution !== "official") {
    return DEFAULT_RELEASE_TRACK;
  }
  if (!hasReleaseTrack) {
    return "public";
  }
  const normalized = releaseTrackValue(releaseTrack);
  return ["public", "internal"].includes(normalized)
    ? normalized
    : DEFAULT_RELEASE_TRACK;
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function envValue(env, suffix) {
  for (const prefix of ["OPENGLANCE", "GIT_LEAF"]) {
    const name = `${prefix}_${suffix}`;
    if (env?.[name] !== undefined) {
      return env[name];
    }
  }
  return undefined;
}
