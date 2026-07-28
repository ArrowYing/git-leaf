const WINDOWS_INSTALL_PROGRESS_MESSAGES = Object.freeze({
  en: Object.freeze({
    "action.update": "Update",
    "action.start": "Start",
    "action.install": "Setup",
    "heading.update": "Updating Git Leaf{version}",
    "heading.start": "Starting Git Leaf{version}",
    "heading.install": "Preparing Git Leaf{version}",
    message: "Please wait. Git Leaf will finish automatically and reopen.",
    stage: "Starting…",
  }),
  "zh-CN": Object.freeze({
    "action.update": "更新",
    "action.start": "启动",
    "action.install": "准备",
    "heading.update": "正在更新 Git Leaf{version}",
    "heading.start": "正在启动 Git Leaf{version}",
    "heading.install": "正在准备 Git Leaf{version}",
    message: "请稍候，Git Leaf 会自动完成并重新打开。",
    stage: "正在开始…",
  }),
});

export function windowsInstallProgressHtml({
  version = "",
  mode = "update",
  language = "en",
  locale,
} = {}) {
  const resolvedLocale = resolveWindowsInstallProgressLocale(locale ?? language);
  const translate = createWindowsInstallProgressTranslator(resolvedLocale);
  const actionKey = mode === "update"
    ? "update"
    : ["redirect", "outdated"].includes(mode)
      ? "start"
      : "install";
  const versionLabel = version ? ` ${escapeHtml(version)}` : "";
  return `<!doctype html>
<html lang="${resolvedLocale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <title>Git Leaf ${translate(`action.${actionKey}`)}</title>
  <style>
    :root { color-scheme: light; font-family: "Segoe UI", system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      color: #172033;
      background: linear-gradient(145deg, #f8fafc 0%, #eef3f8 100%);
      -webkit-user-select: none;
    }
    main { width: 100%; padding: 29px 38px 31px; }
    .brand { display: flex; align-items: center; gap: 11px; margin-bottom: 23px; }
    .leaf {
      width: 30px; height: 30px; border-radius: 9px;
      display: grid; place-items: center;
      color: white; background: #247552;
      font-size: 18px; font-weight: 700;
      box-shadow: 0 6px 18px rgba(36, 117, 82, .2);
    }
    .name { font-size: 15px; font-weight: 650; letter-spacing: .01em; }
    h1 { margin: 0 0 9px; font-size: 22px; line-height: 1.35; font-weight: 680; }
    .message { margin: 0 0 12px; color: #5a6577; font-size: 14px; line-height: 1.55; }
    .detail {
      margin: 0 0 20px; padding: 9px 11px;
      border-radius: 8px; border-left: 3px solid #5a9c7b;
      color: #3f5e50; background: #e8f2ed;
      font-size: 13px; line-height: 1.45;
    }
    .detail[hidden] { display: none; }
    .track {
      position: relative; height: 9px; overflow: hidden;
      border-radius: 999px; background: #dce4ec;
      box-shadow: inset 0 1px 2px rgba(15, 23, 42, .08);
    }
    .bar {
      width: 3%; height: 100%; border-radius: inherit;
      background: linear-gradient(90deg, #2b8a60, #43a878);
      transition: width 320ms ease;
    }
    .meta { display: flex; justify-content: space-between; margin-top: 9px; color: #7a8494; font-size: 12px; }
    body[data-phase="complete"] .bar { background: #247552; }
    body[data-phase="redirect"] .bar { background: #247552; }
    body[data-phase="outdated"] .bar { background: #b26a18; }
    body[data-phase="error"] .bar { background: #c43d4f; }
  </style>
</head>
<body data-phase="starting">
  <main>
    <div class="brand"><div class="leaf">L</div><div class="name">Git Leaf</div></div>
    <h1 id="title">${translate(`heading.${actionKey}`, { version: versionLabel })}</h1>
    <p class="message" id="message">${translate("message")}</p>
    <p class="detail" id="detail" hidden></p>
    <div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="3">
      <div class="bar" id="bar"></div>
    </div>
    <div class="meta"><span id="stage">${translate("stage")}</span><span id="percent">3%</span></div>
  </main>
  <script>
    window.updateInstallProgress = (state) => {
      const percent = Math.max(0, Math.min(100, Number(state.percent) || 0));
      document.body.dataset.phase = state.phase || "working";
      document.getElementById("title").textContent = state.title || "Git Leaf";
      document.getElementById("message").textContent = state.message || "";
      const detail = document.getElementById("detail");
      detail.textContent = state.detail || "";
      detail.hidden = !state.detail;
      document.getElementById("stage").textContent = state.stage || state.message || "";
      document.getElementById("percent").textContent = percent + "%";
      document.getElementById("bar").style.width = percent + "%";
      document.querySelector(".track").setAttribute("aria-valuenow", String(percent));
    };
  </script>
</body>
</html>`;
}

function createWindowsInstallProgressTranslator(locale) {
  const messages = WINDOWS_INSTALL_PROGRESS_MESSAGES[locale];
  return (key, replacements = {}) => {
    const template = messages[key] ?? WINDOWS_INSTALL_PROGRESS_MESSAGES.en[key] ?? key;
    return template.replace(/\{([a-zA-Z]+)\}/g, (_match, name) => (
      replacements[name] == null ? "" : String(replacements[name])
    ));
  };
}

function resolveWindowsInstallProgressLocale(locale) {
  return String(locale || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
