const DEFAULT_PAINT_TIMEOUT_MS = 1_000;

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
