export function classifyDesktopNavigation({ currentUrl, targetUrl }) {
  const target = parsedUrl(targetUrl);
  if (!target) {
    return "blocked";
  }

  const current = parsedUrl(currentUrl);
  if (current && target.origin === current.origin && /^https?:$/.test(target.protocol)) {
    return "internal";
  }

  if (target.protocol === "http:" || target.protocol === "https:" || target.protocol === "mailto:") {
    return "external";
  }

  return "blocked";
}

function parsedUrl(value) {
  try {
    return new URL(String(value ?? ""));
  } catch {
    return null;
  }
}
