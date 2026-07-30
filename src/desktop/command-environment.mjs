import process from "node:process";
import path from "node:path";

import { runExternalCommand } from "../server/external-command.mjs";

const LOGIN_PATH_PROBE =
  "/usr/bin/printf '\\000'; /usr/bin/printenv PATH; /usr/bin/printf '\\000'";
const LOGIN_SHELL_TIMEOUT_MS = 5_000;
const LOGIN_SHELL_MAX_BUFFER = 256 * 1024;

export async function initializeDesktopCommandEnvironment({
  environment = process.env,
  platform = process.platform,
  loginPathReader = readMacLoginShellPath,
} = {}) {
  const currentPath = String(environment.PATH ?? "");
  if (platform !== "darwin") {
    return {
      status: "skipped",
      path: currentPath,
      addedEntries: 0,
    };
  }

  let loginPath = "";
  try {
    loginPath = await loginPathReader({ environment });
  } catch {
    return {
      status: "unchanged",
      path: currentPath,
      addedEntries: 0,
    };
  }

  const augmented = augmentCommandPath(currentPath, loginPath);
  if (augmented.addedEntries === 0) {
    return {
      status: "unchanged",
      path: currentPath,
      addedEntries: 0,
    };
  }

  environment.PATH = augmented.path;
  return {
    status: "augmented",
    path: augmented.path,
    addedEntries: augmented.addedEntries,
  };
}

export async function readMacLoginShellPath({
  environment = process.env,
  commandRunner = runExternalCommand,
  shellCandidates = macLoginShellCandidates(environment),
} = {}) {
  for (const shell of shellCandidates) {
    try {
      const result = await commandRunner(
        shell,
        ["-ilc", LOGIN_PATH_PROBE],
        {
          env: environment,
          timeout: LOGIN_SHELL_TIMEOUT_MS,
          maxBuffer: LOGIN_SHELL_MAX_BUFFER,
        },
      );
      const loginPath = loginPathFromShellOutput(result?.stdout);
      if (loginPath) {
        return loginPath;
      }
    } catch {
      // A custom shell may be unavailable or have broken startup files.
      // Try the next bounded macOS shell candidate, then keep the inherited PATH.
    }
  }

  return "";
}

function augmentCommandPath(currentPath, loginPath) {
  if (!isValidPathValue(loginPath)) {
    return { path: currentPath, addedEntries: 0 };
  }

  const currentEntries = commandPathEntries(currentPath);
  const seen = new Set(currentEntries);
  const additions = [];
  for (const entry of commandPathEntries(loginPath)) {
    if (!seen.has(entry)) {
      seen.add(entry);
      additions.push(entry);
    }
  }

  if (additions.length === 0) {
    return { path: currentPath, addedEntries: 0 };
  }

  return {
    path: currentPath
      ? [currentPath, ...additions].join(":")
      : additions.join(":"),
    addedEntries: additions.length,
  };
}

function commandPathEntries(value) {
  return String(value ?? "")
    .split(":")
    .filter(Boolean);
}

function isValidPathValue(value) {
  return typeof value === "string"
    && value.length > 0
    && !/[\0\r\n]/.test(value);
}

function loginPathFromShellOutput(value) {
  const output = String(value ?? "");
  const end = output.lastIndexOf("\0");
  if (end < 0) {
    return "";
  }
  const start = output.lastIndexOf("\0", end - 1);
  if (start < 0) {
    return "";
  }

  const loginPath = output
    .slice(start + 1, end)
    .replace(/\r?\n$/, "");
  return isValidPathValue(loginPath) ? loginPath : "";
}

function macLoginShellCandidates(environment) {
  const configuredShell = String(environment.SHELL ?? "");
  return [...new Set([
    path.posix.isAbsolute(configuredShell) ? configuredShell : "",
    "/bin/zsh",
  ].filter(Boolean))];
}
