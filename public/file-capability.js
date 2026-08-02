const LABEL_KEY_BY_CAPABILITY = Object.freeze({
  editable: "file.editable",
  missing: "file.missing",
  placeholder: "file.placeholder",
  readonly: "file.readonly",
  unknown: "file.unknown",
  unsupported: "file.unsupported",
});

export function treeFileCapability(kind, {
  missing = false,
  translate = (key) => key,
} = {}) {
  const name = treeFileCapabilityName(kind, { missing });
  return {
    name,
    label: translate(LABEL_KEY_BY_CAPABILITY[name]),
    badge: treeFileCapabilityBadge(name, { translate }),
  };
}

export function shouldShowReadonlyModeStatus({
  hasDocument = false,
  canUseEditor = false,
} = {}) {
  return Boolean(hasDocument && !canUseEditor);
}

function treeFileCapabilityName(kind, { missing = false } = {}) {
  if (missing) {
    return "missing";
  }
  if (kind === "markdown") {
    return "editable";
  }
  if (kind === "placeholder") {
    return "placeholder";
  }
  if (["unsupported", "symlink", "submodule"].includes(kind)) {
    return "unsupported";
  }
  if (kind === "unknown") {
    return "unknown";
  }
  return "readonly";
}

function treeFileCapabilityBadge(name, { translate }) {
  if (name === "unknown") {
    return translate("badge.detect");
  }
  if (name === "unsupported") {
    return translate("badge.unsupported");
  }
  if (name === "missing") {
    return translate("badge.missing");
  }
  return "";
}
