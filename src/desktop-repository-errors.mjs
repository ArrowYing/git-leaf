import { isGitRepositoryNotFoundError } from "./git-errors.mjs";
import { externalCommandState } from "./external-command.mjs";

export function repositorySelectionErrorMessage(selectedPath, error) {
  const state = commandStateForRepositoryError(error);
  if (state === "invalid_context") {
    return [
      `无法打开这个目录：${selectedPath}`,
      "这个目录不在 Git 仓库中。",
      "请选择 Git 仓库目录，或仓库中的任意子目录。",
    ].join("\n");
  }

  const guidance = repositoryFailureGuidance(state);
  return [
    `无法打开这个目录：${selectedPath}`,
    guidance.summary,
    guidance.action,
    technicalErrorMessage(error),
  ].filter(Boolean).join("\n");
}

export function startupRepositoryErrorMessage(candidate, error) {
  const state = commandStateForRepositoryError(error);
  if (state === "invalid_context") {
    return [
      `上次打开的仓库已不可用：${candidate}`,
      "这个目录已经不在 Git 仓库中，请重新选择一个本地 Git 仓库。",
    ].join("\n");
  }

  const guidance = repositoryFailureGuidance(state);
  return [
    `上次记录的仓库暂时不可用：${candidate}`,
    guidance.summary,
    guidance.action,
    technicalErrorMessage(error),
  ].filter(Boolean).join("\n");
}

function commandStateForRepositoryError(error) {
  return isGitRepositoryNotFoundError(error) ? "invalid_context" : externalCommandState(error);
}

function repositoryFailureGuidance(state) {
  if (state === "unavailable") {
    return {
      summary: "Git Leaf 找不到本机 Git 命令。",
      action: "请确认 Git 已安装，并且桌面应用可以运行 git 命令，然后重试。",
    };
  }
  if (state === "permission_denied") {
    return {
      summary: "Git Leaf 没有权限运行 Git 或读取这个目录。",
      action: "请检查 Git 命令与仓库目录的访问权限，然后重试。",
    };
  }
  if (state === "unsupported") {
    return {
      summary: "本机 Git 不支持当前操作所需的命令能力。",
      action: "Git Leaf 已停止当前操作；仓库内容没有被修改。",
    };
  }
  if (state === "authentication_required") {
    return {
      summary: "Git 身份验证未通过。",
      action: "请检查当前仓库使用的 Git 凭据，然后重试。",
    };
  }
  if (state === "network_unavailable") {
    return {
      summary: "网络或 Git 远端暂时不可用。",
      action: "请检查网络与远端地址，然后重试。",
    };
  }
  if (state === "interrupted") {
    return {
      summary: "Git 命令在完成前被中断。",
      action: "请确认没有系统任务终止 Git，然后重试。",
    };
  }
  if (state === "invalid_output") {
    return {
      summary: "Git 返回了 Git Leaf 无法识别的结果。",
      action: "Git Leaf 已停止当前操作；仓库内容没有被修改。",
    };
  }
  return {
    summary: "Git Leaf 读取这个仓库时遇到问题。",
    action: "请确认目录仍然存在，并且当前用户可以访问，然后重试。",
  };
}

function technicalErrorMessage(error) {
  const lines = [error?.stderr, error?.stdout, error instanceof Error ? error.message : error]
    .filter(Boolean)
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const detail = lines.find((line) => /^(?:fatal|error):/i.test(line))
    ?? lines.find((line) => !/^Command failed:/i.test(line) && !/^usage:/i.test(line))
    ?? lines[0]
    ?? "";
  return detail ? `技术信息：${detail.slice(0, 240)}` : "";
}
