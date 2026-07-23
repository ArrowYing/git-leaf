export function imageLoadFailureMessage({ src = "", alt = "" } = {}) {
  const source = String(src ?? "").trim();
  const label = imageSourceLabel(source, alt);
  const reason = isRemoteImageSource(source)
    ? "网络不可用、访问受限或链接已经失效"
    : "文件不存在、路径错误或图片格式无法解码";
  return `图片加载失败：${label}（${reason}）`;
}

export function enhanceImageLoadStates(root) {
  for (const image of root?.querySelectorAll?.("img") ?? []) {
    attachImageLoadState(image);
  }
}

export function attachImageLoadState(image) {
  if (!image || image.dataset.gitLeafLoadStateAttached === "true") {
    return;
  }
  image.dataset.gitLeafLoadStateAttached = "true";

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
    });
    frame.append(message);
  };

  image.addEventListener("load", clearFailure);
  image.addEventListener("error", showFailure);
  if (image.complete) {
    queueMicrotask(image.naturalWidth > 0 ? clearFailure : showFailure);
  }
}

function imageSourceLabel(source, alt) {
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
      return String(alt ?? "").trim() || "内嵌图片";
    }
  } catch {
    // Fall through to the source string shown in the document.
  }
  return source || String(alt ?? "").trim() || "未知图片";
}

function isRemoteImageSource(source) {
  return /^(?:https?:)?\/\//i.test(String(source ?? "").trim());
}
