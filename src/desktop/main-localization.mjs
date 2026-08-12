import { createTranslator } from "../../public/i18n.js";
import { aboutPanelCopyright } from "../build-info.mjs";
import {
  repositorySelectionErrorMessage,
  startupRepositoryErrorMessage,
} from "./repository-errors.mjs";
import {
  DESKTOP_MESSAGES,
  resolveDesktopLanguage,
} from "./localization.mjs";

const MAIN_MESSAGES = Object.freeze({
  en: Object.freeze({
    "dialog.openDocumentForPdf": "Open a document before exporting PDF.",
    "dialog.exportPdf": "Export PDF",
    "dialog.exportPdfFailed": "Could not export PDF.",
    "dialog.cancel": "Cancel",
    "dialog.close": "Close",
    "dialog.acknowledge": "OK",
    "dialog.retry": "Retry",
    "dialog.retrySelection": "Choose Again",
    "dialog.chooseLocalRepository": "Choose Local Repository…",
    "dialog.copyAgentPrompt": "Copy Agent Prompt",

    "worktree.unavailable": "The selected worktree does not belong to this repository or is no longer available.",
    "worktree.switchFailed": "Could not switch worktrees",

    "share.inspectMainFailed": "Could not inspect the main worktree",
    "share.mainWrongBranch":
      "This repository’s main worktree is currently on {branch}.\n\nShared links can only open in the main worktree on the main branch. Switch that worktree to main, then open the link again.",
    "share.mainMissing":
      "OpenPeek could not find an available main worktree for this repository. Make sure the main worktree still exists on this computer, then open the link again.",
    "share.openFailed": "Could not open the shared link",
    "share.switchPrompt": "Switch to the main worktree?",
    "share.switchRequired": "Opening this shared link requires the main worktree on the main branch.",
    "share.currentWorktree": "Current worktree: {worktree}",
    "share.otherWorktree": "another worktree",
    "share.targetWorktree": "Target worktree: main worktree · main",
    "share.switchAndOpen": "Switch and Open",
    "share.inspectLatestMainFailed": "Could not inspect the latest main",
    "share.updateMainPrompt": "Update main to open the shared content",
    "share.dirtyNonOverlapping":
      "You have {count} uncommitted files, but none overlap this update.",
    "share.localChangesPreserved": "Your local changes will be preserved.",
    "share.preserveAndUpdate": "Preserve Changes and Update",
    "share.syncRequiredPrompt": "Sync local changes before opening the shared content",
    "share.syncRequiredDetail":
      "These files have local changes. Commit them, sync main, and push before continuing:",
    "share.syncAndOpen": "Sync and Open",
    "share.syncNote": "Sync local files before opening a shared link",
    "share.safeUpdateFailed": "Could not safely update main",
    "share.worktreeNotFound": "The target worktree was not found on this computer",
    "share.repositoryNotAdded": "This repository has not been added to OpenPeek",
    "share.chooseRepositoryTitle": "Choose the Git repository for this link",
    "share.invalidRepository": "The selected folder is not a usable Git repository",
    "share.chooseMatchingRepository": "Choose the local folder for the repository in this link.",
    "share.repositoryMismatch": "The selected repository does not match this link",
    "share.worktreeMissingFromRepository": "The selected repository does not contain the target worktree",
    "share.syncFailed": "Could not sync local changes",
    "share.syncIncomplete": "Git sync did not complete.",
    "share.fetchFailedTitle": "Could not fetch the latest main",
    "share.revisionMissingTitle": "The shared revision is no longer available",
    "share.unpushedMainTitle": "main has commits that have not been synchronized",
    "share.fetchFailedDetail":
      "OpenPeek could not fetch the latest main from GitHub. Check the network and GitHub access, then open the link again.",
    "share.technicalDetail": "Technical details: {detail}",
    "share.revisionMissingDetail":
      "origin/main no longer contains the document revision in this link. Ask the sender to create a new link.",
    "share.aheadDetail":
      "The local main worktree has unpushed commits. Finish Git sync in OpenPeek, then open the link again.",
    "share.divergedDetail":
      "The local main worktree and origin/main have diverged. Ask an AI Agent to resolve the divergence and complete Git sync, then open the link again.",
    "share.unsafeDetail":
      "The main worktree is not currently safe to open. Complete Git sync, then open the link again.",
    "share.repositoryUnknown":
      "{repository} is not yet in OpenPeek’s repository list.\nChoose its local folder so OpenPeek can verify the GitHub origin and continue opening this link.",
    "share.worktreeUnknown":
      "OpenPeek has not found worktree {worktree} for {repository} on this computer.\nChoose any local worktree of the repository and OpenPeek will continue looking for the linked worktree.\nIf that worktree only exists on another computer, open the link on the computer where it was created.",
    "share.repositorySelectionMismatch":
      "This link requires {repository}.\nChoose a local folder for that GitHub repository; OpenPeek will not substitute another repository.",

    "windows.updateFailedTitle": "OpenPeek update failed",
    "windows.updateFailedStage": "Update failed",
    "windows.updateFailed": "OpenPeek could not update.",
    "windows.switchFailed": "The new version could not be activated and the fixed installation was not restored automatically.",
    "windows.backupPreserved": "The previous version backup is still available at: {path}",
    "windows.installIncomplete": "OpenPeek installation did not complete. Extract the full package and try again.",
    "windows.noPreviousInstall": "This is the first installation, so there is no previous version to restore.",
    "windows.restoredStartMenu": "The previous version was restored. Start OpenPeek again from the Start menu; you can retry the update later.",
    "windows.restoredPortable": "The previous version was restored. Double-click OpenPeek.exe in this newly extracted folder again.",
    "windows.previousAvailable": "The previous version in the fixed installation folder is still available.",
    "windows.quitRunningTitle": "Quit the running OpenPeek first",
    "windows.quitRunningDetail":
      "Another OpenPeek process is still running, so no installation files were changed.\n\nQuit the old version, then double-click OpenPeek.exe in this newly extracted folder again.",
    "windows.prepareFailedTitle": "Could not prepare OpenPeek",
    "windows.prepareFailedDetail":
      "OpenPeek could not update its fixed installation folder.\n\nQuit the running OpenPeek, then double-click this new version again.",
    "windows.startMenuShortcutDescription":
      "Open Git repositories and Markdown documents in OpenPeek.",

    "startup.configInvalidTitle": "OpenPeek settings are damaged",
    "startup.failedTitle": "OpenPeek could not start",
    "startup.configInvalidDetail":
      "OpenPeek could not read either the settings file or its backup.\n\nTo avoid overwriting repositories, appearance settings, or workspace state, the app stopped and left the existing files unchanged.",
  }),
  "zh-CN": Object.freeze({
    "dialog.openDocumentForPdf": "请先打开文档，再导出 PDF。",
    "dialog.exportPdf": "导出 PDF",
    "dialog.exportPdfFailed": "无法导出 PDF。",
    "dialog.cancel": "取消",
    "dialog.close": "关闭",
    "dialog.acknowledge": "知道了",
    "dialog.retry": "重试",
    "dialog.retrySelection": "重新选择",
    "dialog.chooseLocalRepository": "选择本机仓库…",
    "dialog.copyAgentPrompt": "复制 Agent 提示词",

    "worktree.unavailable": "所选工作树不属于当前仓库，或已经不可用。",
    "worktree.switchFailed": "无法切换工作树",

    "share.inspectMainFailed": "无法检查主工作区",
    "share.mainWrongBranch":
      "该仓库的主工作区当前位于 {branch}。\n\n分享链接只能在主工作区的 main 分支打开。请先切换回 main，再重新打开链接。",
    "share.mainMissing":
      "OpenPeek 找不到这个仓库可用的主工作区。请确认主工作区仍在本机且可以访问，再重新打开链接。",
    "share.openFailed": "无法打开分享链接",
    "share.switchPrompt": "切换到主工作区？",
    "share.switchRequired": "打开分享链接需要切换到主工作区的 main 分支。",
    "share.currentWorktree": "当前工作区：{worktree}",
    "share.otherWorktree": "其他工作区",
    "share.targetWorktree": "目标工作区：主工作区 · main",
    "share.switchAndOpen": "切换并打开",
    "share.inspectLatestMainFailed": "无法检查最新 main",
    "share.updateMainPrompt": "打开分享内容需要更新 main",
    "share.dirtyNonOverlapping": "你有 {count} 个未提交文件，但与本次更新不冲突。",
    "share.localChangesPreserved": "本地修改将被保留。",
    "share.preserveAndUpdate": "保留修改并更新",
    "share.syncRequiredPrompt": "打开分享内容需要先同步本地修改",
    "share.syncRequiredDetail": "以下文件存在本地修改，需要先提交、同步 main 并推送：",
    "share.syncAndOpen": "同步并打开",
    "share.syncNote": "打开分享链接前同步本地文件",
    "share.safeUpdateFailed": "无法安全更新 main",
    "share.worktreeNotFound": "本机尚未找到目标工作树",
    "share.repositoryNotAdded": "此仓库尚未添加到 OpenPeek",
    "share.chooseRepositoryTitle": "选择链接对应的 Git 仓库",
    "share.invalidRepository": "所选文件夹不是可用的 Git 仓库",
    "share.chooseMatchingRepository": "请选择链接对应仓库的本机目录。",
    "share.repositoryMismatch": "所选仓库与链接不匹配",
    "share.worktreeMissingFromRepository": "所选仓库中没有目标工作树",
    "share.syncFailed": "同步本地修改失败",
    "share.syncIncomplete": "Git 同步没有完成。",
    "share.fetchFailedTitle": "无法获取最新 main",
    "share.revisionMissingTitle": "分享版本已失效",
    "share.unpushedMainTitle": "main 存在尚未同步的提交",
    "share.fetchFailedDetail":
      "OpenPeek 无法从 GitHub 获取最新 main。请检查网络和 GitHub 访问状态，然后重新打开链接。",
    "share.technicalDetail": "技术信息：{detail}",
    "share.revisionMissingDetail": "origin/main 已不再包含链接中的文档版本。请联系分享者重新生成链接。",
    "share.aheadDetail": "本地主工作区有尚未推送的 commit。请先在 OpenPeek 中完成 Git 同步，再重新打开链接。",
    "share.divergedDetail": "本地主工作区与 origin/main 已经分叉。请先让 AI Agent 处理分叉并完成 Git 同步，再重新打开链接。",
    "share.unsafeDetail": "主工作区当前不满足安全打开条件。请先完成 Git 同步，再重新打开链接。",
    "share.repositoryUnknown":
      "OpenPeek 的仓库列表里还没有 {repository}。\n选择它的本机目录后，OpenPeek 会核对 GitHub origin，并继续打开当前链接。",
    "share.worktreeUnknown":
      "OpenPeek 在本机尚未找到 {repository} 的目标工作树 {worktree}。\n请选择该仓库任一工作树的本机目录，OpenPeek 会继续查找链接指定的工作树。\n如果目标工作树只存在于另一台电脑，请在创建链接的电脑上打开。",
    "share.repositorySelectionMismatch":
      "这个链接需要 {repository}。\n请选择该 GitHub 仓库的本机目录；OpenPeek 不会用其他仓库替代打开。",

    "windows.updateFailedTitle": "OpenPeek 更新失败",
    "windows.updateFailedStage": "更新失败",
    "windows.updateFailed": "OpenPeek 更新失败",
    "windows.switchFailed": "新版本切换失败，并且没有自动恢复到固定目录。",
    "windows.backupPreserved": "旧版本备份仍保留在：{path}",
    "windows.installIncomplete": "OpenPeek 安装未完成。请重新完整解压安装包后再试。",
    "windows.noPreviousInstall": "这是首次安装，固定目录中没有可恢复的旧版本。",
    "windows.restoredStartMenu": "原版本已恢复。请从开始菜单重新启动 OpenPeek，稍后可以再次更新。",
    "windows.restoredPortable": "原版本已恢复。请重新双击这个新版解压目录中的 OpenPeek.exe。",
    "windows.previousAvailable": "固定目录中的原版本仍然可用。",
    "windows.quitRunningTitle": "请先完全退出正在运行的 OpenPeek",
    "windows.quitRunningDetail":
      "检测到另一个 OpenPeek 仍在运行，因此尚未修改任何安装文件。\n\n请退出旧版本，然后重新双击这个新版解压目录中的 OpenPeek.exe。",
    "windows.prepareFailedTitle": "无法准备 OpenPeek",
    "windows.prepareFailedDetail":
      "OpenPeek 无法更新本机固定安装位置。\n\n请先退出正在运行的 OpenPeek，然后重新双击这个新版本。",
    "windows.startMenuShortcutDescription":
      "在 OpenPeek 中打开 Git 仓库和 Markdown 文档。",

    "startup.configInvalidTitle": "OpenPeek 配置文件损坏",
    "startup.failedTitle": "OpenPeek 启动失败",
    "startup.configInvalidDetail":
      "OpenPeek 检测到设置文件和备份都无法读取。\n\n为避免覆盖原有仓库、外观与工作台状态，App 已停止启动，现有文件保持不变。",
  }),
});

