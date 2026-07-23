import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";

export const DEVELOPMENT_USER_DATA_ARG = "--git-leaf-dev-user-data-dir";
export const DEVELOPMENT_USER_DATA_ENV = "GIT_LEAF_DEV_USER_DATA_DIR";

function lstatIfPresent(filePath) {
  try {
    return lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return null;
    }
    throw error;
  }
}

export function physicalPathFor(filePath) {
  const logicalPath = path.resolve(filePath);
  let existingPath = logicalPath;
  const missingSegments = [];

  while (!lstatIfPresent(existingPath)) {
    const parentPath = path.dirname(existingPath);
    if (parentPath === existingPath) {
      break;
    }
    missingSegments.unshift(path.basename(existingPath));
    existingPath = parentPath;
  }

  const physicalBase = realpathSync.native(existingPath);
  return path.resolve(physicalBase, ...missingSegments);
}

export function pathIdentity(filePath, { rejectSymlink = false } = {}) {
  const logicalPath = path.resolve(filePath);
  const fileStat = lstatIfPresent(logicalPath);
  if (rejectSymlink && fileStat?.isSymbolicLink()) {
    throw new Error(`Refusing symbolic-link user-data path: ${logicalPath}`);
  }
  return {
    logicalPath,
    physicalPath: physicalPathFor(logicalPath),
  };
}

export function pathsOverlap(firstPath, secondPath) {
  const relative = path.relative(firstPath, secondPath);
  return (
    relative === ""
    || (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function assertPathIdentitiesDoNotOverlap({ requestedIdentity, protectedIdentity }) {
  const logicalOverlap = (
    pathsOverlap(protectedIdentity.logicalPath, requestedIdentity.logicalPath)
    || pathsOverlap(requestedIdentity.logicalPath, protectedIdentity.logicalPath)
  );
  const physicalOverlap = (
    pathsOverlap(protectedIdentity.physicalPath, requestedIdentity.physicalPath)
    || pathsOverlap(requestedIdentity.physicalPath, protectedIdentity.physicalPath)
  );
  if (logicalOverlap || physicalOverlap) {
    throw new Error(
      `Refusing development user-data path inside the production profile: ${requestedIdentity.logicalPath}`,
    );
  }
}

export function requestedDevelopmentUserDataDir({ argv = [], env = {} } = {}) {
  const inlinePrefix = `${DEVELOPMENT_USER_DATA_ARG}=`;
  const inlineValue = argv.find((argument) => String(argument).startsWith(inlinePrefix));
  if (inlineValue) {
    return String(inlineValue).slice(inlinePrefix.length).trim();
  }

  const argumentIndex = argv.findIndex((argument) => argument === DEVELOPMENT_USER_DATA_ARG);
  if (argumentIndex >= 0) {
    return String(argv[argumentIndex + 1] || "").trim();
  }

  return String(env[DEVELOPMENT_USER_DATA_ENV] || "").trim();
}

export function assertDevelopmentUserDataOverride({ requestedDir, defaultDir }) {
  if (!path.isAbsolute(requestedDir)) {
    throw new Error(`${DEVELOPMENT_USER_DATA_ARG} must be an absolute path.`);
  }

  const requestedIdentity = pathIdentity(requestedDir, { rejectSymlink: true });
  const protectedIdentity = pathIdentity(defaultDir);
  assertPathIdentitiesDoNotOverlap({ requestedIdentity, protectedIdentity });

  return requestedIdentity.logicalPath;
}

export function applyDevelopmentUserDataOverride({
  app,
  argv = process.argv,
  env = process.env,
  isDevBuild = false,
  makeDir = mkdirSync,
  log = console.log,
} = {}) {
  const defaultDir = app.getPath("userData");
  const defaultSessionDir = app.getPath("sessionData");
  const requestedDir = requestedDevelopmentUserDataDir({ argv, env })
    || (isDevBuild ? `${defaultDir}-dev` : "");
  if (!requestedDir) {
    return { applied: false };
  }

  const userDataDir = assertDevelopmentUserDataOverride({ requestedDir, defaultDir });
  assertDevelopmentUserDataOverride({ requestedDir, defaultDir: defaultSessionDir });
  makeDir(userDataDir, { recursive: true });
  assertDevelopmentUserDataOverride({ requestedDir: userDataDir, defaultDir });
  assertDevelopmentUserDataOverride({ requestedDir: userDataDir, defaultDir: defaultSessionDir });
  app.setPath("userData", userDataDir);
  app.setPath("sessionData", userDataDir);
  log(`[Git Leaf dev] Isolated userData/sessionData: ${userDataDir}`);
  return {
    applied: true,
    defaultDir: path.resolve(defaultDir),
    defaultSessionDir: path.resolve(defaultSessionDir),
    userDataDir,
  };
}
