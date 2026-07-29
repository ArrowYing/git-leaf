const DEFAULT_PAINT_TIMEOUT_MS = 1_000;
const DEFAULT_LOAD_TIMEOUT_MS = 1_000;

export async function loadWebContentsUrl(
  webContents,
  url,
  { timeoutMs = DEFAULT_LOAD_TIMEOUT_MS } = {},
) {
  const loadURL = webContents?.loadURL;
  if (typeof loadURL !== "function") {
    return false;
  }

  let timeout;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => loadURL.call(webContents, url))
        .then(() => true)
        .catch(() => false),
      new Promise((resolve) => {
        timeout = setTimeout(
          () => resolve(false),
          Math.max(0, Number(timeoutMs) || 0),
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function waitForWebContentsPaint(
  webContents,
  { timeoutMs = DEFAULT_PAINT_TIMEOUT_MS } = {},
) {
  const executeJavaScript = webContents?.executeJavaScript;
  if (typeof executeJavaScript !== "function") {
    return;
  }

  let timeout;
  try {
    await Promise.race([
      Promise.resolve()
        .then(() => executeJavaScript.call(
          webContents,
          "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
          true,
        ))
        .catch(() => undefined),
      new Promise((resolve) => {
        timeout = setTimeout(resolve, Math.max(0, Number(timeoutMs) || 0));
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
