export function openPeekEnvironmentValue(
  env,
  suffix,
  { canonicalPrefix = "OPENPEEK", legacyPrefix = "GIT_LEAF" } = {},
) {
  const canonicalName = `${canonicalPrefix}_${suffix}`;
  const legacyName = `${legacyPrefix}_${suffix}`;
  return env?.[canonicalName] !== undefined ? env[canonicalName] : env?.[legacyName];
}

export function openPeekEnvironmentFlag(env, suffix) {
  return ["1", "true", "yes"].includes(
    String(openPeekEnvironmentValue(env, suffix) ?? "").trim().toLowerCase(),
  );
}
