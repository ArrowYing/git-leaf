export const OPENPEEK_PRODUCT_NAME = "OpenPeek";
export const OPENPEEK_DEVELOPMENT_NAME = "OpenPeek dev";
export const OPENPEEK_PRODUCT_SLUG = "openpeek";

export const OPENPEEK_PROTOCOL = "openpeek";
export const OPENPEEK_LEGACY_PROTOCOL = "git-leaf";
export const OPENPEEK_SUPPORTED_PROTOCOLS = Object.freeze([
  OPENPEEK_PROTOCOL,
  OPENPEEK_LEGACY_PROTOCOL,
]);

export function isOpenPeekProtocol(protocol) {
  const normalized = String(protocol || "").replace(/:$/, "").toLowerCase();
  return OPENPEEK_SUPPORTED_PROTOCOLS.includes(normalized);
}
