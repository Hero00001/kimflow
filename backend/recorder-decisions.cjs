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
// Matches an aborted signal, an AbortError name, or abort wording in the
// message. Unifies three previously divergent checks (/abort/i,
// /aborted/i, /aborted|abortion/i) on the broadest form — the only strings
// that change classification mention "abort" without "aborted", which in
// practice is abort-machinery misuse, correctly treated as abort.
function isAbortError(error, signal) {
  if (signal?.aborted) return true;
  if (error && error.name === 'AbortError') return true;
  return /abort/i.test(errorMessageText(error));
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
