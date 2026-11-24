// test/sherpa-registry.test.cjs
//
// Registry mechanics (sensevoice ticket 03): unknown ids are rejected, a
// corrupt download (byte count ok but sha256 mismatch) is REJECTED before
// anything is extracted, and the temp staging file never survives a failure.
// The whisper ggml flow (downloadModel) is deliberately untouched and keeps
// its own test file.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');

const fakeWindow = { isDestroyed: () => false, webContents: { send: () => {} } };

function useIsolatedRegistry(t, getImpl) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-registry-'));
  const prevProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  const axiosResolved = require.resolve('axios');
  const prevAxios = require.cache[axiosResolved];
  require.cache[axiosResolved] = {
    id: axiosResolved, filename: axiosResolved, loaded: true,
    exports: { get: getImpl },
  };
  const evict = ['../backend/settings.cjs', '../backend/secrets.cjs', '../backend/model-download.cjs']
    .map((m) => require.resolve(m));
  const saved = new Map();
  for (const resolved of evict) {
    if (require.cache[resolved]) {
      saved.set(resolved, require.cache[resolved]);
      delete require.cache[resolved];
    }
  }
  process.env.USERPROFILE = fakeHome;
  process.env.HOME = fakeHome;
  t.after(() => {
    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    for (const resolved of evict) delete require.cache[resolved];
    for (const [resolved, entry] of saved) require.cache[resolved] = entry;
    if (prevAxios) require.cache[axiosResolved] = prevAxios;
    else delete require.cache[axiosResolved];
    try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
  const registry = require('../backend/model-download.cjs');
  const settings = require('../backend/settings.cjs');
  return { registry, dir: settings.CONFIG_DIR };
}

function streamResponse(payload) {
  const buffer = Buffer.from(payload);
  return {
    status: 200,
    headers: { 'content-length': String(buffer.length) },
    data: Readable.from([buffer]),
  };
}

test('the registry contains exactly the two expected entries', (t) => {
  const { registry } = useIsolatedRegistry(t, async () => { throw new Error('no download expected'); });
  assert.deepEqual(Object.keys(registry.MODEL_REGISTRY).sort(), ['sense-voice-int8', 'sherpa-runtime-win-x64']);
  assert.equal(registry.MODEL_REGISTRY['sense-voice-int8'].engine, 'sherpa-onnx');
  assert.equal(registry.MODEL_REGISTRY['sherpa-runtime-win-x64'].engine, 'sherpa-runtime');
});

test('unknown registry ids are rejected by every registry function', async (t) => {
  const { registry } = useIsolatedRegistry(t, async () => { throw new Error('no download expected'); });
  assert.throws(() => registry.registryEntry('ggml-large'), /Unknown registry entry/);
  await assert.rejects(registry.downloadRegistryEntry(fakeWindow, 'nope'), /Unknown registry entry/);
  assert.equal(registry.registryHas('nope'), false);
  assert.equal(registry.registryHas('sense-voice-int8'), true);
});

test('a sha256 mismatch rejects the download and extracts nothing', async (t) => {
  // Serve a valid-length payload whose digest cannot match the pinned hash.
  const payload = crypto.randomBytes(4096).toString('binary');
  const { registry, dir } = useIsolatedRegistry(t, async () => streamResponse(payload));
  await assert.rejects(registry.downloadRegistryEntry(fakeWindow, 'sense-voice-int8'), /sha256 mismatch/i);
  const extractDir = path.join(dir, 'sherpa-model', 'sense-voice-int8');
  assert.equal(fs.existsSync(extractDir), false, 'nothing may be extracted from an unverified archive');
  // No staging file survives the failure.
  const leftovers = fs.readdirSync(dir).filter((name) => name.includes('.download'));
  assert.deepEqual(leftovers, [], 'temp staging file must be cleaned up');
});

test('registryDownloaded is false when the extraction dir is absent or incomplete', (t) => {
  const { registry, dir } = useIsolatedRegistry(t, async () => { throw new Error('no download expected'); });
  assert.equal(registry.registryDownloaded('sense-voice-int8'), false, 'absent dir → not downloaded');
  const modelDir = path.join(dir, 'sherpa-model', 'sense-voice-int8', 'some-archive-dir');
  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(path.join(modelDir, 'model.int8.onnx'), 'x');
  assert.equal(registry.registryDownloaded('sense-voice-int8'), false, 'tokens.txt missing → not downloaded');
  fs.writeFileSync(path.join(modelDir, 'tokens.txt'), 'x');
  assert.equal(registry.registryDownloaded('sense-voice-int8'), true, 'both required files (nested) → downloaded');
});

test('a short download is rejected before hashing (byte-count guard)', async (t) => {
  const { registry } = useIsolatedRegistry(t, async () => (
    // Payload is 3 bytes but content-length advertises 10 — the incomplete
    // guard must fire before the sha256 check is ever reached.
    { status: 200, headers: { 'content-length': '10' }, data: Readable.from([Buffer.from('abc')]) }
  ));
  await assert.rejects(registry.downloadRegistryEntry(fakeWindow, 'sense-voice-int8'), /incomplete/i);
});

// ── Atomic extraction (QA fix 2026-11-24) ───────────────────────────────────
//
// Extraction used to begin with rmSync(targetDir), so a FAILED re-extraction
// destroyed a good install. extractTarBz2 now stages into a unique sibling
// dir and only a complete extraction replaces the target.

test('a failed extraction leaves the previous install intact', async (t) => {
  const { registry, dir } = useIsolatedRegistry(t, async () => { throw new Error('no download expected'); });
  const targetDir = path.join(dir, 'sherpa-model', 'sense-voice-int8');
  const nested = path.join(targetDir, 'previous-install');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'model.int8.onnx'), 'good install');
  fs.writeFileSync(path.join(nested, 'tokens.txt'), 'good install');

  // Garbage payload: `tar -xjf` rejects anything that is not a bz2 stream.
  const badArchive = path.join(dir, 'corrupt.tar.bz2');
  fs.writeFileSync(badArchive, 'this is not an archive');

  await assert.rejects(registry.extractTarBz2(badArchive, targetDir), /failed/i);
  assert.equal(
    fs.readFileSync(path.join(nested, 'model.int8.onnx'), 'utf8'),
    'good install',
    'the previous good extraction must survive a failed re-extraction',
  );
  assert.equal(registry.registryDownloaded('sense-voice-int8'), true,
    'the previous install still satisfies the required-files check');
  const leftovers = fs.readdirSync(path.dirname(targetDir))
    .filter((name) => name.includes('.extract-'));
  assert.deepEqual(leftovers, [], 'the staging dir must be cleaned up after a failure');
});

