'use strict';
// backend/logging.cjs
//
// File logging for the packaged app. A normal Electron app has no terminal:
// every console.log/warn/error from the main process is invisible to the
// user, which made failures undiagnosable (the floating widget's crash
// recovery, engine failures, startup warnings). This module mirrors all
// console output into `<dir>/kimflow.log`.
//
// Design constraints:
// - must never break startup (all failures degrade to console-only);
// - synchronous appends: log volume is tiny and crash-last-lines matter more
//   than write throughput;
// - one-generation rotation at ~1 MB so the file cannot grow forever.

const fs = require('fs');
const path = require('path');

const MAX_LOG_BYTES = 1024 * 1024;
let logPath = null;
let installed = false;
let original = null;

function formatArg(value) {
  try {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function append(level, args) {
  if (!logPath) return;
  try {
    const line = `[${new Date().toISOString()}] [${level}] ${args.map(formatArg).join(' ')}\n`;
    fs.appendFileSync(logPath, line, 'utf8');
  } catch {
    // A full disk or a vanished directory must never crash the app over a log line.
  }
}

/**
 * Start mirroring console output into `<dir>/kimflow.log`. Idempotent: the
 * first call wins, later calls are no-ops.
 *
 * @param {string} dir directory that will be created if missing
 */
function installFileLogging(dir) {
  if (installed || !dir || typeof dir !== 'string') return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, 'kimflow.log');
    // One-generation rotation: a fresh session archives an oversized log.
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > MAX_LOG_BYTES) {
      try { fs.rmSync(`${logPath}.old`, { force: true }); } catch { /* best-effort */ }
      fs.renameSync(logPath, `${logPath}.old`);
    }
  } catch {
    logPath = null;
    return; // logging must never break startup
  }
  installed = true;
  original = { log: console.log, warn: console.warn, error: console.error };
  const mirror = (level, originalFn) => (...args) => {
    append(level, args);
    originalFn(...args);
  };
  console.log = mirror('INFO', original.log);
  console.warn = mirror('WARN', original.warn);
  console.error = mirror('ERROR', original.error);
}

/** The active log file path, or null when file logging is not installed. */
function logFilePath() {
  return logPath;
}

/** Test seam: restore the pristine console functions and forget the file. */
function resetFileLoggingForTests() {
  if (original) {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
  original = null;
  installed = false;
  logPath = null;
}

module.exports = { installFileLogging, logFilePath, resetFileLoggingForTests };
