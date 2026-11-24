# 02 — Theme setting (System / Light / Dark, default Dark)

Status: ready-for-human
Blocked by: 01

## Task

Add `theme: 'system' | 'light' | 'dark'` (default `'dark'`) to `DEFAULT_SETTINGS` and the `normalizeSettings()` whitelist in `backend/settings.cjs` (no migration needed — absent key = dark). Render a segmented control row in the Appearance section (index.html + settings-form.ts). `theme.ts` resolves `system` via `matchMedia('(prefers-color-scheme: light)')`, listens for changes live, and applies `data-theme` on documentElement. Add an i18n key set for the row (en/ar/zh).

## Acceptance

- Default install is dark (no behavior change for existing users).
- System follows Windows light/dark live; Light and Dark pin explicitly.
- Setting persists across restarts; invalid values coerce to `dark`.
