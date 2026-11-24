# 02 — Theme setting (System / Light / Dark, default Dark)

Status: resolved
Blocked by: —

## Task

Add `theme: 'system' | 'light' | 'dark'` (default `'dark'`) to `DEFAULT_SETTINGS` and the `normalizeSettings()` whitelist in `backend/settings.cjs` (no migration needed — absent key = dark). Render a segmented control row in the Appearance section (index.html + settings-form.ts). `theme.ts` resolves `system` via `matchMedia('(prefers-color-scheme: light)')`, listens for changes live, and applies `data-theme` on documentElement. Add an i18n key set for the row (en/ar/zh).

## Acceptance

- Default install is dark (no behavior change for existing users).
- System follows Windows light/dark live; Light and Dark pin explicitly.
- Setting persists across restarts; invalid values coerce to `dark`.

## Comments

- `backend/settings.cjs`: `theme: 'dark'` in DEFAULT_SETTINGS (commented: dark is the shipped default, overlay/widget always dark) and a whitelist in `normalizeSettings()` (`['system','light','dark']`, else 'dark'). No migration flag — absent key falls through to the default like every other whitelisted key. No preload change needed: settings round-trip generically through `save-settings` → `normalizeSettings` → `settings-updated` exactly like `polishMode`/`accentColor`.
- `src/electron.d.ts`: `Settings.theme: string`.
- `index.html`: `#theme-row` with `#theme-select` (System/Light/Dark `<select>` options, data-i18n driven) appended AFTER `#accent-row` in Appearance, following the `ui-language-select` markup pattern. Binding added to `src/dom.ts` (`themeSelect`) — dom.ts id gate passes.
- `src/settings-form.ts` wiring identical to the ui-language pattern: load (`applyTheme(settings.theme)` in `loadSettingsIntoUi`, theme first then accent), persist (`settings.theme = normalizeThemeSetting(themeSelect.value)` in `runPersist`, re-applying theme→accent in the documented order), change handler (`applyTheme(themeSelect.value)` immediately, then persist).
- i18n: `settings.appearance.theme` + `themeSystem`/`themeLight`/`themeDark` added to en/ar/zh (en: Theme/System/Light/Dark; ar: السمة/النظام/فاتح/داكن; zh: 主题/跟随系统/浅色/深色). Key-count tests (`i18n-locales`, `i18n-model-auto-adversarial`) bumped 194 → 198; parity test green.
- DEVIATION: the ticket says "segmented control row"; implemented as a `<select>` per the lead's instruction ("follow the existing row markup pattern with a <select> like ui-language-select"). Swapping to a segmented toggle-group later is a markup-only change (ids survive).
- The broadcast path (`applySettingsToUi`) deliberately does NOT re-apply the theme — same reasoning as uiLanguage: broadcast snapshots can predate the user's latest change, and the form owns the control (applied on load + on change).
- Full suite green (578 tests), build green (dom.ts id gate).
