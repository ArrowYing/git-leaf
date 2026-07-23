export async function completeDesktopShutdown({
  prepareUpdate = () => {},
  shutdownSteps = [],
  installUpdate = () => false,
  exit = () => {},
} = {}) {
  try {
    prepareUpdate();
  } catch {
    // Update telemetry must never prevent the App from closing.
  }

  for (const step of shutdownSteps) {
    try {
      await step?.();
    } catch {
      // Every remaining close step still has to run before an updater is launched.
    }
  }

  let updaterOwnsExit = false;
  try {
    updaterOwnsExit = await installUpdate() === true;
  } catch {
    updaterOwnsExit = false;
  }
  if (!updaterOwnsExit) {
    exit(0);
  }
  return updaterOwnsExit;
}
