'use strict';
// test/critical-path-b8.test.cjs
//
// Behavioural coverage for the critical dictation path (B8):
//   - QA-03: backend/transcribe.cjs (the engine dispatcher) executed for real,
//     with injected engine fakes — routing and exact-argument passthrough.
//   - QA-04: src/widget/widget.js vm-executed with a fake DOM — button
//     dispatch, state projection, accent application, debug pin, sentinel.
//   - QA-10: real-module tests for src/audio/level.ts, src/store.ts,
//     backend/languages.cjs. (status.ts/recording.ts/audio-recorder.ts were
//     covered behaviourally by the B2/B4 batches; cited in the ticket.)
//   - QA-05: the harness rejects overrides for the module under test.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { loadTs } = require('./helpers/ts-loader.cjs');
const { loadMain } = require('./helpers/electron-main-harness.cjs');

// ── QA-03: the transcription dispatcher ─────────────────────────────────────

function loadTranscribeWithFakeEngines(t) {
  const calls = [];
  const engineFake = (name) => ({
    transcribe: async (...args) => { calls.push({ engine: name, args }); return { text: `text-from-${name}`, detectedLanguage: 'en' }; },
    testConnection: async (...args) => { calls.push({ engine: name, fn: 'testConnection', args }); return { ok: true, message: `connected-${name}` }; },
  });
  const names = ['deepgram.cjs', 'speechmatics.cjs', 'local-whisper.cjs'];
  const fakes = {
    'deepgram.cjs': engineFake('deepgram'),
    'speechmatics.cjs': engineFake('speechmatics'),
    'local-whisper.cjs': engineFake('local-whisper'),
  };
  const enginePaths = names.map((n) => require.resolve(`../backend/engines/${n}`));
  const modelPath = require.resolve('../backend/model-download.cjs');
  const modelFake = {
    modelFilename: () => 'model.bin',
    modelDownloadUrl: () => 'https://example.com/model.bin',
    modelDownloaded: () => true,
    downloadModel: async () => 'downloaded',
  };
  const saved = new Map();
  names.forEach((n, i) => {
    const resolved = enginePaths[i];
    if (require.cache[resolved]) saved.set(resolved, require.cache[resolved]);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: fakes[n] };
  });
  if (require.cache[modelPath]) saved.set(modelPath, require.cache[modelPath]);
  require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: modelFake };
  const modResolved = require.resolve('../backend/transcribe.cjs');
  const prevMod = require.cache[modResolved];
  delete require.cache[modResolved];
  t.after(() => {
    delete require.cache[modResolved];
    if (prevMod) require.cache[modResolved] = prevMod;
    for (const resolved of [...enginePaths, modelPath]) {
      delete require.cache[resolved];
      if (saved.has(resolved)) require.cache[resolved] = saved.get(resolved);
    }
  });
  return { transcribe: require('../backend/transcribe.cjs'), calls };
}

test('the dispatcher routes each engine call with its exact argument list (QA-03)', async (t) => {
  const { transcribe, calls } = loadTranscribeWithFakeEngines(t);

  await transcribe.transcribeDeepgram('K', 'a.wav', 'en', 'nova-3', null, 'light', ['vocab']);
  await transcribe.transcribeSpeechmatics('K', 'a.wav', 'de', null, 'thorough', []);
  await transcribe.transcribeLocal('small', 'a.wav', 'auto', '', null, 'light', []);

  assert.deepEqual(calls.map((c) => c.engine), ['deepgram', 'speechmatics', 'local-whisper']);
  assert.deepEqual(calls[0].args, ['K', 'a.wav', 'en', 'nova-3', null, 'light', ['vocab']],
    'deepgram receives (key, audio, language, model, signal, polish, vocab) in order');
  assert.deepEqual(calls[1].args, ['K', 'a.wav', 'de', null, 'thorough', []],
    'speechmatics receives (key, audio, language, signal, polish, vocab) in order');
  assert.deepEqual(calls[2].args, ['small', 'a.wav', 'auto', '', null, 'light', []],
    'local receives (model, audio, language, binary, signal, polish, vocab) in order');

  const result = await transcribe.transcribeDeepgram('K', 'a.wav', 'en', 'nova-3', null, 'light', []);
  assert.equal(result.text, 'text-from-deepgram', 'the engine result is passed through, not reshaped');
});

test('connection tests and model helpers are re-exported through the dispatcher (QA-03)', async (t) => {
  const { transcribe, calls } = loadTranscribeWithFakeEngines(t);
  await transcribe.testDeepgramConnection('K');
  await transcribe.testSpeechmaticsConnection('K');
  assert.deepEqual(calls.map((c) => `${c.engine}.${c.fn}`), ['deepgram.testConnection', 'speechmatics.testConnection']);
  assert.equal(typeof transcribe.modelFilename, 'function');
  assert.equal(typeof transcribe.downloadModel, 'function');
  assert.equal(transcribe.modelDownloaded(), true);
});

