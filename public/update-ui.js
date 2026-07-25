import { createTranslator } from "./i18n.js";
import { WORKBENCH_MESSAGES } from "./workbench-locales.js";

export function sidebarUpdateView(status = {}, locale = "zh-CN") {
  const t = createTranslator(WORKBENCH_MESSAGES, locale);
  const version = String(status?.version || "").trim();
  const title = version ? `Git Leaf ${version}` : t("update.newVersion");
  if (status?.state === "available") {
    return {
      hidden: false,
      title,
      detail: t("update.availableDetail"),
      actionLabel: t("update.action"),
      actionDisabled: false,
    };
  }
  if (status?.state === "downloading" || status?.state === "preparing") {
    return {
      hidden: false,
      title,
      detail: t("update.preparingDetail"),
      actionLabel: "",
      actionDisabled: true,
    };
  }
  if (status?.state === "downloaded") {
    return {
      hidden: false,
      title,
      detail: t("update.readyDetail"),
      actionLabel: t("update.restart"),
      actionDisabled: false,
    };
  }
  if (status?.state === "error" && version) {
    return {
      hidden: false,
      title,
      detail: t("update.retryDetail"),
      actionLabel: t("action.retry"),
      actionDisabled: false,
    };
  }
  return { hidden: true };
}
