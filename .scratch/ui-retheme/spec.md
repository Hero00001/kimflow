# Spec: UI retheme + settings regroup + history tweaks

- Date: 2026-11-24
- Status: awaiting user approval (all decisions locked in discussion 2026-11-24)
- Research basis: docs/hex-research-report.md (Hex competitive research)

## Goal

Make KimFlow's interface feel deliberately designed, using Hex's design discipline, without changing any behavior users depend on. Three workstreams, in risk order:

1. **Theme system** — the app gains a light theme (black-and-white monochrome) alongside today's dark theme, with a System/Light/Dark control. Dark ships as the default.
2. **Settings regroup** — reorganize the five existing sections; nothing invented, nothing removed.
3. **History tweaks** — keep the view's structure and soul intact; add confirmation safety and provenance.

## Locked decisions (from discussion, 2026-11-24)

- **Dark is the shipped default theme.** Light (black-and-white) is opt-in. Revisit flipping the default to System in a later release.
- **The floating overlay/window stays always-dark** in every theme (Hex HUD precedent).
- **Accent picker stays** with its current mechanics (theme.ts overwrites --accent/-hover/-subtle). Light-mode default accent = black (#171717); dark-mode default stays the current purple.
- **No Labs section** (nothing exists to put in it; create only when the first opt-in experiment ships).
- **No History settings section** (history tweaks are view behaviors, not settings).
- **Transcript view: no structural change.** It inherits theme tokens only.
- Settings regroup is a **merge + rename only**: Input + Engine → Speech; Cleanup → Output; Language and Appearance unchanged.

## Theme architecture (verified current state)

- `src/style.css` `:root` holds one hardcoded dark token set (`--bg #0b0b0d`, `--panel #121216`, `--surface #17171c`, `--text #ececf1`, `--text-secondary`, `--text-tertiary`, `--accent` purple default, `--success`, `--danger`, `--border`, `--border-strong`). All colors flow through these tokens; no `prefers-color-scheme` anywhere.
- `src/theme.ts` `applyAccentColor()` sets `--accent`, `--accent-hover` (lighten 0.12), `--accent-subtle` (rgba 0.14) on documentElement.
- Plan: keep `:root` as the dark set (today's values, unchanged); add `[data-theme="light"]` override block with the light palette; add a `theme` setting (`system | light | dark`, default `dark`) applied in `theme.ts`; `system` resolves via `matchMedia('(prefers-color-scheme: light)')` with a live listener. Overlay windows always get `data-theme="dark"` regardless of the setting.

Light palette (proposal, tune during implementation): `--bg #fafaf9`, `--panel/--surface #ffffff`, `--surface-hover #f1efe8`, `--text #171717`, `--text-secondary #6f6e6a`, `--text-tertiary #a5a39c`, `--border rgba(0,0,0,0.08)`, `--border-strong rgba(0,0,0,0.16)`, `--accent #171717` (black), accent-hover lighten 0.12 toward white, accent-subtle rgba(0,0,0,0.08). Success/danger keep their hues, checked for contrast on white.

## Settings regroup (verified current sections in index.html)

| Today | After |
|---|---|
| Input (hotkey/input rows) | merged into **Speech** |
| Engine (engine/model/download + advanced sub-block) | merged into **Speech** |
| Language | **Language** (unchanged) |
| Cleanup (polish rows) | renamed **Output** (vocabulary moves here; verify its current section during implementation) |
| Appearance (uiLanguage + accent) | **Appearance** + one new row: Theme (System/Light/Dark segmented) |

Chip-style section nav across the top (as mocked up); keep `<details>` mechanics or replace with the nav — implementation may keep `<details open>` per section to minimize risk. Every existing setting id survives (src/dom.ts resolves ids at module load — a missing id throws, so removals are forbidden).

## History tweaks (soul intact)

- Structure unchanged: same list + search + detail.
- Add: two-step confirm on Clear history (`#clear-history-btn` first click → "Confirm?" state, timeout reverts); same confirm pattern for per-entry delete; per-entry copy affordance (clipboard.writeText) using existing `text-btn` styling.
- Add provenance: persist `engine`, `model`, `polishMode` per history entry (backend/history.cjs, guarded via normalizeHistoryData defaults for old entries) and render in the existing `history-item-meta` line.

## Also in scope (previously agreed quick wins)

- Translation-parity test (`test/i18n-parity.test.cjs`): every `en` i18n key exists in `ar` and `zh`.
- Font fallback: bundle IBM Plex Sans Arabic + Noto Sans SC woff2 in `src/fonts/`, extend font stacks (CSP `font-src 'self'` already permits).
- Sentence-case copy pass over `data-i18n` strings.
- Vocabulary chips + MAX_TERMS count UI (replaces bare textarea; keep the underlying setting shape unchanged).

## Explicit non-goals

- Streaming partials, per-app Modes, user-script pipeline, Qwen3-ASR, paste-last hotkey, CLI, Labs, benchmark corpus — all deferred to the roadmap (see docs/hex-research-report.md).
- No React/MUI/Tailwind; vanilla TS + hand-authored HTML only.
- No changes to settings schema beyond the new `theme` key.

## Verification

- `npm test` passes including the new i18n parity test.
- Manual check both themes on the main window, settings, history, and overlay (overlay must stay dark in light mode).
- All existing element ids intact (dom.ts throws on missing ids — build is the first gate).
