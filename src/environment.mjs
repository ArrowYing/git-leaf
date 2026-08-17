export const OPENGLANCE_ENVIRONMENT_PREFIXES = Object.freeze([
  "OPENGLANCE",
  "GIT_LEAF",
]);

export function openGlanceEnvironmentValue(
  env,
  suffix,
  { prefixes = OPENGLANCE_ENVIRONMENT_PREFIXES } = {},
) {
  for (const prefix of prefixes) {
    const name = `${prefix}_${suffix}`;
    if (env?.[name] !== undefined) {
      return env[name];
    }
  }
  return undefined;
}

export function openGlanceEnvironmentFlag(env, suffix) {
  return ["1", "true", "yes"].includes(
    String(openGlanceEnvironmentValue(env, suffix) ?? "").trim().toLowerCase(),
  );
}
