'use strict';
// test/dictation-correctness-b2.test.cjs
//
// Fail-first tests for B2 (dictation correctness). Each test MUST fail against
// the pre-B2 code and pass after it:
//   - F-01: a cancel during translation/AI polish pastes the late result and
//           leaves the history entry behind.
//   - F-02: recorder.cjs re-cleaned an already-cleaned transcript, and the
//           second 'thorough' pass deleted valid words.
//   - F-06: a digit-leading transcript had its first LETTER capitalised.
//   - F-10: a terminal ':' / ';' got a full stop appended after it.
//   - F-09: a decimal number-word run swallowed punctuation and merged two
//           numbers ("three point one, four" -> 3.14).
//   - #01:  the Speechmatics poll deadline fell through and a non-string body
//           was JSON.stringify'd into the transcript.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanupText } = require('../backend/cleanup.cjs');
const { formatNumberWords } = require('../backend/format-numbers.cjs');

const TICK = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Load the real backend/recorder.cjs with fake audio/paste/transcribe/
 * translation/history modules injected through require.cache, against an
 * isolated HOME so CONFIG_DIR points at a throwaway directory.
 */
function loadRecorder(t, fakes) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-b2-'));
  const prevProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;

  const fakeNames = ['audio.cjs', 'paste.cjs', 'transcribe.cjs', 'translation.service.cjs', 'history.cjs'];
  const fakePaths = fakeNames.map((n) => require.resolve(`../backend/${n}`));
  const saved = new Map();
  for (let i = 0; i < fakeNames.length; i += 1) {
    const resolved = fakePaths[i];
    if (require.cache[resolved]) saved.set(resolved, require.cache[resolved]);
    require.cache[resolved] = {
      id: resolved, filename: resolved, loaded: true,
      exports: fakes[fakeNames[i]],
    };
  }

  const recorderResolved = require.resolve('../backend/recorder.cjs');
  const prevRecorder = require.cache[recorderResolved];
  delete require.cache[recorderResolved];

  process.env.USERPROFILE = home;
  process.env.HOME = home;

  const recorder = require('../backend/recorder.cjs');

  t.after(() => {
    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    delete require.cache[recorderResolved];
    if (prevRecorder) require.cache[recorderResolved] = prevRecorder;
    for (let i = 0; i < fakePaths.length; i += 1) {
      const resolved = fakePaths[i];
      delete require.cache[resolved];
      if (saved.has(resolved)) require.cache[resolved] = saved.get(resolved);
    }
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
  });

  return recorder;
}

function defaultFakes() {
  const state = {
    pasted: [],
    historyAdded: [],
    historyRemoved: [],
    engineText: 'Second, I mean third.',
  };
  const fakes = {
    'audio.cjs': {
      AudioRecorder: class {
        async start() {}
        async stop() {}
        async saveWav() {}
      },
    },
    'paste.cjs': {
      pasteText: async (text) => { state.pasted.push(text); return { ok: true }; },
    },
    'transcribe.cjs': {
      transcribeDeepgram: async () => ({ text: state.engineText, detectedLanguage: 'en' }),
      transcribeSpeechmatics: async () => ({ text: '', detectedLanguage: null }),
      transcribeLocal: async () => ({ text: '', detectedLanguage: null }),
    },
    'translation.service.cjs': {
      translate: async () => 'TRANSLATED',
      polish: async () => '',
      warmup: async () => {},
    },
    'history.cjs': {
      addSession: (entry) => { state.historyAdded.push(entry); return { id: 'h1' }; },
      updateSession: () => {},
      removeSession: (id) => { state.historyRemoved.push(id); return true; },
      load: () => ({ sessions: [] }),
      clear: () => ({ sessions: [] }),
    },
  };
  return { state, fakes };
}

test('cancel during translation pastes nothing and takes back the history entry', async (t) => {
  const { state, fakes } = defaultFakes();
  let resolveTranslate;
  fakes['translation.service.cjs'].translate = () => new Promise((r) => { resolveTranslate = r; });
  const recorder = loadRecorder(t, fakes);

  const settings = {
    engine: 'deepgram', inputLanguage: 'en', translationEnabled: true,
    translationTarget: 'es', translationProvider: 'gemini', polishMode: 'light',
    aiPolish: false,
  };
  await recorder.startRecording(settings, []);
  const stopPromise = recorder.stopRecording(settings, [], Buffer.alloc(8));
  await TICK(); await TICK(); await TICK(); // let the pipeline reach the translate await
  await recorder.cancelRecording([]);
  resolveTranslate('TRANSLATED');
  const result = await stopPromise;

  assert.equal(result.aborted, true, 'a cancelled dictation reports aborted');
  assert.deepEqual(state.pasted, [], 'the late translation must never be pasted');
  assert.equal(state.historyAdded.length, 1, 'the entry existed before the cancel');
  assert.deepEqual(state.historyRemoved, ['h1'], 'the cancelled entry is taken back');
});

