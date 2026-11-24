# 01 — Light theme token set + data-theme plumbing

Status: resolved
Blocked by: —

## Task

Add the black-and-white light token set as a `[data-theme="light"]` block in `src/style.css` alongside the unchanged dark `:root` set, and apply the attribute from `theme.ts`. Overlay windows always receive `data-theme="dark"` regardless of setting (see spec §Locked decisions). Sweep `style.css` for any hardcoded color literals that break under the light theme and token-ize them (the accent→hover pair fix for issue #08 was the precedent).

## Acceptance

- Light palette matches spec §Theme architecture; accent defaults to black in light mode.
- Current dark appearance is pixel-identical to today when `data-theme` is absent or `dark`.
- Overlay stays dark in both themes.
- `npm run build` passes (dom.ts id gate).

## Comments

- `src/style.css`: dark `:root` values UNCHANGED. Added `[data-theme="light"]` block with the spec palette; `--panel-hover` (not in the spec list) set to #f1efe8 (same as surface-hover). Light accent defaults: `--accent #171717`, `--accent-hover #333333` (= lighten(#171717, 0.12), matching what theme.ts derives for a custom black accent), `--accent-subtle rgba(0,0,0,0.08)` per spec.
- Contrast choices on white (hues kept, darkened): `--success` #22c55e → **#15803d** (4.5:1 — used as text in `.model-status.ok`), `--danger` #f43f5e → **#e11d48** (4.5:1 — used as text in `#status-error`/`.model-status.err`). Danger *tints* (`--danger-subtle`) adjusted alpha slightly for the lighter base.
- New tokens `--danger-text` (#fb7185 dark / #be123c light) and `--danger-text-strong` (#fda4af dark / #9f1239 light): the pale rose text literals were unreadable on white. Dark values identical to the literals they replaced, so dark rendering is unchanged.
- Hardcoded-literal sweep results (src/style.css): token-ized `#record-btn.recording` (was `color:#fff` + `background:rgba(139,92,246,0.16)` → now `var(--text)` + `var(--accent-subtle)`; dark diff is imperceptible: #ececf1 vs #fff text, alpha 0.14 vs 0.16 tint), `#translation-error`/#ctrl-btn.danger/#btn-danger-sm rose text literals → the new `--danger-text*` tokens. Verified OK to keep as-is: `#fff` text on accent/danger fills (works with the black light accent), amber literals on `#status-dot.transcribing`/`#record-btn.transcribing` (readable on both), success glow + `rgba(0,0,0,0.3)` toggle shadow (shadows, theme-neutral).
- `src/theme.ts`: added `applyTheme(theme)` — sets `data-theme` on documentElement; `system` resolves via `matchMedia('(prefers-color-scheme: light)')` with a live change listener (attached only while `system` is active, removed when an explicit theme is pinned); duplicate applications coalesced; documented ORDERING rule (applyTheme before applyAccentColor — accent never clobbered, and settings-form now calls them in that order in both loadSettingsIntoUi and runPersist). Added `isThemeSetting`/`normalizeThemeSetting` guards (mirrors i18n's normalizeUILanguage pattern). `applyAccentColor` untouched.
- Overlay dark made EXPLICIT: `src/overlay.ts` sets `document.documentElement.dataset.theme = 'dark'` at module load with a spec-reference comment (overlay.html has its own self-contained hardcoded-dark inline styles, so the attribute is future-proofing — it guarantees a later default flip can't lighten the window if it ever moves onto the shared tokens).
- Widget (`src/widget/`): NOT touched — `widget.html` loads only its own `widget.css`, which shares no tokens with `style.css` and has no `[data-theme]` rules, so it is always-dark by construction and unreachable by the theme setting. Reported rather than changed.
- Full suite green (578 tests), build green.

## Comments
