'use strict';
// test/sherpa-status.test.cjs
//
// sherpa-status semantics (QA fix 2026-11-24): the handler used to report
// `runtime: resolveSherpaBinary() !== null && registryDownloaded(RUNTIME_ENTRY_ID)`,
// but backend/engines/sherpa.cjs resolveSherpaModel routes on
// resolveSherpaBinary() ALONE — a bundled (backend/bin) or env-override
// sidecar was actually used while the UI showed "not ready". The handler now
// mirrors the router: runtime is resolveSherpaBinary() !== null.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./helpers/electron-main-harness.cjs');

const SIDECAR_NAME = process.platform === 'win32' ? 'sherpa-onnx-offline.exe' : 'sherpa-onnx-offline';

/** Invoke the registered 'sherpa-status' handler as the main window. */
function callSherpaStatus(harness) {
  const main = harness.instances[0];
  return harness.handlers.get('sherpa-status')({ sender: { id: main.webContents.id } });
}

test('an env-override sidecar reports runtime ready even without the registry runtime entry', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-sherpa-status-'));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ } });
  const sidecar = path.join(home, 'bundled', SIDECAR_NAME);
  fs.mkdirSync(path.dirname(sidecar), { recursive: true });
  fs.writeFileSync(sidecar, 'not a real binary — existence is all the resolver checks');
  process.env.KIMFLOW_SHERPA_BIN = sidecar;
  t.after(() => { delete process.env.KIMFLOW_SHERPA_BIN; });

  const harness = await loadMain({ locale: 'en-US', home });
  t.after(() => harness.restore());

  const status = callSherpaStatus(harness);
  assert.equal(status.runtime, true,
    'a sidecar the router WOULD use must not be reported "not ready"');
  assert.equal(status.model, false, 'no model is downloaded in the isolated home');
});

test('with no sidecar anywhere, runtime is false (and the model check is unchanged)', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-sherpa-status-'));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ } });
  delete process.env.KIMFLOW_SHERPA_BIN;

  const harness = await loadMain({ locale: 'en-US', home });
  t.after(() => harness.restore());

  const status = callSherpaStatus(harness);
  assert.equal(status.runtime, false, 'no sidecar → not ready, exactly as the router falls back');
  assert.equal(status.model, false);
  assert.deepEqual(Object.keys(status).sort(), ['model', 'runtime'], 'the status shape is unchanged');
});
