# 01 — Light theme token set + data-theme plumbing

Status: ready-for-human
Blocked by: —

## Task

Add the black-and-white light token set as a `[data-theme="light"]` block in `src/style.css` alongside the unchanged dark `:root` set, and apply the attribute from `theme.ts`. Overlay windows always receive `data-theme="dark"` regardless of setting (see spec §Locked decisions). Sweep `style.css` for any hardcoded color literals that break under the light theme and token-ize them (the accent→hover pair fix for issue #08 was the precedent).

## Acceptance

- Light palette matches spec §Theme architecture; accent defaults to black in light mode.
- Current dark appearance is pixel-identical to today when `data-theme` is absent or `dark`.
- Overlay stays dark in both themes.
- `npm run build` passes (dom.ts id gate).

## Comments
