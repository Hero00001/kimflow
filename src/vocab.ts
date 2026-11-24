/**
 * Pure vocabulary-list helpers shared by the settings form's chip view.
 *
 * The chips are a view over the vocab textarea's raw value, and removal used
 * to splice by the FILTERED term index — with any blank line in the textarea
 * that deleted the wrong raw line and left an unremovable ghost chip. Every
 * chip therefore now carries the RAW line index it came from, and removal
 * splices by that raw index. Kept DOM-free so the unit suite can exercise the
 * edge cases directly.
 */

/** One parsed vocabulary term and the raw textarea line it came from. */
export interface VocabChip {
  term: string;
  lineIndex: number;
}

/**
 * Parse raw textarea lines into chips: every non-blank line becomes one chip
 * carrying its own raw index (blank lines are skipped, not compacted — the
 * raw indices stay stable for removal).
 */
export function parseVocabChips(lines: string[]): VocabChip[] {
  const chips: VocabChip[] = [];
  lines.forEach((line, lineIndex) => {
    const term = line.trim();
    if (term) chips.push({ term, lineIndex });
  });
  return chips;
}

/**
 * A new lines array with the line at `rawIndex` removed. An out-of-range or
 * non-integer index is a no-op returning a copy — a stale chip click must
 * never corrupt the textarea value.
 */
export function removeVocabLine(lines: string[], rawIndex: number): string[] {
  if (!Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= lines.length) {
    return [...lines];
  }
  const next = [...lines];
  next.splice(rawIndex, 1);
  return next;
}
