const RESULT_VALUES = ["success", "cancel", "error"];
const DEEP_LINK_FAILURE_REASONS = [
  "repository_not_known",
  "worktree_not_found",
  "repository_selection_invalid",
  "repository_identity_mismatch",
  "repository_open_failed",
  "main_worktree_check_failed",
  "main_worktree_unavailable",
  "primary_not_main",
  "fetch_failed",
  "revision_missing",
  "main_ahead",
  "main_diverged",
  "sync_failed",
  "safe_update_failed",
  "document_open_failed",
  "unknown",
];
const RENDERER_FEATURE_DIMENSIONS = new Map([
  ["navigation.file_search", {}],
  ["navigation.document_search", {}],
  ["navigation.frontmatter_filter", {
    action: ["apply", "clear"],
    filter_count_bucket: ["1", "2_3", "4_plus"],
  }],
  ["navigation.worktree_switch", { result: RESULT_VALUES }],
  ["navigation.deep_link", {
    type: ["repository", "exact_worktree"],
    result: RESULT_VALUES,
    failure_reason: DEEP_LINK_FAILURE_REASONS,
  }],
  ["editing.activity", { mode: ["source", "live"] }],
  ["editing.slash_command", {
    command_category: ["markdown", "mdx_component", "media"],
  }],
  ["editing.frontmatter", {
    action: ["add", "edit", "delete"],
    result: RESULT_VALUES,
  }],
  ["editing.image_paste", { result: RESULT_VALUES }],
  ["editing.markdown_to_mdx", { result: RESULT_VALUES }],
  ["output.pdf_export", { result: RESULT_VALUES }],
  ["git.sync", {
    strategy: ["guarded_live_v1"],
    result: RESULT_VALUES,
    file_count_bucket: ["1", "2_5", "6_20", "21_plus"],
    drift_kind: ["none", "content_changed", "head_changed", "post_commit_changed"],
    retry_bucket: ["0", "1", "2_plus"],
    duration_bucket: ["under_1s", "1_3s", "3_10s", "over_10s"],
    error_code: [
      "identity_missing",
      "origin_missing",
      "conflict",
      "nothing_selected",
      "commit_failed",
      "workspace_changed",
      "head_changed",
      "pull_failed",
      "push_failed",
      "unknown",
    ],
  }],
  ["github.open", { result: RESULT_VALUES }],
  ["line_reference.copy", { line_count_bucket: ["1", "2_5", "6_plus"] }],
]);
const RENDERER_MODES = new Set(["preview", "source", "live"]);

export function normalizeRendererTelemetryAction(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    return null;
  }
  if (action.kind === "mode") {
    return exactKeys(action, ["kind", "mode"]) && RENDERER_MODES.has(action.mode)
      ? { kind: "mode", mode: action.mode }
      : null;
  }
  if (action.kind !== "feature" || !exactKeys(action, ["kind", "featureId", "dimensions"])) {
    return null;
  }
  const allowed = RENDERER_FEATURE_DIMENSIONS.get(action.featureId);
  const dimensions = action.dimensions ?? {};
  if (!allowed || !dimensions || typeof dimensions !== "object" || Array.isArray(dimensions)) {
    return null;
  }
  const normalizedDimensions = {};
  for (const key of Object.keys(dimensions).sort()) {
    if (!Object.hasOwn(allowed, key) || !allowed[key].includes(dimensions[key])) {
      return null;
    }
    normalizedDimensions[key] = dimensions[key];
  }
  if (action.featureId === "navigation.deep_link" &&
      Object.hasOwn(normalizedDimensions, "failure_reason") &&
      normalizedDimensions.result !== "error") {
    return null;
  }
  return {
    kind: "feature",
    featureId: action.featureId,
    dimensions: normalizedDimensions,
  };
}

export function createRendererTelemetry({
  enabled = false,
  fetchFn = globalThis.fetch,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  flushDelayMs = 1000,
} = {}) {
  let actions = [];
  let timer = null;

  const api = {
    recordFeature(featureId, dimensions = {}) {
      if (!enabled) return false;
      const action = normalizeRendererTelemetryAction({ kind: "feature", featureId, dimensions });
      if (!action) return false;
      enqueue(action);
      return true;
    },
    setMode(mode) {
      if (!enabled) return false;
      const action = normalizeRendererTelemetryAction({ kind: "mode", mode });
      if (!action) return false;
      enqueue(action);
      schedule(0, { replace: true });
      return true;
    },
    async flush() {
      if (!enabled || actions.length === 0 || typeof fetchFn !== "function") return false;
      if (timer !== null) {
        clearTimeoutFn(timer);
        timer = null;
      }
      const pending = actions.slice(0, 50);
      actions = actions.slice(pending.length);
      try {
        const response = await fetchFn("/api/telemetry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actions: pending }),
          keepalive: true,
        });
        if (!response?.ok && Number(response?.status) >= 500) {
          actions = [...pending, ...actions].slice(-50);
          schedule();
          return false;
        }
        if (!response?.ok) return false;
      } catch {
        actions = [...pending, ...actions].slice(-50);
        schedule();
        return false;
      }
      if (actions.length > 0) schedule();
      return true;
    },
  };

  function enqueue(action) {
    actions.push(action);
    if (actions.length > 50) actions.shift();
    schedule();
  }

  function schedule(delayMs = flushDelayMs, { replace = false } = {}) {
    if (replace && timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    if (timer !== null || actions.length === 0) return;
    timer = setTimeoutFn(async () => {
      timer = null;
      await api.flush();
    }, delayMs);
  }
  return api;
}

function exactKeys(value, allowedKeys) {
  const keys = Object.keys(value).sort();
  return keys.length === allowedKeys.length &&
    keys.every((key, index) => key === [...allowedKeys].sort()[index]);
}

const telemetry = createRendererTelemetry({
  enabled: typeof window !== "undefined" && window.OPENGLANCE_TELEMETRY_ENABLED === true,
});

export function recordTelemetryFeature(featureId, dimensions = {}) {
  return telemetry.recordFeature(featureId, dimensions);
}

export function setTelemetryMode(mode) {
  return telemetry.setMode(mode);
}

export function flushRendererTelemetry() {
  return telemetry.flush();
}
