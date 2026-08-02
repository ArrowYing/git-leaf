const DATASET_SELECTOR = "[data-mdx-dataset-view]";
const DATASET_MESSAGES = Object.freeze({
  en: Object.freeze({
    loading: "Loading dataset…",
    error: "Failed to load dataset.",
    rows: "{matched} of {total} source rows",
    through: "data through {date}",
    range: "{from} to {to}",
    missing: "{count} expected source periods are missing; missing periods were not filled with zero.",
    partial: "{count} displayed periods are partial.",
    omittedBoundary: "Incomplete boundary periods omitted: {count}.",
  }),
  "zh-CN": Object.freeze({
    loading: "正在加载数据集……",
    error: "数据集加载失败。",
    rows: "命中 {matched}／{total} 条源数据",
    through: "数据更新至 {date}",
    range: "{from} 至 {to}",
    missing: "缺少 {count} 个预期源数据周期；缺失周期未按 0 填充。",
    partial: "当前有 {count} 个不完整周期。",
    omittedBoundary: "已省略 {count} 个不完整的边界周期。",
  }),
});

export function attachDatasetViews(
  root,
  {
    getContext = () => ({}),
    selections = new Map(),
    onRendered = () => {},
  } = {},
) {
  if (!root?.querySelectorAll) {
    return { hydrate: () => {}, destroy: () => {} };
  }

  const requests = new WeakMap();
  const hydrate = (scope = root) => {
    for (const view of datasetViewsWithin(scope)) {
      if (view.dataset.datasetHydrated === "true") continue;
      view.dataset.datasetHydrated = "true";
      const context = getContext(view) ?? {};
      const request = requestFromView(view);
      if (!request) {
        renderError(view, localized(context.locale, "error"));
        continue;
      }
      const key = datasetSelectionKey(view, context);
      const remembered = selections.get(key);
      const granularity = view.dataset.datasetDefaultGranularity || "auto";
      void runDatasetQuery(view, request, granularity, {
        context,
        key,
        selections,
        requests,
        onRendered,
        desiredGranularity: remembered,
      });
    }
  };

  const handleClick = (event) => {
    const button = event.target?.closest?.("[data-dataset-granularity]");
    const view = button?.closest?.(DATASET_SELECTOR);
    if (!button || !view || !root.contains(view)) return;
    event.preventDefault();
    event.stopPropagation();
    const request = requestFromView(view);
    const context = getContext(view) ?? {};
    if (!request) {
      renderError(view, localized(context.locale, "error"));
      return;
    }
    const granularity = button.dataset.datasetGranularity;
    const key = datasetSelectionKey(view, context);
    selections.set(key, granularity);
    void runDatasetQuery(view, request, granularity, {
      context,
      key,
      selections,
      requests,
      onRendered,
    });
  };

  const observer = typeof MutationObserver === "function"
    ? new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) hydrate(node);
          }
        }
      })
    : null;
  root.addEventListener("click", handleClick);
  observer?.observe(root, { childList: true, subtree: true });
  hydrate();

  return {
    hydrate,
    destroy() {
      observer?.disconnect();
      root.removeEventListener("click", handleClick);
    },
  };
}

export function datasetSelectionKey(view, context = {}) {
  const sourceBlock = view.closest?.("[data-source-start]");
  const liveBlock = view.closest?.("[data-live-block-start]");
  const sourceLine = sourceBlock?.dataset.sourceStart || liveBlock?.dataset.liveBlockStart || "0";
  return [
    context.repo || "",
    context.file || "",
    sourceLine,
    view.dataset.datasetRequest || "",
  ].join("|");
}

async function runDatasetQuery(
  view,
  request,
  granularity,
  {
    context,
    key,
    selections,
    requests,
    onRendered,
    desiredGranularity = "",
  },
) {
  const requestId = (requests.get(view)?.requestId ?? 0) + 1;
  requests.set(view, { requestId });
  setLoading(view, granularity, localized(context.locale, "loading"));

  try {
    const response = await fetch(datasetQueryUrl(context), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, granularity }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || localized(context.locale, "error"));
    }
    if (requests.get(view)?.requestId !== requestId || !view.isConnected) return;
    const availableGranularities = normalizedAvailableGranularities(payload.meta);
    const resolvedGranularity = String(payload.meta?.granularity || "");
    if (!availableGranularities.includes(resolvedGranularity)) {
      throw new Error(localized(context.locale, "error"));
    }
    constrainGranularityButtons(view, availableGranularities);
    if (
      desiredGranularity
      && desiredGranularity !== resolvedGranularity
      && availableGranularities.includes(desiredGranularity)
    ) {
      void runDatasetQuery(view, request, desiredGranularity, {
        context,
        key,
        selections,
        requests,
        onRendered,
      });
      return;
    }
    const result = view.querySelector("[data-dataset-result]");
    if (!result) return;
    result.innerHTML = payload.html || "";
    result.append(renderMeta(payload.meta ?? {}, context.locale));
    view.classList.remove("is-loading");
    view.setAttribute("aria-busy", "false");
    selections.set(key, resolvedGranularity);
    setButtons(view, resolvedGranularity, false);
    const controls = view.querySelector(".mdx-dataset-controls");
    if (controls) controls.hidden = false;
    onRendered(result, payload);
  } catch (error) {
    if (requests.get(view)?.requestId !== requestId || !view.isConnected) return;
    renderError(
      view,
      error instanceof Error && error.message ? error.message : localized(context.locale, "error"),
    );
  }
}

