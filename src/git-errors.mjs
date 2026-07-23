export class GitRepositoryNotFoundError extends Error {
  constructor(startPath, options = {}) {
    super(`Could not find a git repository from ${startPath}`, options);
    this.name = "GitRepositoryNotFoundError";
    this.code = "NOT_GIT_REPOSITORY";
    this.startPath = startPath;
  }
}

export function isGitRepositoryNotFoundError(error) {
  return error instanceof GitRepositoryNotFoundError
    || error?.code === "NOT_GIT_REPOSITORY";
}

export function gitCommandReportsMissingRepository(error) {
  return externalCommandState(error) === "invalid_context";
}
import { externalCommandState } from "./external-command.mjs";
