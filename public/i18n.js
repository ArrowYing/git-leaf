export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = Object.freeze(["en", "zh-CN"]);

export function normalizeLocaleTag(value, fallback = DEFAULT_LOCALE) {
  const normalized = String(value ?? "").trim().replaceAll("_", "-").toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-")) {
    return "zh-CN";
  }
  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en";
  }
  return SUPPORTED_LOCALES.includes(fallback) ? fallback : DEFAULT_LOCALE;
}

export function resolveLocalePreference(
  language = "system",
  systemLanguages = globalThis.navigator?.languages ?? [globalThis.navigator?.language],
) {
  const normalizedPreference = String(language ?? "").trim().replaceAll("_", "-").toLowerCase();
  if (normalizedPreference === "zh" || normalizedPreference.startsWith("zh-")) {
    return "zh-CN";
  }
  if (normalizedPreference === "en" || normalizedPreference.startsWith("en-")) {
    return "en";
  }
  if (normalizedPreference !== "" && normalizedPreference !== "system") {
    return DEFAULT_LOCALE;
  }
  for (const candidate of normalizeLanguageList(systemLanguages)) {
    const normalized = String(candidate ?? "").trim().replaceAll("_", "-").toLowerCase();
    if (normalized === "zh" || normalized.startsWith("zh-")) {
      return "zh-CN";
    }
    if (normalized === "en" || normalized.startsWith("en-")) {
      return "en";
    }
  }
  return DEFAULT_LOCALE;
}

export function formatMessage(template, values = {}) {
  return String(template ?? "").replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => (
    Object.hasOwn(values, key) ? String(values[key]) : match
  ));
}

export function createTranslator(messages, locale = DEFAULT_LOCALE) {
  const resolvedLocale = normalizeLocaleTag(locale);
  const localizedMessages = messages?.[resolvedLocale] ?? {};
  const fallbackMessages = messages?.[DEFAULT_LOCALE] ?? {};
  const translate = (key, values = {}, fallback = key) => {
    const template = localizedMessages[key] ?? fallbackMessages[key] ?? fallback;
    return formatMessage(template, values);
  };
  translate.locale = resolvedLocale;
  translate.messages = messages;
  return translate;
}

export function localizeDocument(root, translate) {
  const documentElement = root?.documentElement ?? root?.ownerDocument?.documentElement;
  if (documentElement && translate?.locale) {
    documentElement.lang = translate.locale;
    documentElement.dataset.locale = translate.locale;
  }
  localizeAttribute(root, translate, "data-i18n", "textContent");
  localizeAttribute(root, translate, "data-i18n-title", "title");
  localizeAttribute(root, translate, "data-i18n-placeholder", "placeholder");
  localizeAttribute(root, translate, "data-i18n-aria-label", "aria-label");
  localizeAttribute(root, translate, "data-i18n-data-empty-label", "data-empty-label");
}

function localizeAttribute(root, translate, selectorAttribute, targetAttribute) {
  if (!root?.querySelectorAll || typeof translate !== "function") {
    return;
  }
  for (const element of root.querySelectorAll(`[${selectorAttribute}]`)) {
    const key = element.getAttribute(selectorAttribute);
    if (!key) {
      continue;
    }
    const value = translate(key);
    if (targetAttribute === "textContent") {
      element.textContent = value;
    } else {
      element.setAttribute(targetAttribute, value);
    }
  }
}

function normalizeLanguageList(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  return [value];
}
