export const OPENGLANCE_PRODUCT_NAME = "OpenGlance";
export const OPENGLANCE_DEVELOPMENT_NAME = "OpenGlance dev";
export const OPENGLANCE_PRODUCT_SLUG = "openglance";

export const OPENGLANCE_PROTOCOL = "openglance";
export const OPENGLANCE_OPENPEEK_PROTOCOL = "openpeek";
export const OPENGLANCE_GIT_LEAF_PROTOCOL = "git-leaf";
export const OPENGLANCE_LEGACY_PROTOCOL = OPENGLANCE_GIT_LEAF_PROTOCOL;
export const OPENGLANCE_LEGACY_PROTOCOLS = Object.freeze([
  OPENGLANCE_OPENPEEK_PROTOCOL,
  OPENGLANCE_GIT_LEAF_PROTOCOL,
]);
export const OPENGLANCE_SUPPORTED_PROTOCOLS = Object.freeze([
  OPENGLANCE_PROTOCOL,
  ...OPENGLANCE_LEGACY_PROTOCOLS,
]);

export function isOpenGlanceProtocol(protocol) {
  const normalized = String(protocol || "").replace(/:$/, "").toLowerCase();
  return OPENGLANCE_SUPPORTED_PROTOCOLS.includes(normalized);
}
