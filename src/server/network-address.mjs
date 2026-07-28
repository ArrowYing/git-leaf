export const LOCALHOST_HOST = "127.0.0.1";
export const DEFAULT_BIND_HOST = LOCALHOST_HOST;

export function previewServerUrl({
  port,
  relativePath,
  repoId,
}) {
  const urlPath = previewPath({ relativePath, repoId });
  return buildHttpUrl(LOCALHOST_HOST, port, urlPath);
}

function previewPath({ relativePath, repoId }) {
  const query = new URLSearchParams();
  if (repoId) {
    query.set("repo", repoId);
  }
  if (relativePath) {
    query.set("file", relativePath);
  }
  const queryString = query.toString();
  return queryString ? `/?${queryString}` : "/";
}

export function isLocalRequestAddress(
  remoteAddress,
) {
  const address = normalizeIpAddress(remoteAddress);
  if (!address) {
    return false;
  }
  return address === LOCALHOST_HOST || address === "::1";
}

function normalizeIpAddress(address) {
  if (!address) {
    return "";
  }
  return address.replace(/^\[|\]$/g, "").replace(/^::ffff:/, "");
}

function buildHttpUrl(host, port, pathWithQuery) {
  return `http://${formatUrlHost(host)}:${port}${pathWithQuery}`;
}

function formatUrlHost(host) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
