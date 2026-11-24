# 03 — Settings regroup: Input+Engine → Speech, Cleanup → Output

Status: resolved
Blocked by: —

## Task

In `index.html`: merge the Input and Engine sections into one **Speech** section (hotkey rows first, then engine/model/download and the advanced sub-block); rename **Cleanup** to **Output** (new i18n keys) and move the vocabulary row into it (verify its current location first); add the chip-style section nav per the approved mockup. Every existing element id must survive unchanged (src/dom.ts resolves ids at load and throws on missing). Update section-related i18n keys in en/ar/zh.

## Acceptance

- All five old sections' rows exist in the new layout; zero settings removed or renamed as keys.
- Build passes; manual pass over every row still persists settings.

## Comments

- `index.html`: Input + Engine merged into one **Speech** section (`<details class="settings-section" open id="section-speech">`), ordered mic → recording mode → capture hotkey → pause hotkey → engine/model/download rows → advanced sub-block. Cleanup renamed **Output** (`id="section-output"`). Language (`#section-language`) and Appearance (`#section-appearance`) unchanged apart from ids. Only Speech has the default-`open` attribute (matches today's Input).
- VOCAB ROW ORIGINAL LOCATION: `#vocab-input` already lived in the **Cleanup** section (between the AI-polish row and the section end), so "move vocabulary into Output" was accomplished by the rename itself — no cross-section move was needed. Zero rows left the panel.
- Chip-style section nav added: `<nav id="settings-nav">` with four chips between `#settings-heading` and `.settings-panel`. Least-invasive behavior: chip click sets `target.open = true` on the `<details>` (handles collapsed sections) then `scrollIntoView({behavior:'smooth', block:'start'})`. `<details>` mechanics kept. No mockup file exists in .scratch/ui-retheme, so chip styling follows the existing conventions (pill border-radius 999px, border-strong/text-secondary tokens, accent hover — see the `#settings-nav` block appended to style.css).
- EVERY id survives: no id removed or renamed; only additive ids (section-speech/language/output/appearance, settings-nav). Build passes the dom.ts id gate.
- i18n: removed `settings.section.input`, `settings.section.engine`, `settings.section.cleanup` from en/ar/zh (nothing else referenced them — verified by grep); added `settings.section.speech`, `settings.section.output`, `settings.navAria`. Key-count tests bumped 198 → 201. NOTE: row-label keys stay under `settings.cleanup.*` (e.g. `settings.cleanup.myWords`) — only the section key was renamed; renaming every row key would churn the ar/zh native-review comments for zero user-visible gain.
- Tests: `i18n-markup.test.cjs` "five settings sections" updated to four (with the regroup rationale) and its `open` regex adjusted (`<details class="settings-section" open ` — the open section now also carries its id). Full suite 578/578 green; build green.
