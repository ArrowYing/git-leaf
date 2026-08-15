import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const OPENGLANCE_HANDOFF_CONFIRM_BASE_URL =
  "https://gitleaf.mangofuture.com/open/confirm";
export const OPENGLANCE_SHARE_STATE_BASE_URL =
  "https://gitleaf.mangofuture.com/share/state";
const SHARE_HANDOFF_STATES = new Set(["received", "cancelled", "failed"]);

export function normalizeOpenGlanceHandoffId(value) {
  const cleanValue = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{20,64}$/.test(cleanValue) ? cleanValue : "";
}

export function openGlanceHandoffConfirmUrl(handoff) {
  const normalized = normalizeOpenGlanceHandoffId(handoff);
  if (!normalized) {
    return "";
  }
  const url = new URL(OPENGLANCE_HANDOFF_CONFIRM_BASE_URL);
  url.searchParams.set("id", normalized);
  return url.toString();
}

export async function confirmOpenGlanceHandoff(handoff, { fetchImpl = fetch } = {}) {
  const url = openGlanceHandoffConfirmUrl(handoff);
  if (!url) {
    return false;
  }
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      cache: "no-store",
    });
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

export async function reportOpenGlanceShareHandoffState(
  handoff,
  state,
  { fetchImpl = fetch } = {},
) {
  const normalized = normalizeOpenGlanceHandoffId(handoff);
  if (!normalized || !SHARE_HANDOFF_STATES.has(state)) {
    return false;
  }
  const url = new URL(OPENGLANCE_SHARE_STATE_BASE_URL);
  url.searchParams.set("id", normalized);
  url.searchParams.set("state", state);
  try {
    const response = await fetchImpl(url.toString(), {
      method: "POST",
      cache: "no-store",
    });
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

export async function writeDesktopDeepLinkLog({
  userDataDir,
  event,
  request = {},
  detail = "",
} = {}) {
  if (!userDataDir || !event || !normalizeOpenGlanceHandoffId(request.handoff)) {
    return false;
  }
  const entry = {
    at: new Date().toISOString(),
    event: String(event),
    handoff: request.handoff,
    ...(request.repository ? { repository: request.repository } : {}),
    ...(request.repoRoot ? { repoRoot: request.repoRoot } : {}),
    ...(request.file ? { file: request.file } : {}),
    ...(request.worktree ? { worktree: request.worktree } : {}),
    ...(request.rev ? { rev: request.rev } : {}),
    ...(request.share ? { share: true } : {}),
    ...(detail ? { detail: String(detail).slice(0, 500) } : {}),
  };
  await mkdir(userDataDir, { recursive: true });
  await appendFile(
    path.join(userDataDir, "deep-link.log"),
    `${JSON.stringify(entry)}\n`,
    "utf8",
  );
  return true;
}
