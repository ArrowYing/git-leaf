(() => {
  "use strict";

  const api = window.gitLeafSettings;
  const sections = new Set(["appearance", "files", "help", "shortcuts", "status"]);
  const navigation = document.querySelector("#settings-navigation");
  const helpNavigation = document.querySelector("#help-navigation");
  const content = document.querySelector("#settings-content");
  const backButton = document.querySelector("#settings-back");
  const fontSizeInput = document.querySelector("#document-font-size");
  const fontSizeOutput = document.querySelector("#document-font-size-value");
  const helpSections = document.querySelector("#help-sections");
  const shortcutGroups = document.querySelector("#shortcut-groups");
  const appStatus = document.querySelector("#app-status");
  const environmentStatus = document.querySelector("#environment-status");
  const repositoryStatus = document.querySelector("#repository-status");
  const updateActions = document.querySelector(".status-actions");
  const checkForUpdatesButton = document.querySelector("#check-for-updates");
  const updateCheckResult = document.querySelector("#update-check-result");
  const errorBox = document.querySelector("#settings-error");
  const saveStatus = document.querySelector("#settings-save-status");
  const systemColorQuery = window.matchMedia("(prefers-color-scheme: dark)");
  let currentSection = "appearance";
  let currentPreferences = {};
  let applyingModel = false;
  let saveGeneration = 0;
  let helpScrollFrame = 0;

  navigation.addEventListener("click", handleNavigationClick);
  helpNavigation.addEventListener("click", handleHelpNavigationClick);
  content.addEventListener("scroll", handleHelpContentScroll, { passive: true });
  backButton.addEventListener("click", closeSettingsCenter);
  document.addEventListener("keydown", handleSettingsKeydown, true);
  document.addEventListener("change", handlePreferenceChange);
  document.addEventListener("click", handleExternalLinkClick);
  fontSizeInput.addEventListener("input", updateFontSizeOutput);
  systemColorQuery.addEventListener?.("change", handleSystemColorChange);

  if (!api) {
    showError("设置中心只能在 Git Leaf 桌面版中使用。");
    return;
  }

  checkForUpdatesButton.addEventListener("click", checkForUpdates);
  api.onShow((payload) => {
    if (payload?.model) {
      applyModel(payload.model);
    }
    if (payload?.status) {
      renderStatus(payload.status);
    }
    if (payload?.section) {
      showSection(payload.section);
    }
  });

  async function loadModel() {
    try {
      applyModel(await api.getModel());
    } catch (error) {
      showError(errorMessage(error, "无法读取 Git Leaf 设置。"));
    }
  }

  function applyModel(model = {}) {
    applyingModel = true;
    try {
      currentPreferences = isRecord(model.preferences) ? { ...model.preferences } : {};
      setRadioValue("colorMode", currentPreferences.colorMode || "system");
      setRadioValue("documentFont", currentPreferences.documentFont || "system-sans");
      setRadioValue("fileTreeMode", currentPreferences.fileTreeMode || "content");
      const fontSize = integerInRange(currentPreferences.documentFontSize, 14, 22, 16);
      fontSizeInput.value = String(fontSize);
      updateFontSizeOutput();
      applyAppearance(currentPreferences);
      renderHelp(model.helpSections);
      renderShortcuts(model.shortcutGroups);
      renderStatus(model.status);
      hideError();
    } finally {
      applyingModel = false;
    }
  }

  function showSection(value) {
    currentSection = sections.has(value) ? value : "appearance";
    for (const button of navigation.querySelectorAll("[data-section]")) {
      if (button.dataset.section === currentSection) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    }
    for (const panel of document.querySelectorAll("[data-section-panel]")) {
      panel.hidden = panel.dataset.sectionPanel !== currentSection;
    }
    helpNavigation.hidden = currentSection !== "help";
    content.scrollTop = 0;
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-section-panel="${currentSection}"] h1`)?.focus?.({
        preventScroll: true,
      });
      content.focus({ preventScroll: true });
      updateActiveHelpNavigation();
    });
  }

  function handleNavigationClick(event) {
    const button = event.target.closest?.("[data-section]");
    if (button) {
      showSection(button.dataset.section);
    }
  }

  function handleSettingsKeydown(event) {
    if (event.isComposing || event.altKey) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSettingsCenter();
      return;
    }

    const primary = event.metaKey || event.ctrlKey;
    if (!primary) {
      return;
    }
    if (!event.shiftKey && event.key === ",") {
      event.preventDefault();
      event.stopPropagation();
      showSection("appearance");
      return;
    }
    if (event.code === "Slash" || event.key === "/" || event.key === "?") {
      event.preventDefault();
      event.stopPropagation();
      showSection("shortcuts");
    }
  }

  function closeSettingsCenter() {
    void api.close().catch((error) => {
      showError(errorMessage(error, "无法返回工作台。"));
    });
  }

  async function checkForUpdates() {
    checkForUpdatesButton.disabled = true;
    updateCheckResult.textContent = "正在检查更新…";
    try {
      const response = await api.checkForUpdates();
      updateCheckResult.textContent = updateResultMessage(response?.result);
    } catch (error) {
      updateCheckResult.textContent = "检查更新失败";
      showError(errorMessage(error, "检查更新失败。"));
    } finally {
      checkForUpdatesButton.disabled = false;
    }
  }

  function handlePreferenceChange(event) {
    if (applyingModel) {
      return;
    }
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    let patch = null;
    if (input.type === "radio" && ["colorMode", "documentFont", "fileTreeMode"].includes(input.name)) {
      patch = { [input.name]: input.value };
    } else if (input.id === "document-font-size") {
      patch = { documentFontSize: Number.parseInt(input.value, 10) };
    }
    if (!patch) {
      return;
    }

    currentPreferences = { ...currentPreferences, ...patch };
    applyAppearance(currentPreferences);
    void savePreferencePatch(patch);
  }

  async function savePreferencePatch(patch) {
    const generation = ++saveGeneration;
    saveStatus.textContent = "正在保存…";
    try {
      const result = await api.updatePreferences(patch);
      if (generation !== saveGeneration) {
        return;
      }
      if (isRecord(result?.preferences)) {
        currentPreferences = { ...result.preferences };
      }
      saveStatus.textContent = result?.ok === false ? "未保存" : "已保存";
      window.setTimeout(() => {
        if (generation === saveGeneration) {
          saveStatus.textContent = "";
        }
      }, 1200);
    } catch (error) {
      if (generation !== saveGeneration) {
        return;
      }
      saveStatus.textContent = "保存失败";
      showError(errorMessage(error, "设置保存失败。"));
      await loadModel();
    }
  }

  function applyAppearance(preferences) {
    const colorMode = preferences.colorMode || "system";
    const effectiveTheme = colorMode === "system"
      ? systemColorQuery.matches ? "dark" : "light"
      : colorMode;
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.dataset.colorMode = colorMode;
    document.documentElement.dataset.documentFont = preferences.documentFont || "system-sans";
  }

  function handleSystemColorChange() {
    if ((currentPreferences.colorMode || "system") === "system") {
      applyAppearance(currentPreferences);
    }
  }

  function updateFontSizeOutput() {
    fontSizeOutput.textContent = `${fontSizeInput.value} px`;
  }

  function renderHelp(value) {
    helpSections.replaceChildren();
    const sectionsToRender = Array.isArray(value) ? value : [];
    renderHelpNavigation(sectionsToRender);
    if (sectionsToRender.length === 0) {
      helpSections.append(emptyCard("暂无帮助内容。"));
      return;
    }

    sectionsToRender.forEach((section, index) => {
      const articleSection = document.createElement("section");
      articleSection.className = "help-document-section";
      articleSection.id = helpSectionTarget(section, index);
      const title = document.createElement("h2");
      title.textContent = stringValue(section?.title, "帮助");
      articleSection.append(title);
      const paragraphs = Array.isArray(section?.body) ? section.body : [];
      for (const paragraphValue of paragraphs) {
        const paragraph = document.createElement("p");
        paragraph.textContent = stringValue(paragraphValue);
        articleSection.append(paragraph);
      }
      if (Array.isArray(section?.fileTypes)) {
        articleSection.append(renderHelpFileTable(section.fileTypes));
      }
      appendLinks(articleSection, section?.links);
      helpSections.append(articleSection);
    });
    window.requestAnimationFrame(updateActiveHelpNavigation);
  }

  function renderHelpNavigation(value) {
    helpNavigation.replaceChildren();
    const sectionsToRender = Array.isArray(value) ? value : [];
    sectionsToRender.forEach((section, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.helpTarget = helpSectionTarget(section, index);
      button.textContent = stringValue(section?.title, "帮助");
      helpNavigation.append(button);
    });
  }

  function handleHelpNavigationClick(event) {
    const button = event.target.closest?.("[data-help-target]");
    if (!button) {
      return;
    }
    const target = document.getElementById(button.dataset.helpTarget);
    if (!target) {
      return;
    }
    setActiveHelpNavigation(button.dataset.helpTarget);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleHelpContentScroll() {
    if (currentSection !== "help" || helpScrollFrame) {
      return;
    }
    helpScrollFrame = window.requestAnimationFrame(() => {
      helpScrollFrame = 0;
      updateActiveHelpNavigation();
    });
  }

  function updateActiveHelpNavigation() {
    if (currentSection !== "help") {
      return;
    }
    const buttons = [...helpNavigation.querySelectorAll("[data-help-target]")];
    if (buttons.length === 0) {
      return;
    }
    const remainingScroll = content.scrollHeight - content.scrollTop - content.clientHeight;
    if (remainingScroll <= 2) {
      setActiveHelpNavigation(buttons.at(-1).dataset.helpTarget);
      return;
    }
    const threshold = content.getBoundingClientRect().top + 88;
    let activeTarget = buttons[0].dataset.helpTarget;
    for (const button of buttons) {
      const section = document.getElementById(button.dataset.helpTarget);
      if (section && section.getBoundingClientRect().top <= threshold) {
        activeTarget = button.dataset.helpTarget;
      }
    }
    setActiveHelpNavigation(activeTarget);
  }

  function setActiveHelpNavigation(target) {
    for (const button of helpNavigation.querySelectorAll("[data-help-target]")) {
      if (button.dataset.helpTarget === target) {
        button.setAttribute("aria-current", "location");
      } else {
        button.removeAttribute("aria-current");
      }
    }
  }

  function renderHelpFileTable(rowsValue) {
    const wrapper = document.createElement("div");
    wrapper.className = "help-file-table-wrap";
    const table = document.createElement("table");
    table.className = "help-file-table";
    const head = document.createElement("thead");
    const headingRow = document.createElement("tr");
    for (const heading of ["文件类型", "内容模式", "打开方式"]) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = heading;
      headingRow.append(cell);
    }
    head.append(headingRow);
    const body = document.createElement("tbody");
    for (const rowValue of Array.isArray(rowsValue) ? rowsValue : []) {
      const row = document.createElement("tr");
      for (const value of [rowValue?.files, rowValue?.visibility, rowValue?.behavior]) {
        const cell = document.createElement("td");
        cell.textContent = stringValue(value);
        row.append(cell);
      }
      body.append(row);
    }
    table.append(head, body);
    wrapper.append(table);
    return wrapper;
  }

  function helpSectionTarget(section, index) {
    const explicitId = stringValue(section?.id)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `help-${explicitId || index + 1}`;
  }

  function renderShortcuts(value) {
    shortcutGroups.replaceChildren();
    const groups = Array.isArray(value) ? value : [];
    if (groups.length === 0) {
      shortcutGroups.append(emptyCard("暂无快捷键内容。"));
      return;
    }

    for (const group of groups) {
      const section = document.createElement("section");
      section.className = "shortcut-group";
      const title = document.createElement("h2");
      title.textContent = stringValue(group?.title, "快捷键");
      section.append(title);
      const list = document.createElement("div");
      list.className = "shortcut-list";
      for (const shortcut of Array.isArray(group?.shortcuts) ? group.shortcuts : []) {
        const row = document.createElement("div");
        row.className = "shortcut-row";
        const keys = document.createElement("kbd");
        keys.textContent = stringValue(shortcut?.keys);
        const action = document.createElement("span");
        action.textContent = stringValue(shortcut?.action);
        row.append(keys, action);
        list.append(row);
      }
      section.append(list);
      shortcutGroups.append(section);
    }
  }

  function renderStatus(value) {
    const status = isRecord(value) ? value : {};
    updateActions.hidden = status.updatesEnabled !== true;
    renderStatusBlock(appStatus, "应用", status.app || status.application, "暂无应用版本信息。");
    renderStatusBlock(
      environmentStatus,
      "运行环境",
      status.environment || status.checks,
      "暂无环境检查信息。",
    );
    renderStatusBlock(
      repositoryStatus,
      "当前仓库",
      status.repository,
      "当前没有打开仓库。",
    );
  }

  function renderStatusBlock(container, titleValue, value, emptyMessage) {
    container.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = titleValue;
    container.append(title);
    const rows = statusRows(value);
    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-card";
      empty.textContent = emptyMessage;
      container.append(empty);
      return;
    }

    const list = document.createElement("dl");
    list.className = "status-list";
    for (const rowValue of rows) {
      const row = document.createElement("div");
      row.className = "status-row";
      const label = document.createElement("dt");
      label.textContent = rowValue.label;
      const detail = document.createElement("dd");
      detail.className = "status-value";
      if (rowValue.status) {
        detail.dataset.status = rowValue.status;
      }
      if (rowValue.url) {
        const link = document.createElement("a");
        link.className = "status-link";
        link.href = rowValue.url;
        link.textContent = rowValue.value;
        detail.append(link);
      } else {
        detail.textContent = rowValue.value;
      }
      row.append(label, detail);
      list.append(row);
    }
    container.append(list);
  }

  function statusRows(value) {
    if (Array.isArray(value)) {
      return value.map((item, index) => statusRow(item, String(index + 1))).filter(Boolean);
    }
    if (!isRecord(value)) {
      return [];
    }
    return Object.entries(value).map(([key, item]) => statusRow(item, key)).filter(Boolean);
  }

  function statusRow(value, fallbackLabel) {
    if (isRecord(value)) {
      const label = stringValue(value.label || value.title || value.name || fallbackLabel);
      const detail = stringValue(value.message || value.value || value.detail || value.status);
      if (!label || !detail) {
        return null;
      }
      return {
        label,
        value: detail,
        status: normalizedStatus(value.status),
        url: externalUrl(value.url),
      };
    }
    const detail = stringValue(value);
    return detail ? { label: humanizeKey(fallbackLabel), value: detail, status: "", url: "" } : null;
  }

  function appendLinks(container, value) {
    for (const linkValue of Array.isArray(value) ? value : []) {
      const url = externalUrl(linkValue?.url);
      if (!url) {
        continue;
      }
      const paragraph = document.createElement("p");
      const link = document.createElement("a");
      link.className = "status-link";
      link.href = url;
      link.textContent = stringValue(linkValue?.label, url);
      paragraph.append(link);
      container.append(paragraph);
    }
  }

  function handleExternalLinkClick(event) {
    const link = event.target.closest?.("a[href]");
    if (!link) {
      return;
    }
    const url = externalUrl(link.href);
    event.preventDefault();
    if (!url) {
      return;
    }
    void api.openExternal(url).catch((error) => {
      showError(errorMessage(error, "无法打开链接。"));
    });
  }

  function setRadioValue(name, value) {
    const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) {
      input.checked = true;
    }
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function hideError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  function emptyCard(message) {
    const element = document.createElement("div");
    element.className = "empty-card";
    element.textContent = message;
    return element;
  }

  function normalizedStatus(value) {
    const status = String(value ?? "").trim().toLowerCase();
    if (["ok", "success", "ready"].includes(status)) {
      return "ok";
    }
    if (["warn", "warning"].includes(status)) {
      return "warning";
    }
    if (["error", "failed", "blocked"].includes(status)) {
      return "error";
    }
    return "";
  }

  function externalUrl(value) {
    try {
      const url = new URL(String(value ?? ""));
      return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function humanizeKey(value) {
    return String(value ?? "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[-_]+/g, " ")
      .replace(/^./, (character) => character.toUpperCase());
  }

  function integerInRange(value, min, max, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
  }

  function stringValue(value, fallback = "") {
    const string = String(value ?? "").trim();
    return string || fallback;
  }

  function errorMessage(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  function updateResultMessage(value) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (isRecord(value) && typeof value.message === "string" && value.message.trim()) {
      return value.message.trim();
    }
    const state = isRecord(value) ? String(value.state ?? "").trim().toLowerCase() : "";
    switch (state) {
      case "current":
        return "Git Leaf 已经是最新版本。";
      case "available":
        return "发现可用更新。";
      case "downloading":
        return "正在下载更新…";
      case "error":
        return "检查更新失败。";
      default:
        return "检查已开始。";
    }
  }

  function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }
})();
