/**
 * KimFlow renderer i18n.
 *
 * Single source of truth for UI text, shared by both Vite build inputs
 * (`index.html` via `main.ts` and `src/overlay.html` via `src/overlay.ts`).
 *
 * There is deliberately no backend copy of the locale data: the backend keeps
 * building English *diagnostics*, and the renderer is the single place that
 * turns them into display text. See `src/utils.ts` for the error mapping.
 */
import { en, type LocaleKey } from './locales/en';
import { ar } from './locales/ar';
import { zh } from './locales/zh';

/** The languages the UI can be rendered in. Independent of STT/translation. */
export type UILanguage = 'en' | 'ar' | 'zh';

export type { LocaleKey };

/** Languages written right-to-left. Drives `<html dir>`. */
const RTL_LANGUAGES: ReadonlySet<UILanguage> = new Set<UILanguage>(['ar']);

const SUPPORTED_LANGUAGES: readonly UILanguage[] = ['en', 'ar', 'zh'];

const LOCALES: Record<UILanguage, Record<LocaleKey, string>> = { en, ar, zh };

let currentLanguage: UILanguage = 'en';

/** Type guard for a value coming from settings or the OS locale. */
export function isUILanguage(value: unknown): value is UILanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** Coerce any value to a supported language, defaulting to English. */
export function normalizeUILanguage(value: unknown): UILanguage {
  return isUILanguage(value) ? value : 'en';
}

/** The language currently in use for rendering. */
export function getLanguage(): UILanguage {
  return currentLanguage;
}

/** True when the given (or current) language is right-to-left. */
export function isRTL(language: UILanguage = currentLanguage): boolean {
  return RTL_LANGUAGES.has(language);
}

/**
 * Select the active language without touching the DOM. Returns the resolved
 * language so callers can react to an unsupported input value.
 */
export function setLanguage(language: unknown): UILanguage {
  currentLanguage = normalizeUILanguage(language);
  return currentLanguage;
}

/**
 * Resolve a key in the active language.
 *
 * Fallback rule: a key missing from the active locale resolves to the English
 * string. A raw key can only ever reach the screen if it is missing from
 * English too, which the parity test forbids.
 *
 * `{name}` placeholders are replaced from `params`; unknown placeholders are
 * left untouched so a translation bug is visible rather than silent.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const locale = LOCALES[currentLanguage];
  const template = locale[key as LocaleKey] ?? en[key as LocaleKey] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  ));
}

/**
 * Set the active language and mirror it onto `<html lang>` / `<html dir>`.
 *
 * `dir="rtl"` flips the whole layout because the app is built on flexbox; the
 * only deliberate exception is `#titlebar`, which pins its own `dir="ltr"` so
 * the window buttons stay top-right (see `src/style.css`).
 */
export function applyLanguage(language: unknown): UILanguage {
  const resolved = setLanguage(language);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.lang = resolved;
    root.dir = isRTL(resolved) ? 'rtl' : 'ltr';
  }
  return resolved;
}

/**
 * Re-render every element that declares a translation via a `data-i18n*`
 * attribute. Idempotent — safe to call on init and after every language change.
 *
 * Supported attributes:
 *   data-i18n             → textContent
 *   data-i18n-title       → title
 *   data-i18n-aria-label  → aria-label
 *   data-i18n-placeholder → placeholder
 */
export function renderStatic(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n;
    if (key) element.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((element) => {
    const key = element.dataset.i18nTitle;
    if (key) element.title = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((element) => {
    const key = element.dataset.i18nAriaLabel;
    if (key) element.setAttribute('aria-label', t(key));
  });
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-i18n-placeholder]').forEach((element) => {
    const key = element.dataset.i18nPlaceholder;
    if (key) element.placeholder = t(key);
  });
}

/**
 * Escape a string so it can be assigned to a CSS custom property and used as a
 * `content:` value (newlines become the CSS `\A ` escape). Used for the
 * `:empty::after` placeholders that cannot carry a `data-i18n` attribute.
 */
export function cssContentValue(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\A ')}"`;
}