// ── QA-04: the widget runtime, vm-executed ──────────────────────────────────

function makeElement(id) {
  const listeners = new Map();
  return {
    id,
    listeners,
    addEventListener(type, handler) { listeners.set(type, handler); },
    click(type = 'click') { const h = listeners.get(type); if (h) h({}); },
    setAttribute(key, value) { this[`attr-${key}`] = value; },
    classList: { add() {}, remove() {}, toggle() {} },
    style: { setProperty() {}, transform: '' },
    dataset: {},
    textContent: '',
    querySelectorAll(selector) {
      if (selector !== 'i') return [];
      return this.bars || [];
    },
  };
}

function loadWidgetRuntime({ api, search = '' }) {
  const bars = Array.from({ length: 12 }, () => makeElement('bar'));
  const stage = makeElement('stage');
  const barsEl = makeElement('bars');
  barsEl.bars = bars;
  const elements = {
    stage,
    bars: barsEl,
    'live-region': makeElement('live-region'),
    'btn-pause': makeElement('btn-pause'),
    'btn-stop': makeElement('btn-stop'),
    'btn-cancel': makeElement('btn-cancel'),
  };
  let cssVar = null;
  const document = {
    getElementById: (id) => elements[id] || null,
    documentElement: { style: { setProperty: (k, v) => { cssVar = `${k}=${v}`; } } },
  };
  const window = {
    api,
    location: { search },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  };
  const sandbox = { window, console, document, globalThis: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.resolve('src/widget/widget-pure.js'), 'utf8'), sandbox, { filename: 'widget-pure.js' });
  vm.runInContext(fs.readFileSync(path.resolve('src/widget/widget.js'), 'utf8'), sandbox, { filename: 'widget.js' });
  return { window, elements, bars, cssVar: () => cssVar };
}

const TICK = () => new Promise((resolve) => setImmediate(resolve));

test('widget buttons dispatch exactly one overlay action each (QA-04)', async (t) => {
  const actions = [];
  const { elements } = loadWidgetRuntime({
    api: {
      overlayAction: (action) => { actions.push(action); return Promise.resolve(); },
      onRecordingState: () => () => {},
      onMicLevel: () => () => {},
      onSettingsUpdated: () => () => {},
      getRecordingState: () => Promise.resolve('idle'),
      getSettings: () => Promise.resolve({}),
    },
  });
  elements['btn-stop'].click();
  elements['btn-cancel'].click();
  elements['btn-pause'].click();
  await TICK();
  assert.deepEqual(actions, ['stop', 'cancel', 'pause']);
});

test('the pause button is context-aware: paused state sends resume (QA-04)', async (t) => {
  const actions = [];
  let stateCb = null;
  const { elements } = loadWidgetRuntime({
    api: {
      overlayAction: (action) => { actions.push(action); return Promise.resolve(); },
      onRecordingState: (cb) => { stateCb = cb; return () => {}; },
      getRecordingState: () => Promise.resolve('paused'),
      getSettings: () => Promise.resolve({}),
    },
  });
  await TICK(); await TICK();
  elements['btn-pause'].click();
  await TICK();
  assert.deepEqual(actions, ['resume'], 'clicking pause while paused resumes');
  assert.equal(elements['btn-pause']['attr-aria-label'], 'Resume');
  void stateCb;
});

test('recording-state pushes project onto the capsule; garbage cannot crash it (QA-04)', async (t) => {
  let stateCb = null;
  const { window, elements } = loadWidgetRuntime({
    api: {
      overlayAction: () => Promise.resolve(),
      onRecordingState: (cb) => { stateCb = cb; return () => {}; },
      onMicLevel: () => () => {},
      onSettingsUpdated: () => () => {},
      getRecordingState: () => Promise.resolve('ready'),
      getSettings: () => Promise.resolve({}),
    },
  });
  await TICK(); await TICK();
  assert.equal(elements.stage.dataset.state, 'idle');
  stateCb('recording');
  assert.equal(elements.stage.dataset.state, 'listening');
  assert.equal(elements['live-region'].textContent, 'Listening');
  // An unknown RECORDER state projects to idle by design (widget-pure:
  // "unknown input is idle, so an unexpected payload can never blank the
  // capsule" — with a visible state, not a crash).
  stateCb('totally-bogus');
  assert.equal(elements.stage.dataset.state, 'idle');
  // A garbage WIDGET state, however, is ignored outright (setState guard):
  // the state is returned unchanged and the DOM is not touched.
  assert.equal(window.__kimflowWidgetSetState('bogus'), 'idle', 'garbage widget state leaves the state untouched');
  assert.equal(elements.stage.dataset.state, 'idle');
});

