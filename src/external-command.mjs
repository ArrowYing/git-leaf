import { execFile } from "node:child_process";
import { access } from "node:fs/promises";

export const EXTERNAL_COMMAND_STATES = Object.freeze({
  OK: "ok",
  UNAVAILABLE: "unavailable",
  PERMISSION_DENIED: "permission_denied",
  UNSUPPORTED: "unsupported",
  INVALID_CONTEXT: "invalid_context",
  AUTHENTICATION_REQUIRED: "authentication_required",
  NETWORK_UNAVAILABLE: "network_unavailable",
  INTERRUPTED: "interrupted",
  INVALID_OUTPUT: "invalid_output",
  FAILED: "failed",
});

export class ExternalCommandOutputError extends Error {
  constructor(command, args = [], detail = "unexpected output", options = {}) {
    const commandLine = [command, ...args].filter(Boolean).join(" ");
    super(`${commandLine || "External command"} returned ${detail}.`, options);
    this.name = "ExternalCommandOutputError";
    this.code = "EXTERNAL_COMMAND_INVALID_OUTPUT";
    this.externalCommandState = EXTERNAL_COMMAND_STATES.INVALID_OUTPUT;
    this.command = command;
    this.args = [...args];
    this.detail = detail;
  }
}

export function externalCommandState(error) {
  if (!error) {
    return EXTERNAL_COMMAND_STATES.OK;
  }
  if (Object.values(EXTERNAL_COMMAND_STATES).includes(error.externalCommandState)) {
    return error.externalCommandState;
  }

  const code = String(error.code ?? "").toUpperCase();
  const output = externalCommandOutput(error);

  if (code === "ENOENT") {
    return EXTERNAL_COMMAND_STATES.UNAVAILABLE;
  }
  if (["EACCES", "EPERM"].includes(code)) {
    return EXTERNAL_COMMAND_STATES.PERMISSION_DENIED;
  }
  if (error.signal || ["ABORT_ERR", "ECANCELED", "ETIMEDOUT"].includes(code)) {
    return EXTERNAL_COMMAND_STATES.INTERRUPTED;
  }
  if (/authentication failed|could not read username|terminal prompts disabled|permission denied \(publickey\)|not logged in|not authenticated/i.test(output)) {
    return EXTERNAL_COMMAND_STATES.AUTHENTICATION_REQUIRED;
  }
  if (/could not resolve host|failed to connect|connection (?:timed out|refused|reset)|network is unreachable|unable to access.+(?:ssl|tls|proxy)|operation timed out/i.test(output)) {
    return EXTERNAL_COMMAND_STATES.NETWORK_UNAVAILABLE;
  }
  if (/unknown (?:switch|option|subcommand)|unrecognized option|unsupported (?:option|command)|is not a git command/i.test(output)) {
    return EXTERNAL_COMMAND_STATES.UNSUPPORTED;
  }
  if (/not a git repository|not a git work tree|must be run in a work tree|this operation must be run in a work tree/i.test(output)) {
    return EXTERNAL_COMMAND_STATES.INVALID_CONTEXT;
  }
  if (/permission denied|operation not permitted|detected dubious ownership|unsafe repository/i.test(output)) {
    return EXTERNAL_COMMAND_STATES.PERMISSION_DENIED;
  }
  return EXTERNAL_COMMAND_STATES.FAILED;
}

export function externalCommandExitCode(error) {
  const value = Number(error?.code);
  return Number.isInteger(value) ? value : null;
}

export function isExternalCommandExit(error, ...expectedCodes) {
  const code = externalCommandExitCode(error);
  return code !== null && expectedCodes.includes(code);
}

export function externalCommandOutput(error) {
  return [error?.stderr, error?.stdout, error?.message]
    .filter(Boolean)
    .join("\n");
}

export function runExternalCommand(command, args = [], options = {}) {
  const { cwd, ...execOptions } = options;
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: "utf8", ...(cwd ? { cwd } : {}), ...execOptions },
      async (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr });
          return;
        }

        error.stdout = stdout;
        error.stderr = stderr;
        error.externalCommand = command;
        error.externalCommandArgs = [...args];
        error.externalCommandCwd = cwd ?? "";
        error.externalCommandState = await commandFailureStateWithContext(error, cwd);
        reject(error);
      },
    );
  });
}

async function commandFailureStateWithContext(error, cwd) {
  if (error?.code === "ENOENT" && cwd) {
    try {
      await access(cwd);
    } catch (cwdError) {
      if (cwdError?.code === "ENOENT") {
        return EXTERNAL_COMMAND_STATES.INVALID_CONTEXT;
      }
      if (["EACCES", "EPERM"].includes(cwdError?.code)) {
        return EXTERNAL_COMMAND_STATES.PERMISSION_DENIED;
      }
    }
  }
  return externalCommandState(error);
}
