import { t } from './i18n';
import { en } from './i18n/locales/en';

/**
 * Error presentation.
 *
 * Electron only preserves `error.message` when an `ipcMain.handle` throws, and
 * the renderer receives it wrapped as `Error invoking remote method '<ch>': …`.
 * So this module is the single place that turns an error into display text:
 * it strips the IPC wrapper, then re-renders known backend English messages in
 * the active UI language. Backend diagnostics stay English by design; the
 * translation source of truth is `src/i18n/`.
 */

// Electron rebuilds a rejected `invoke` as:
//   `Error invoking remote method '<channel>': ` + thrownError.toString()
// (verified against electron.exe 33.4.11: the browser replies with
// `{error: t.toString()}` and the renderer prepends that literal). For a plain
// `Error('X')`, `toString()` is `'Error: X'`, so the wire message carries TWO
// prefixes. Both must go before the sentence can be matched to a locale key.
// The trailing `(?:\w*Error:\s*)?` also covers `AbortError`/`TranslationError`.
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/;

/** The error message with any Electron IPC wrapper (and name prefix) removed. */
function rawMessage(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : String(error ?? '');
  return message.replace(IPC_ERROR_PREFIX, '');
}

// Reverse index: exact English string -> locale key. Backend messages are
// always English, so this lets a finished sentence be re-rendered in the
// active language without the backend owning a copy of the locale data.
const KEY_BY_ENGLISH = new Map<string, string>();
for (const [key, value] of Object.entries(en)) {
  if (!KEY_BY_ENGLISH.has(value)) KEY_BY_ENGLISH.set(value, key);
}

/** The error message with any Electron IPC wrapper removed (for callers). */
export function errorText(error: unknown): string {
  return rawMessage(error);
}

/**
 * The raw diagnostic message, or the translated fallback when there is none.
 * Used where the message itself is the point (e.g. a startup failure).
 */
export function errorMessage(error: unknown, fallbackKey: string): string {
  return friendlyError(error, fallbackKey) || t(fallbackKey);
}

/** Full technical detail for a tooltip. Never translated — for maintainers. */
export function errorDetails(error: unknown): string | undefined {
  if (error instanceof Error && typeof (error as Error & { details?: unknown }).details === 'string') {
    const details = (error as Error & { details: string }).details;
    return details.length ? details : undefined;
  }
  // Every message ≤180 chars used to be discarded here, which hid the actual
  // reason for almost every backend error — the tooltip that should explain
  // the failure was blank (C1). The raw message IS the detail.
  const message = rawMessage(error);
  return message.length ? message : undefined;
}

/**
 * A short, user-facing message in the active language.
 *
 * Order of resolution:
 *   1. Aborted operations are silent (return '').
 *   2. A backend message that matches a known English string is re-rendered.
 *   3. A regex table maps recognisable failures to a locale key.
 *   4. Anything else falls back to the caller's translated fallback key.
 */
export function friendlyError(error: unknown, fallbackKey: string): string {
  if (error && typeof error === 'object' && (error as { aborted?: boolean }).aborted) return '';
  const message = rawMessage(error);

  // (2) Exact match against a known backend summary.
  const known = KEY_BY_ENGLISH.get(message.split('\n')[0]);
  if (known) return t(known);

  // getUserMedia failures happen in THIS renderer, so the DOMException name
  // survives — the most reliable microphone classification there is.
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return t('error.micBlocked');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return t('error.micNotFound');
  if (name === 'NotReadableError') return t('error.micBusy');

  // (3) Recognisable failure signatures. Ordered so a specific failure is
  // never shadowed by a broad pattern: disk errors before mic permission
  // (an EACCES on the temp WAV is NOT a microphone problem — A5), and auth
  // before the generic "denied" ("403 permission denied" is a key error — #21).
  const table: Array<[RegExp, string]> = [
    [/EACCES|ENOSPC|EROFS|disk full/i, 'error.storage'],
    [/device not found|no microphone|overconstrained/i, 'error.micNotFound'],
    [/401|403|invalid api key/i, 'error.invalidApiKey'],
    [/permission|not allowed|denied/i, 'error.micBlocked'],
    [/ENOENT|binary not found/i, 'error.whisperBinaryNotFound'],
    [/model not found/i, 'error.whisperModelNotFound'],
    [/crashed|0xC000/i, 'error.whisperCrashed'],
    [/ENOTFOUND|fetch failed|timeout/i, 'error.network'],
    [/empty transcript|no speech|no transcript/i, 'error.noSpeech'],
  ];
  for (const [pattern, key] of table) if (pattern.test(message)) return t(key);

  // The canonical abort message is still silent. A broad /abort/i used to
  // silence REAL failures like "Deepgram request aborted by peer (HTTP 502)"
  // — abort classification is name/signal-based in the backend now, and the
  // aborted-object check above is the only other silencer (A4 / F-15).
  if (message === 'Transcription aborted') return '';

  // (4) Caller-provided fallback.
  return t(fallbackKey);
}
