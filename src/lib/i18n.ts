import enDictionary from "../i18n/en.json";

export type Language = "zh" | "en";

const STORAGE_KEY = "fairjoin.lang";

function normalizeKey(phrase: string): string {
  return phrase.replace(/\s+/g, " ").trim();
}

function readUrlLanguage(href: string): Language | null {
  try {
    const url = new URL(href);
    const lang = url.searchParams.get("lang");
    if (lang === "en") return "en";
    if (lang === "zh") return "zh";
  } catch {
    // Malformed URLs fall through to the next detection step.
  }
  return null;
}

function detectLanguage(): Language {
  if (typeof window === "undefined") return "zh";
  const fromUrl = readUrlLanguage(window.location.href);
  if (fromUrl) return fromUrl;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    // localStorage can be unavailable (private mode, disabled storage); zh stays the default.
  }
  return "zh";
}

let currentLanguage: Language = detectLanguage();

export function getLanguage(): Language {
  return currentLanguage;
}

export function isEnglish(): boolean {
  return currentLanguage === "en";
}

export function currentLocale(): string {
  return currentLanguage === "en" ? "en-US" : "zh-CN";
}

/**
 * Builds a same-page href that toggles the language while preserving the hash
 * and every other query parameter. Returns a relative URL suitable for <a href>.
 */
export function languageHref(language: Language): string {
  const fallback = "https://fairjoin.invalid/";
  let url: URL;
  try {
    url = new URL(typeof window === "undefined" ? fallback : window.location.href);
  } catch {
    url = new URL(fallback);
  }
  url.searchParams.set("lang", language);
  return url.pathname + url.search + url.hash;
}

/**
 * Persists the choice, then reloads with the ?lang parameter applied. The hash
 * and all other query parameters are preserved. Pending-transaction state lives
 * in localStorage and survives the reload. No network call is made.
 */
export function setLanguage(language: Language): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Persisting is best-effort; the URL parameter still drives this reload.
  }
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return;
  }
  url.searchParams.set("lang", language);
  window.location.assign(url.toString());
}

function substitute(template: string, values: readonly unknown[]): string {
  if (values.length === 0) return template;
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = values[Number(index)];
    return value === undefined || value === null ? match : String(value);
  });
}

/**
 * Namespaced translation helper. In Chinese mode it returns the exact phrase
 * passed in (placeholders substituted). In English mode it looks up the
 * whitespace-normalized phrase in the dictionary and falls back to the
 * original Chinese when no translation exists, so it never throws.
 */
export function i18nText(phrase: string, ...values: unknown[]): string {
  if (currentLanguage === "zh") return substitute(phrase, values);
  const dictionary = enDictionary as Record<string, string>;
  const translated = dictionary[normalizeKey(phrase)];
  if (typeof translated !== "string" || translated.length === 0) {
    return substitute(phrase, values);
  }
  return substitute(translated, values);
}
