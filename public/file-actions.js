export function githubFileUrl(githubBlobRoot, filePath) {
  const root = String(githubBlobRoot || "").trim().replace(/\/+$/, "");
  const relativePath = String(filePath || "").replaceAll("\\", "/");
  if (!root || !relativePath || relativePath.startsWith("/")) {
    return "";
  }

  let rootUrl;
  try {
    rootUrl = new URL(root);
  } catch {
    return "";
  }
  if (
    rootUrl.protocol !== "https:" ||
    rootUrl.hostname !== "github.com" ||
    rootUrl.port ||
    rootUrl.username ||
    rootUrl.password ||
    rootUrl.search ||
    rootUrl.hash ||
    !rootUrl.pathname.includes("/blob/")
  ) {
    return "";
  }

  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return "";
  }
  return `${root}/${segments.map(encodeURIComponent).join("/")}`;
}
