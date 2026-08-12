import { openPeekDeepLinkFromArgs } from "./deep-link.mjs";

export function parseDesktopArgs(args = [], { platform = process.platform } = {}) {
  const deepLink = openPeekDeepLinkFromArgs(args, { platform });
  if (deepLink) {
    return deepLink;
  }

  const options = {
    repoRoot: "",
    file: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo") {
      const nextValue = valueAfterFlag(args, index);
      options.repoRoot = nextValue.value;
      index = nextValue.index;
      continue;
    }
    if (arg.startsWith("--repo=")) {
      options.repoRoot = optionValue(arg, "--repo=");
      continue;
    }
    if (arg === "--file") {
      const nextValue = valueAfterFlag(args, index);
      options.file = nextValue.value;
      index = nextValue.index;
      continue;
    }
    if (arg.startsWith("--file=")) {
      options.file = optionValue(arg, "--file=");
    }
  }

  return options;
}

function valueAfterFlag(args, index) {
  const value = args[index + 1] ?? "";
  return isDesktopArgValue(value)
    ? { value, index: index + 1 }
    : { value: "", index };
}

function optionValue(arg, prefix) {
  const value = arg.slice(prefix.length);
  return isDesktopArgValue(value) ? value : "";
}

function isDesktopArgValue(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("--");
}
