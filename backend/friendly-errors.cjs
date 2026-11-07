function msg(e){ if(e instanceof Error && e.message) return e.message; return String(e||''); }
function friendlyMessageFor(err){
  const m = msg(err); const name = err && err.name ? String(err.name) : ''; const code = err && err.code ? String(err.code) : '';
  // Whisper-binary failures keep their specific guidance: an EACCES on the
  // whisper spawn is about the binary, not about disk space, so the context
  // check runs BEFORE the generic disk-code rule below (A5).
  if ((code==='EACCES' && /whisper|spawn/i.test(m)) || /not executable|permission denied.*whisper/i.test(m)) return 'Whisper binary is not executable — check permissions or re-select it in Settings.';
  // Disk failures before everything else: an EACCES/ENOSPC/EROFS on the temp
  // WAV or history file must never be reported as a microphone problem (A5).
  if(code==='EACCES'||code==='ENOSPC'||code==='EROFS'||/EACCES|ENOSPC|EROFS|disk full|insufficient disk space|no space left/i.test(m)) return 'Could not write to disk — check free space and folder permissions.';
  // Auth BEFORE the generic "denied": "403 permission denied" is a key error (#21).
  if(/401|403|invalid api key|unauthorized/i.test(m)) return 'Invalid API key — check Settings and try again.';
  if(name==='NotAllowedError'||name==='SecurityError'||/permission|not allowed|denied/i.test(m)) return 'Microphone blocked — allow access in system settings, then try again.';
  if(name==='NotFoundError'||name==='OverconstrainedError'||/requested device not found|no microphone|device not found/i.test(m)) return 'Microphone not found — check connection, then try again.';
  if(/NotReadableError|busy|in use|could not start/i.test(m)) return 'Microphone is busy — close other apps using it, then try again.';
  if(code==='ENOENT'||/ENOENT|binary not found|whisper binary not found/i.test(m)) return 'Whisper binary not found — use Select Binary in Settings to locate whisper-cli.';
  if(/model not found|download a model/i.test(m)) return 'Whisper model not found — download it in Settings first.';
  if(/crashed|0xC000|access violation|stack.*overrun/i.test(m)) return 'Whisper binary crashed — try a CPU-only build or reinstall VC++ Redistributable.';
  if(/api key not set|api key.*required/i.test(m)) return 'API key missing — add it in Settings first.';
  if(/ENOTFOUND|network|fetch failed|timeout|offline/i.test(m)) return 'Network error — check connection and retry.';
  if(/no speech|empty transcript|no transcript|silence/i.test(m)) return 'No speech detected — check mic level and try again.';
  // Name-only abort check: message wording ("aborted by peer (HTTP 502)") is
  // a real failure and must fall through to the caller's error (A4 / F-15).
  if(name==='AbortError') return null;
  if(!m || /whisper\.cpp failed|stderr:|exit code:/i.test(m)) return 'Transcription failed — see details and try again.';
  return null;
}
function getDetails(err){ if(err instanceof Error && typeof err.details==='string' && err.details) return err.details; return msg(err)||undefined; }
module.exports={friendlyMessageFor,getDetails};
