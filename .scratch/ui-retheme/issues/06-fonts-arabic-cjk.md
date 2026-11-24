# 06 — Arabic/CJK font fallback bundling

Status: resolved
Blocked by: —

## Task

Add IBM Plex Sans Arabic and Noto Sans SC woff2 files to `src/fonts/`; add `@font-face` rules and extend the `--font` stack fallback order in `src/style.css` (bundled faces now precede system fallbacks). CSP `font-src 'self'` already permits bundled fonts. Audit the subsets actually needed (regular + medium weights) to keep bundle size sane.

## Acceptance

- Arabic and Chinese UI text renders in the bundled faces consistently across Windows machines (no OS-lottery).
- Bundle size increase documented in the ticket comment.

## Comments

- Files added to `src/fonts/` (Fontsource builds served from cdn.jsdelivr.net — official OFL-licensed builds of the Google Fonts/IBM releases; no new npm dependency):
  - `ibm-plex-sans-arabic-arabic-400-normal.woff2` — 42,848 bytes
  - `ibm-plex-sans-arabic-arabic-500-normal.woff2` — 45,296 bytes
  - `noto-sans-sc-chinese-simplified-400-normal.woff2` — 1,142,552 bytes
  - `noto-sans-sc-chinese-simplified-500-normal.woff2` — 1,159,128 bytes
  All four verified non-empty with `wOF2` magic bytes. **Bundle size increase: 2,389,824 bytes ≈ 2.28 MB** raw (before gzip/brotli transfer compression).
- SUBSET SITUATION: Noto Sans SC full CJK as a single woff2 is ~1.14 MB per weight — well under the 4 MB threshold from the brief — so the Google Fonts unicode-range split (100+ chunks per weight) was NOT used; one `@font-face` per weight with no `unicode-range`. IBM Plex Sans Arabic uses the arabic subset only (Latin glyphs always come from the bundled IBM Plex Sans Latin face, which the stack lists first).
- `src/fonts/ibm-plex-sans.css`: header comment updated (it now vendors all three families) and six `@font-face` rules added (Arabic + SC, weights 400/500, `font-display: swap`). No new CSS link needed — index.html already links this file, and CSP `font-src 'self'` covers the bundled urls (verified: vite emits the four new hashed woff2 assets in dist/).
- `src/style.css` `--font` stack extended: `'IBM Plex Sans', 'IBM Plex Sans Arabic', 'Noto Sans SC', <existing system fallbacks unchanged>`. Bundled faces precede system fallbacks; Latin stays first; the system names (incl. "Noto Sans Arabic", "Microsoft YaHei", "PingFang SC", "Noto Sans SC") remain as last-resort glyph coverage — this also keeps `i18n-markup.test.cjs`'s font-stack assertion green.
- SCOPE NOTE: `src/overlay.html` keeps its own hardcoded font stack (it does not load style.css or the vendored fonts css). Its Arabic/Chinese text still rides OS fallbacks — left as-is per the overlay-stays-dark/hands-off rule; flagging in case the overlay should share the bundled faces in a later pass.
