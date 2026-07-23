export async function saveAndSyncDesktopPreferences({
  preferences,
  persistPreferences,
  updateServerPreferences = () => {},
  sendRendererPreferences = async () => {},
  notifyRenderer = true,
}) {
  if (typeof persistPreferences !== "function") {
    throw new TypeError("persistPreferences must be a function");
  }

  const state = await persistPreferences(preferences);
  const savedPreferences = state?.preferences ?? {};
  updateServerPreferences(savedPreferences);
  if (notifyRenderer) {
    await sendRendererPreferences(savedPreferences);
  }
  return { state, preferences: savedPreferences };
}
