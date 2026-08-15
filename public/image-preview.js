import { createTranslator } from "./i18n.js";
import { WORKBENCH_MESSAGES } from "./workbench-locales.js";

export function imageLoadFailureMessage({ src = "", alt = "" } = {}, locale = "zh-CN") {
  const t = createTranslator(WORKBENCH_MESSAGES, locale);
  const source = String(src ?? "").trim();
  const label = imageSourceLabel(source, alt, t);
  const reason = isRemoteImageSource(source)
    ? t("image.remoteFailure")
    : t("image.localFailure");
  return t("image.failure", { label, reason });
}

export function enhanceImageLoadStates(root, { locale = "zh-CN" } = {}) {
  for (const image of root?.querySelectorAll?.("img") ?? []) {
    attachImageLoadState(image, { locale });
  }
}

export function attachImageLoadState(image, { locale = "zh-CN" } = {}) {
  if (!image || image.dataset.openGlanceLoadStateAttached === "true") {
    return;
  }
  image.dataset.openGlanceLoadStateAttached = "true";

  const clearFailure = () => {
    image.removeAttribute("aria-invalid");
    const frame = image.closest?.(".git-leaf-image-frame, .file-preview-image") ?? image.parentElement;
    frame?.classList?.remove("is-load-error");
    frame?.querySelector?.(".git-leaf-image-error")?.remove();
  };
  const showFailure = () => {
    const frame = image.closest?.(".git-leaf-image-frame, .file-preview-image") ?? image.parentElement;
    if (!frame || frame.querySelector?.(".git-leaf-image-error")) {
      return;
    }
    image.setAttribute("aria-invalid", "true");
    frame.classList?.add("is-load-error");
    const message = image.ownerDocument.createElement("span");
    message.className = "git-leaf-image-error";
    message.setAttribute("role", "note");
    message.textContent = imageLoadFailureMessage({
      src: image.getAttribute("src") || image.currentSrc || image.src,
      alt: image.alt,
    }, locale);
    frame.append(message);
  };

  image.addEventListener("load", clearFailure);
  image.addEventListener("error", showFailure);
  if (image.complete) {
    queueMicrotask(image.naturalWidth > 0 ? clearFailure : showFailure);
  }
}

function imageSourceLabel(source, alt, t) {
  try {
    const url = new URL(source, "http://git-leaf.local");
    const repositoryPath = url.pathname === "/raw" ? url.searchParams.get("file") : "";
    if (repositoryPath) {
      return repositoryPath;
    }
    if (["http:", "https:"].includes(url.protocol)) {
      return url.href;
    }
    if (url.protocol === "data:") {
      return String(alt ?? "").trim() || t("image.inline");
    }
  } catch {
    // Fall through to the source string shown in the document.
  }
  return source || String(alt ?? "").trim() || t("image.unknown");
}

function isRemoteImageSource(source) {
  return /^(?:https?:)?\/\//i.test(String(source ?? "").trim());
}