test('the accent colour reaches --live and the ready sentinel is set (QA-04)', async (t) => {
  const { window, cssVar } = loadWidgetRuntime({
    api: {
      overlayAction: () => Promise.resolve(),
      onRecordingState: () => () => {},
      onSettingsUpdated: () => () => {},
      getRecordingState: () => Promise.resolve('idle'),
      getSettings: () => Promise.resolve({ accentColor: '#123456' }),
    },
  });
  await TICK(); await TICK();
  assert.equal(cssVar(), '--live=#123456');
  assert.equal(window.__kimflowWidgetReady, true, 'the launch smoke sentinel must be set by the runtime itself');
  assert.equal(typeof window.__kimflowWidgetSetState, 'function');
  assert.equal(window.__kimflowWidgetSetState('processing'), 'processing');
});

test('the debug pin forces a state and ignores live updates (QA-04)', async (t) => {
  let stateCb = null;
  const { elements } = loadWidgetRuntime({
    api: {
      overlayAction: () => Promise.resolve(),
      onRecordingState: (cb) => { stateCb = cb; return () => {}; },
      getRecordingState: () => Promise.resolve('idle'),
      getSettings: () => Promise.resolve({}),
    },
    search: '?debug=processing',
  });
  await TICK(); await TICK();
  assert.equal(elements.stage.dataset.state, 'processing', 'the debug pin is applied');
  stateCb('recording');
  assert.equal(elements.stage.dataset.state, 'processing', 'live updates are ignored while pinned');
});

test('a missing window.api must not break the widget load (QA-04)', () => {
  const { window } = loadWidgetRuntime({ api: undefined });
  assert.equal(window.__kimflowWidgetReady, true, 'the widget degrades to idle without a bridge');
});

// ── QA-10: small never-executed modules ─────────────────────────────────────

test('micLevelFromRms maps the speech window perceptually (QA-10)', () => {
  const { micLevelFromRms } = loadTs('src/audio/level.ts');
  assert.equal(micLevelFromRms(0), 0);
  assert.equal(micLevelFromRms(-1), 0);
  assert.equal(micLevelFromRms(NaN), 0);
  assert.equal(micLevelFromRms(Infinity), 1);
  assert.equal(micLevelFromRms(0.01), 0.5, 'normal speech (−40 dB) sits at half scale');
  assert.equal(micLevelFromRms(0.1), 1, 'loud speech (−20 dB) is full scale');
  assert.equal(micLevelFromRms(0.0009), 0, 'below −60 dB is silence');
  const quiet = micLevelFromRms(0.003);
  assert.ok(quiet > 0.15 && quiet < 0.4, `quiet speech must be audible on the bars, got ${quiet}`);
});

test('the settings store round-trips and starts empty (QA-10)', () => {
  const store = loadTs('src/store.ts');
  assert.equal(store.getSettings(), undefined, 'a fresh store is empty');
  const settings = { engine: 'deepgram', hotkey: 'F2' };
  store.setSettings(settings);
  assert.equal(store.getSettings(), settings);
});

test('languages.cjs lists are internally consistent (QA-10)', () => {
  const languages = require('../backend/languages.cjs');
  const input = languages.inputLanguages(); // [{value,label}] entries
  const target = languages.targetLanguages();
  const inputCodes = input.map((entry) => entry.value);
  const targetCodes = target.map((entry) => entry.value);
  assert.ok(inputCodes.includes(languages.AUTO), 'auto detect is an input language');
  assert.ok(!targetCodes.includes(languages.AUTO), 'auto detect is not a translation TARGET');
  for (const code of inputCodes) {
    if (code === languages.AUTO) continue;
    assert.ok(languages.isKnownLanguage(code), `input language ${code} must be known`);
    const entry = input.find((e) => e.value === code);
    assert.ok(entry.label && entry.label.length > 0, `input language ${code} must have a label`);
  }
  for (const code of targetCodes) {
    assert.ok(languages.isKnownLanguage(code), `target language ${code} must be known`);
    assert.equal(targetCodes.filter((c) => c === code).length, 1, `target language ${code} must not be duplicated`);
  }
});

// ── QA-05: harness override guard self-test ─────────────────────────────────

test('the harness rejects overrides for the module under test (QA-05)', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-b8-'));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });
  await assert.rejects(
    async () => loadMain({ locale: 'en-US', home, overrides: { 'settings.cjs': { getSettings: () => ({}) } } }),
    /not allowed/,
    'an override for settings.cjs would replace the module under test',
  );
});
