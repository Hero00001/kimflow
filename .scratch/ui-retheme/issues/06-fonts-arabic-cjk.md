# 06 — Arabic/CJK font fallback bundling

Status: ready-for-human
Blocked by: —

## Task

Add IBM Plex Sans Arabic and Noto Sans SC woff2 files to `src/fonts/`; add `@font-face` rules and extend the `--font` stack fallback order in `src/style.css` (bundled faces now precede system fallbacks). CSP `font-src 'self'` already permits bundled fonts. Audit the subsets actually needed (regular + medium weights) to keep bundle size sane.

## Acceptance

- Arabic and Chinese UI text renders in the bundled faces consistently across Windows machines (no OS-lottery).
- Bundle size increase documented in the ticket comment.
