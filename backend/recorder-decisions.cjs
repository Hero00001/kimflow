// Pure orchestration decisions for the recording pipeline.
//
// This module holds side-effect-free logic extracted from recorder.cjs so it
// can be unit-tested without audio hardware, network, or filesystem mocks.
// Zero I/O here by design — everything takes values and returns values.

function selectPasteText({ translationEnabled, translation, finalText }) {
  if (!translationEnabled) return finalText;
  return translation || finalText;
}

function errorMessageText(error) {
  if (error instanceof Error && error.message) return error.message;
  if (error === null || error === undefined) return '';
  return String(error);
}

// Single abort classifier shared by the recorder and engine catch sites.
// Strictly name/signal-based: AbortError is what every abort path throws
// (engines' throwIfAborted, awaitAbortable, local-whisper's re-throw) and
// CanceledError is what axios throws when its signal aborts. Message text is
// deliberately NOT inspected: "Deepgram request aborted by peer (HTTP 502)"
// is a real network failure and used to be silently swallowed as a
// cancellation, making the dictation vanish with zero error (A4 / F-15).
function isAbortError(error, signal) {
  if (signal?.aborted) return true;
  if (error && (error.name === 'AbortError' || error.name === 'CanceledError')) return true;
  return false;
}

// Builds the shared AbortError without throwing, for promise-race rejection.
function abortError() {
  const error = new Error('Transcription aborted');
  error.name = 'AbortError';
  return error;
}

// Races a promise against an AbortSignal for SDKs with no signal support
// (e.g. Deepgram). The loser is dropped: late success is ignored, late
// failure is already handled by the attached handlers, so nothing rejects
// unobserved and temp files still clean up in the caller's finally.
function awaitAbortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

module.exports = { selectPasteText, isAbortError, awaitAbortable, abortError };