test('a successful extraction replaces the previous install (no old/new mixing)', async (t) => {
  const { registry, dir } = useIsolatedRegistry(t, async () => { throw new Error('no download expected'); });
  const targetDir = path.join(dir, 'sherpa-model', 'sense-voice-int8');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'stale-file.txt'), 'old install');

  // Payload to ship inside the archive.
  const srcDir = path.join(dir, 'archive-src', 'payload-dir');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'model.int8.onnx'), 'new install');
  fs.writeFileSync(path.join(srcDir, 'tokens.txt'), 'new install');

  // Build a real archive with the OS bsdtar. System32 is resolved explicitly:
  // a GNU tar earlier on PATH interprets "C:\..." as a remote host ("Cannot
  // connect to C: resolve failed"), while the bsdtar Windows ships handles
  // drive letters — the same binary the production extraction relies on.
  const tarExe = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
  const archive = path.join(dir, 'payload.tar.bz2');
  await new Promise((resolve, reject) => {
    const { execFile } = require('node:child_process');
    execFile(tarExe, ['-cjf', archive, '-C', path.join(dir, 'archive-src'), 'payload-dir'], (error) => {
      if (error) reject(error); else resolve();
    });
  });

  // extractTarBz2 resolves plain `tar` from PATH — the documented "Windows
  // ships one" assumption. This repo's dev shell is Git Bash, whose GNU tar
  // (usr/bin) shadows System32's bsdtar and cannot parse "C:\..." paths
  // ("Cannot connect to C: resolve failed"), so the System32 directory is
  // prepended here to run the extraction under the assumption production
  // relies on. Restored after the test.
  if (process.platform === 'win32') {
    const system32 = path.dirname(tarExe);
    const previousPath = process.env.PATH;
    process.env.PATH = `${system32}${path.delimiter}${previousPath}`;
    t.after(() => { process.env.PATH = previousPath; });
  }

  await registry.extractTarBz2(archive, targetDir);
  assert.equal(fs.existsSync(path.join(targetDir, 'stale-file.txt')), false,
    'the old install must be fully replaced');
  const extracted = registry.findFileRecursive(targetDir, 'model.int8.onnx');
  assert.ok(extracted, 'the new payload must be present');
  assert.equal(fs.readFileSync(extracted, 'utf8'), 'new install');
  assert.equal(registry.registryDownloaded('sense-voice-int8'), true);
  const leftovers = fs.readdirSync(path.dirname(targetDir))
    .filter((name) => name.includes('.extract-'));
  assert.deepEqual(leftovers, [], 'no staging dir survives a successful extraction');
});