const APPLICATION_MESSAGES = Object.freeze({
  en: Object.freeze({
    ...DESKTOP_MESSAGES.en,
    ...MAIN_MESSAGES.en,
  }),
  "zh-CN": Object.freeze({
    ...DESKTOP_MESSAGES["zh-CN"],
    ...MAIN_MESSAGES["zh-CN"],
  }),
});

export function createApplicationTranslator(preferences = {}, options = {}) {
  return createTranslator(
    APPLICATION_MESSAGES,
    resolveDesktopLanguage(preferences, options),
  );
}

export function localizedAboutPanelCopyright(buildInfo, preferences = {}, options = {}) {
  return aboutPanelCopyright(buildInfo, {
    language: createApplicationTranslator(preferences, options).locale,
  });
}

export function windowsStartMenuShortcutOptions(
  executable,
  preferences = {},
  options = {},
) {
  const translate = createApplicationTranslator(preferences, options);
  return {
    target: executable,
    description: translate("windows.startMenuShortcutDescription"),
    icon: executable,
    iconIndex: 0,
  };
}

export function localizeDesktopHomeError(state, preferences = {}, options = {}) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return "";
  }
  const translate = createApplicationTranslator(preferences, options);
  switch (state.kind) {
    case "repository-selection":
      return repositorySelectionErrorMessage(state.path, state.error, {
        language: translate.locale,
      });
    case "startup-repository":
      return startupRepositoryErrorMessage(state.path, state.error, {
        language: translate.locale,
      });
    case "repository-identity-not-found":
      return translate("share.repositoryUnknown", {
        repository: state.repository,
      });
    case "repository-worktree-not-found":
      return translate("share.worktreeUnknown", {
        repository: state.repository,
        worktree: state.worktree,
      });
    default:
      return "";
  }
}
