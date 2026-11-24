/**
 * Theme + accent plumbing for the main window.
 *
 * Two concerns, one ordering rule:
 *   1. `applyTheme(theme)` sets `data-theme` on `<html>` (see style.css —
 *      `:root` is the dark set, `[data-theme="light"]` the light set).
 *   2. `applyAccentColor(color)` overwrites `--accent`/`--accent-hover`/
 *      `--accent-subtle` inline on `<html>`, overriding whichever theme
 *      block supplied the defaults.
 *
 * ORDERING: callers must apply the theme BEFORE the accent colour
 * (loadSettingsIntoUi / runPersist both do `applyTheme(); applyAccentColor();`).
 * applyTheme never touches the accent custom properties, so it cannot clobber
 * a runtime accent override — but applying the accent first and the theme
 * second is still the documented order, because a future stylesheet change
 * (e.g. moving accent defaults into per-theme blocks) relies on it.
 */
export type ThemeSetting = 'system' | 'light' | 'dark';

const THEME_VALUES: readonly ThemeSetting[] = ['system', 'light', 'dark'];

let currentTheme: ThemeSetting = 'dark';
let systemQuery: MediaQueryList | null = null;
let systemListener: ((event: MediaQueryListEvent) => void) | null = null;

/** Type guard for a theme value coming from settings. */
export function isThemeSetting(value: unknown): value is ThemeSetting {
  return typeof value === 'string' && (THEME_VALUES as readonly string[]).includes(value);
}

/** Coerce any value to a supported theme, defaulting to dark. */
export function normalizeThemeSetting(value: unknown): ThemeSetting {
  return isThemeSetting(value) ? value : 'dark';
}

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace('#', '');
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** Blend a hex colour toward white by `amount` (0…1). */
function lighten(hex: string, amount: number) {
  const value = hex.replace('#', '');
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  const red = mix(Number.parseInt(value.slice(0, 2), 16));
  const green = mix(Number.parseInt(value.slice(2, 4), 16));
  const blue = mix(Number.parseInt(value.slice(4, 6), 16));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

export function applyAccentColor(color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  document.documentElement.style.setProperty('--accent', color);
  // A hover state that equals the base colour is invisible (issue #08). The
  // stylesheet's default pair is accent -> a lighter variant; custom accents
  // now get the same treatment instead of the runtime overwrite pinning both.
  document.documentElement.style.setProperty('--accent-hover', lighten(color, 0.12));
  document.documentElement.style.setProperty('--accent-subtle', hexToRgba(color, 0.14));
}

/** Resolve `system` against the OS preference; explicit themes pass through. */
function resolvedTheme(theme: ThemeSetting): 'light' | 'dark' {
  if (theme === 'system') return systemQuery?.matches ? 'light' : 'dark';
  return theme;
}

function applyDataTheme(): void {
  document.documentElement.dataset.theme = resolvedTheme(currentTheme);
}

/**
 * Apply the theme setting to `<html data-theme>`.
 *
 * `system` follows `prefers-color-scheme: light` LIVE: a change listener is
 * attached while `system` is active and removed the moment an explicit theme
 * is pinned, so no stale listener outlives its setting. Duplicate
 * applications of the same theme are coalesced (the attribute is only
 * rewritten when something actually changed).
 *
 * Never touches the accent custom properties — see the ordering note above.
 *
 * @returns the normalized theme now in effect.
 */
export function applyTheme(theme: unknown): ThemeSetting {
  const next = normalizeThemeSetting(theme);
  const alreadyApplied = document.documentElement.dataset.theme !== undefined;
  if (next === currentTheme && alreadyApplied) return next;

  currentTheme = next;
  if (next === 'system') {
    systemQuery = window.matchMedia('(prefers-color-scheme: light)');
    if (!systemListener) {
      systemListener = () => applyDataTheme();
      systemQuery.addEventListener('change', systemListener);
    }
  } else if (systemQuery && systemListener) {
    systemQuery.removeEventListener('change', systemListener);
    systemListener = null;
    systemQuery = null;
  }
  applyDataTheme();
  return next;
}