function normalizedAvailableGranularities(meta) {
  const supported = new Set(["day", "week", "month", "quarter"]);
  if (!Array.isArray(meta?.availableGranularities)) return [];
  return [...new Set(meta.availableGranularities)].filter((value) => supported.has(value));
}

export function constrainGranularityButtons(view, availableGranularities) {
  const available = new Set(availableGranularities);
  for (const button of view.querySelectorAll("[data-dataset-granularity]")) {
    if (!available.has(button.dataset.datasetGranularity)) {
      button.remove();
    }
  }
}

function requestFromView(view) {
  try {
    const request = JSON.parse(decodeURIComponent(view.dataset.datasetRequest || ""));
    if (!request || typeof request !== "object" || Array.isArray(request)) return null;
    return request;
  } catch {
    return null;
  }
}

function datasetQueryUrl(context) {
  const url = new URL("/api/dataset-query", globalThis.location?.origin || "http://127.0.0.1");
  if (context.repo) url.searchParams.set("repo", context.repo);
  if (context.file) url.searchParams.set("file", context.file);
  if (context.locale) url.searchParams.set("locale", context.locale);
  return `${url.pathname}${url.search}`;
}

function setLoading(view, granularity, message) {
  view.classList.add("is-loading");
  view.setAttribute("aria-busy", "true");
  setButtons(view, granularity, true);
  const result = view.querySelector("[data-dataset-result]");
  if (result && !result.querySelector(".mdx-component")) {
    result.replaceChildren(messageElement("mdx-dataset-loading", message));
  }
}

function setButtons(view, granularity, disabled) {
  for (const button of view.querySelectorAll("[data-dataset-granularity]")) {
    const active = button.dataset.datasetGranularity === granularity;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = disabled;
  }
}

function renderError(view, message) {
  const result = view.querySelector("[data-dataset-result]");
  if (result) {
    result.replaceChildren(messageElement("mdx-component-error", message));
  }
  view.classList.remove("is-loading");
  view.setAttribute("aria-busy", "false");
  const active = view.querySelector("[data-dataset-granularity].is-active")?.dataset.datasetGranularity;
  setButtons(view, active, false);
}

function renderMeta(meta, locale) {
  const container = document.createElement("div");
  container.className = "mdx-dataset-meta";
  const details = document.createElement("p");
  details.className = "mdx-dataset-meta-details";
  details.textContent = [
    meta.datasetTitle || meta.datasetId || meta.sourcePath,
    meta.from && meta.to ? localized(locale, "range", { from: meta.from, to: meta.to }) : "",
    Number.isFinite(meta.sourceRows) && Number.isFinite(meta.totalRows)
      ? localized(locale, "rows", { matched: meta.sourceRows, total: meta.totalRows })
      : "",
    meta.dataThrough ? localized(locale, "through", { date: meta.dataThrough }) : "",
  ].filter(Boolean).join(" · ");
  container.append(details);

  const warnings = datasetWarningMessages(meta, locale);
  if (warnings.length > 0) {
    const warning = document.createElement("p");
    warning.className = "mdx-dataset-warning";
    warning.textContent = warnings.join(" ");
    container.append(warning);
  }
  return container;
}

export function datasetWarningMessages(meta = {}, locale) {
  const warnings = [];
  const missingPeriodCount = Number.isFinite(meta.missingPeriodCount)
    ? meta.missingPeriodCount
    : meta.missingDateCount;
  if (missingPeriodCount > 0) {
    warnings.push(localized(locale, "missing", { count: missingPeriodCount }));
  }
  if (meta.partialPeriodCount > 0) {
    warnings.push(localized(locale, "partial", { count: meta.partialPeriodCount }));
  }
  if (meta.omittedBoundaryPeriodCount > 0) {
    warnings.push(localized(locale, "omittedBoundary", {
      count: meta.omittedBoundaryPeriodCount,
    }));
  }
  return warnings;
}

function localized(locale, key, replacements = {}) {
  const resolved = locale === "zh-CN" ? "zh-CN" : "en";
  const template = DATASET_MESSAGES[resolved][key] || DATASET_MESSAGES.en[key] || key;
  return template.replace(/\{([a-zA-Z]+)\}/g, (_match, name) => (
    replacements[name] === undefined ? "" : String(replacements[name])
  ));
}

function messageElement(className, message) {
  const element = document.createElement("p");
  element.className = className;
  element.textContent = message;
  return element;
}

function datasetViewsWithin(scope) {
  const views = [];
  if (scope.matches?.(DATASET_SELECTOR)) views.push(scope);
  views.push(...(scope.querySelectorAll?.(DATASET_SELECTOR) ?? []));
  return views;
}