test('cancel during AI polish pastes nothing', async (t) => {
  const { state, fakes } = defaultFakes();
  let resolvePolish;
  fakes['translation.service.cjs'].polish = () => new Promise((r) => { resolvePolish = r; });
  const recorder = loadRecorder(t, fakes);

  const settings = {
    engine: 'deepgram', inputLanguage: 'en', translationEnabled: false,
    polishMode: 'light', aiPolish: true, translationProvider: 'gemini',
  };
  await recorder.startRecording(settings, []);
  const stopPromise = recorder.stopRecording(settings, [], Buffer.alloc(8));
  await TICK(); await TICK(); await TICK(); // reach the polish await
  await recorder.cancelRecording([]);
  resolvePolish('AI-POLISHED');
  const result = await stopPromise;

  assert.equal(result.aborted, true, 'a cancelled dictation reports aborted');
  assert.deepEqual(state.pasted, [], 'the late polish result must never be pasted');
});

test('an already-cleaned transcript is NOT cleaned a second time', async (t) => {
  const { state, fakes } = defaultFakes();
  // The engine already ran cleanupText('thorough') on its raw output; this is
  // exactly what a single pass produces.
  state.engineText = 'Second, I mean third.';
  const recorder = loadRecorder(t, fakes);

  const settings = { engine: 'deepgram', inputLanguage: 'en', translationEnabled: false, polishMode: 'thorough', aiPolish: false };
  await recorder.startRecording(settings, []);
  const result = await recorder.stopRecording(settings, [], Buffer.alloc(8));

  assert.equal(result.text, 'Second, I mean third.',
    'the engine-cleaned text must be delivered as-is (a second thorough pass deletes valid words)');
  assert.deepEqual(state.pasted, ['Second, I mean third.']);
});

test('digit-leading transcripts are not mid-capitalised (F-06)', () => {
  assert.equal(cleanupText('twenty three apples', 'light'), '23 apples.');
  assert.equal(cleanupText('2024 was a good year', 'light'), '2024 was a good year.');
});

test('terminal colon and semicolon do not get a full stop appended (F-10)', () => {
  assert.equal(cleanupText('the items are colon', 'light'), 'The items are:');
  assert.equal(cleanupText('a pause semicolon', 'light'), 'A pause;');
  // A plain sentence still gets its full stop.
  assert.equal(cleanupText('hello world', 'light'), 'Hello world.');
});

test('a punctuation-marked decimal digit ends the number (F-09)', () => {
  assert.equal(formatNumberWords('the value is three point one, four'), 'the value is 3.1, 4');
  assert.equal(formatNumberWords('pi is three point one four.'), 'pi is 3.14.');
});

function tempAudio(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-b2-audio-'));
  const file = path.join(dir, 'audio.wav');
  fs.writeFileSync(file, Buffer.from('RIFF'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  return file;
}

test('speechmatics rejects instead of pasting a body for an unfinished job (#01)', async (t) => {
  const audioPath = tempAudio(t);
  const requests = [];
  const axiosFake = {
    post: async () => ({ status: 200, data: { id: 'job-1' } }),
    get: async (url) => {
      requests.push(String(url));
      if (String(url).includes('/transcript')) return { status: 200, data: { detail: 'job not finished' } };
      return { status: 200, data: { job: { status: 'running' } } };
    },
  };
  const axiosResolved = require.resolve('axios');
  const prevAxios = require.cache[axiosResolved];
  require.cache[axiosResolved] = { id: axiosResolved, filename: axiosResolved, loaded: true, exports: axiosFake };
  const modResolved = require.resolve('../backend/engines/speechmatics.cjs');
  const prevMod = require.cache[modResolved];
  delete require.cache[modResolved];

  // First Date.now() call sizes the 120s deadline; every later call jumps past
  // it so the poll loop exits after zero iterations (no real waiting).
  const realNow = Date.now;
  let calls = 0;
  Date.now = () => { calls += 1; return calls === 1 ? realNow.call(Date) : realNow.call(Date) + 200000; };

  t.after(() => {
    Date.now = realNow;
    delete require.cache[modResolved];
    if (prevMod) require.cache[modResolved] = prevMod;
    delete require.cache[axiosResolved];
    if (prevAxios) require.cache[axiosResolved] = prevAxios;
  });

  const speechmatics = require('../backend/engines/speechmatics.cjs');
  await assert.rejects(
    () => speechmatics.transcribe('key', audioPath, 'en', undefined, 'light', []),
    /timed out/i,
    'a deadline fall-through must reject, never fetch a non-transcript body',
  );
});

test('speechmatics never stringifies a non-text transcript body (#01)', async (t) => {
  const audioPath = tempAudio(t);
  const axiosFake = {
    post: async () => ({ status: 200, data: { id: 'job-1' } }),
    get: async (url) => {
      if (String(url).includes('/transcript')) return { status: 200, data: { detail: 'error body' } };
      return { status: 200, data: { job: { status: 'done' } } };
    },
  };
  const axiosResolved = require.resolve('axios');
  const prevAxios = require.cache[axiosResolved];
  require.cache[axiosResolved] = { id: axiosResolved, filename: axiosResolved, loaded: true, exports: axiosFake };
  const modResolved = require.resolve('../backend/engines/speechmatics.cjs');
  const prevMod = require.cache[modResolved];
  delete require.cache[modResolved];
  t.after(() => {
    delete require.cache[modResolved];
    if (prevMod) require.cache[modResolved] = prevMod;
    delete require.cache[axiosResolved];
    if (prevAxios) require.cache[axiosResolved] = prevAxios;
  });

  const speechmatics = require('../backend/engines/speechmatics.cjs');
  await assert.rejects(
    () => speechmatics.transcribe('key', audioPath, 'en', undefined, 'light', []),
    /non-text transcript payload/i,
  );
});
