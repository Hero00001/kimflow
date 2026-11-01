/**
 * KimFlow flow-bar widget renderer.
 *
 * Classic script: no imports, no bundler, no framework. It:
 *   - mirrors the recorder state the main process pushes on `recording-state`,
 *   - forwards button presses through `window.api.overlayAction(...)`,
 *   - paints the accent colour onto `--live`,
 *   - scales the bars from the microphone level (audio-reactive mode).
 *
 * The state machine lives in `backend/recorder.cjs`; this file never invents a
 * state, it only projects one (see `widget-pure.js`).
 */
(function () {
  'use strict';

  var pure = window.KimFlowWidgetPure || {};
  var WIDGET_STATES = ['idle', 'listening', 'paused', 'processing'];
  var LABELS = { idle: '', listening: 'Listening', paused: 'Paused', processing: 'Transcribing' };
  // Per-bar weight from the spec (§6.3): a fixed silhouette that the level
  // scales, so the bars never look random.
  var WEIGHTS = [0.5, 0.7, 0.9, 0.6, 1, 0.8, 0.95, 0.65, 0.85, 0.55, 0.75, 0.45];

  // ---- pure helpers, with local fallbacks if widget-pure.js is missing ----

  function isWidgetState(value) {
    if (typeof pure.isWidgetState === 'function') return pure.isWidgetState(value);
    return typeof value === 'string' && WIDGET_STATES.indexOf(value) !== -1;
  }

  function toWidgetState(recorderState) {
    if (typeof pure.toWidgetState === 'function') return pure.toWidgetState(recorderState);
    if (recorderState === 'recording') return 'listening';
    if (recorderState === 'paused') return 'paused';
    if (recorderState === 'transcribing') return 'processing';
    return 'idle';
  }

  function resolveAccentColor(accentColor) {
    if (typeof pure.resolveAccentColor === 'function') return pure.resolveAccentColor(accentColor);
    return '#ffffff';
  }

  function clampLevel(value) {
    if (typeof pure.clampLevel === 'function') return pure.clampLevel(value);
    if (typeof value !== 'number' || !isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }

  // ---- DOM ----

  var stage = document.getElementById('stage');
  var barsEl = document.getElementById('bars');
  var liveRegion = document.getElementById('live-region');
  var pauseBtn = document.getElementById('btn-pause');
  var stopBtn = document.getElementById('btn-stop');
  var cancelBtn = document.getElementById('btn-cancel');
  var bars = barsEl ? Array.prototype.slice.call(barsEl.querySelectorAll('i')) : [];

  var state = 'idle';

  function now() {
    return window.performance && typeof window.performance.now === 'function'
      ? window.performance.now()
      : Date.now();
  }

  // ---- state rendering ----

  function stopLoop() {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function setState(next) {
    if (!isWidgetState(next)) return; // ignore garbage, never throw
    state = next;
    if (stage) stage.dataset.state = next;
    if (liveRegion) liveRegion.textContent = LABELS[next] || '';
    if (pauseBtn) pauseBtn.setAttribute('aria-label', next === 'paused' ? 'Resume' : 'Pause');
    if (next !== 'listening') {
      // Hand the bars back to the CSS keyframes.
      if (barsEl) barsEl.classList.remove('live');
      for (var i = 0; i < bars.length; i += 1) bars[i].style.transform = '';
      stopLoop();
      level = 0;
      target = 0;
    }
  }

  // ---- audio-reactive bars ----

  var level = 0;
  var target = 0;
  var rafId = 0;
  var startedAt = 0;

  function startLoop() {
    if (rafId || state !== 'listening') return;
    if (barsEl) barsEl.classList.add('live');
    startedAt = now();
    rafId = window.requestAnimationFrame(tick);
  }

  function tick(timestamp) {
    rafId = 0;
    // Fast attack, slow release, so the capsule feels alive but not twitchy.
    level += (target - level) * (target > level ? 0.5 : 0.12);
    var t = (timestamp - startedAt) / 1000;
    for (var i = 0; i < bars.length; i += 1) {
      var jitter = 0.75 + 0.25 * Math.sin(t * 6 + i * 1.7);
      var scale = clampLevel(level * WEIGHTS[i % WEIGHTS.length] * jitter * 1.6);
      bars[i].style.transform = 'scaleY(' + Math.max(0.18, scale) + ')';
    }
    if (state === 'listening') rafId = window.requestAnimationFrame(tick);
  }

  function onLevel(value) {
    target = clampLevel(value);
    // No levels yet? The CSS keyframes keep animating, which is the same look.
    if (state === 'listening') startLoop();
  }

  // ---- bridge to the main process ----

  var api = window.api;

  function send(action) {
    if (!api || typeof api.overlayAction !== 'function') return;
    try {
      var pending = api.overlayAction(action);
      if (pending && typeof pending.catch === 'function') pending.catch(function () { /* main logged it */ });
    } catch (error) {
      // A rejected action must never break the widget's event handler.
    }
  }

  function applyAccent(settings) {
    var color = resolveAccentColor(settings && settings.accentColor);
    try {
      document.documentElement.style.setProperty('--live', color);
    } catch (error) {
      // Styling is best-effort; the CSS default stays white.
    }
  }

  // ---- dev-only state switcher ----
  //
  // `?debug=listening` pins one state and ignores live updates, which is how
  // the states are inspected by hand. It is inert in normal operation.
  function readDebugState() {
    try {
      var search = (window.location && window.location.search) || '';
      var match = /[?&]debug=([^&]*)/.exec(search);
      if (!match) return null;
      var candidate = decodeURIComponent(match[1]).toLowerCase();
      return isWidgetState(candidate) ? candidate : null;
    } catch (error) {
      return null;
    }
  }

  var forcedState = readDebugState();

  function applyRecordingState(recorderState) {
    if (forcedState) return;
    setState(toWidgetState(recorderState));
  }

  if (pauseBtn) {
    pauseBtn.addEventListener('click', function () {
      send(state === 'paused' ? 'resume' : 'pause');
    });
  }
  if (stopBtn) {
    stopBtn.addEventListener('click', function () { send('stop'); });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () { send('cancel'); });
  }

  if (api && typeof api.onRecordingState === 'function') {
    api.onRecordingState(function (next) { applyRecordingState(next); });
  }
  if (api && typeof api.onMicLevel === 'function') {
    api.onMicLevel(function (value) { onLevel(value); });
  }
  if (api && typeof api.onSettingsUpdated === 'function') {
    api.onSettingsUpdated(function (settings) { applyAccent(settings); });
  }
  if (api && typeof api.getRecordingState === 'function') {
    Promise.resolve(api.getRecordingState())
      .then(function (next) { applyRecordingState(next); })
      .catch(function () { /* keep idle */ });
  }
  if (api && typeof api.getSettings === 'function') {
    Promise.resolve(api.getSettings())
      .then(function (settings) { applyAccent(settings); })
      .catch(function () { /* keep the white default */ });
  }

  if (forcedState) setState(forcedState);

  /**
   * Test/screenshot hook: `scripts/widget-shot.cjs` drives the four states
   * through this. It is never called by the app itself.
   */
  window.__kimflowWidgetSetState = function (next) {
    setState(next);
    return state;
  };

  // Sentinel the main process / screenshot script checks to prove that the
  // renderer script actually ran (a CSP or path failure leaves it unset).
  window.__kimflowWidgetReady = true;
})();
