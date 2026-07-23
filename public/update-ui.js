export function sidebarUpdateView(status = {}) {
  const version = String(status?.version || "").trim();
  const title = version ? `Git Leaf ${version}` : "Git Leaf 新版本";
  if (status?.state === "available") {
    return {
      hidden: false,
      title,
      detail: "新版本可用，点击后下载",
      actionLabel: "更新",
      actionDisabled: false,
    };
  }
  if (status?.state === "downloading" || status?.state === "preparing") {
    return {
      hidden: false,
      title,
      detail: "正在下载并准备新版本…",
      actionLabel: "",
      actionDisabled: true,
    };
  }
  if (status?.state === "downloaded") {
    return {
      hidden: false,
      title,
      detail: "已准备好，退出后自动安装",
      actionLabel: "立即重启",
      actionDisabled: false,
    };
  }
  if (status?.state === "error" && version) {
    return {
      hidden: false,
      title,
      detail: "更新未完成，点击重试",
      actionLabel: "重试",
      actionDisabled: false,
    };
  }
  return { hidden: true };
}
