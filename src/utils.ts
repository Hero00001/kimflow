export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function errorDetails(error: unknown): string | undefined {
  if (error instanceof Error && typeof (error as Error & { details?: unknown }).details === 'string') {
    const d = (error as Error & { details: string }).details; return d.length ? d : undefined;
  }
  const m = error instanceof Error ? error.message : String(error ?? '');
  return m.length > 180 ? m : undefined;
}
export function friendlyError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && (error as { aborted?: boolean }).aborted) return '';
  const m = error instanceof Error && error.message ? error.message : String(error ?? '');
  if (/^(Microphone|Whisper|Invalid API|API key|Network|No speech|Transcription failed)/.test(m)) return m.split('\n')[0];
  const table: Array<[RegExp, string]> = [
    [/permission|not allowed|denied/i, 'Microphone blocked — allow access in system settings, then try again.'],
    [/device not found|no microphone|overconstrained/i, 'Microphone not found — check connection, then try again.'],
    [/ENOENT|binary not found/i, 'Whisper binary not found — use Select Binary in Settings to locate whisper-cli.'],
    [/model not found/i, 'Whisper model not found — download it in Settings first.'],
    [/crashed|0xC000/i, 'Whisper binary crashed — try a CPU-only build or reinstall VC++ Redistributable.'],
    [/401|403|invalid api key/i, 'Invalid API key — check Settings and try again.'],
    [/ENOTFOUND|fetch failed|timeout/i, 'Network error — check connection and retry.'],
    [/empty transcript|no speech|no transcript/i, 'No speech detected — check mic level and try again.'],
  ];
  for (const [re, text] of table) if (re.test(m)) return text;
  if (/abort/i.test(m)) return '';
  return fallback;
}
