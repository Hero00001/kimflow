/**
 * KimFlow flow-bar widget — pure projection helpers.
 *
 * SOURCE OF TRUTH FOR STATE IS `backend/recorder.cjs`. This file only
 * PROJECTS the recorder's state onto the widget's visual states; it never
 * stores or advances a state of its own. (An earlier draft shipped a
 * `reduce()` transition table "for the dev switcher" — dead code no
 * production file referenced; removed (W6). A second state machine that can
 * drift away from the recorder must not exist, even inert.)
 *
 * Classic script: no imports, no DOM, no Electron. It attaches itself to
 * `window.KimFlowWidgetPure` for `widget.js`, and also exports the same object
 * through `module.exports` so a test loader can require it in a sandbox.
 */
(function (root) {
  'use strict';

  /** The four visual states the capsule can be in. */
  var WIDGET_STATES = ['idle', 'listening', 'paused', 'processing'];

  /** Recorder states (`backend/recorder.cjs` STATE) → widget states. */
  var RECORDER_TO_WIDGET = {
    ready: 'idle',
    recording: 'listening',
    paused: 'paused',
    transcribing: 'processing',
  };

  /** The accent colour shipped as the default; it renders as white, not purple. */
  var DEFAULT_ACCENT = '#8b5cf6';
  var HEX_COLOR = /^#[0-9a-f]{6}$/;

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  /**
   * Map a recorder state onto a widget state. Unknown input is `idle`, so a
   * missing or unexpected payload can never blank the capsule.
   *
   * @param {unknown} recorderState value received on `recording-state`
   * @returns {string} one of WIDGET_STATES
   */
  function toWidgetState(recorderState) {
    if (typeof recorderState !== 'string') return 'idle';
    return hasOwn(RECORDER_TO_WIDGET, recorderState) ? RECORDER_TO_WIDGET[recorderState] : 'idle';
  }

  /**
   * @param {unknown} value
   * @returns {boolean} true when `value` names a widget state
   */
  function isWidgetState(value) {
    return typeof value === 'string' && WIDGET_STATES.indexOf(value) !== -1;
  }

  /**
   * Resolve the colour used by the listening bars and the processing dots.
   *
   * The shipped default accent (`#8b5cf6`) is rendered white per the visual
   * spec, and an absent or malformed accent also falls back to white. Any
   * other valid hex colour is used as-is.
   *
   * @param {unknown} accentColor `settings.accentColor`
   * @returns {string} a `#rrggbb` string
   */
  function resolveAccentColor(accentColor) {
    var value = typeof accentColor === 'string' ? accentColor.trim().toLowerCase() : '';
    if (!HEX_COLOR.test(value)) return '#ffffff';
    if (value === DEFAULT_ACCENT) return '#ffffff';
    return value;
  }

  /**
   * Normalise a microphone level to 0…1. Non-numeric and non-finite input is
   * 0, so a broken level feed flattens the bars instead of hiding them.
   *
   * @param {unknown} value
   * @returns {number} a finite number in [0, 1]
   */
  function clampLevel(value) {
    if (typeof value !== 'number' || !isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
  }

  var namespace = {
    WIDGET_STATES: WIDGET_STATES,
    toWidgetState: toWidgetState,
    isWidgetState: isWidgetState,
    resolveAccentColor: resolveAccentColor,
    clampLevel: clampLevel,
  };

  root.KimFlowWidgetPure = namespace;

  if (typeof module !== 'undefined' && module && typeof module === 'object') {
    module.exports = namespace;
  }
})(typeof window !== 'undefined' ? window : globalThis);
