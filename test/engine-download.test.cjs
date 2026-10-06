const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fakeWindow = { isDestroyed: () => false, webContents: { send: () => {} } };

function useIsolatedDownloader(t, getImpl) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-engine-'));
  const prevProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  const axiosResolved = require.resolve('axios');
  const prevAxios = require.cache[axiosResolved];
  require.cache[axiosResolved] = {
    id: axiosResolved, filename: axiosResolved, loaded: true,
    exports: { get: getImpl },
  };
  const evict = ['../backend/settings.cjs', '../backend/secrets.cjs', '../backend/engine-manifest.cjs', '../backend/engine-download.cjs']
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
  const downloader = require('../backend/engine-download.cjs');
  const settings = require('../backend/settings.cjs');
  return { downloader, dir: settings.CONFIG_DIR };
}

const { Readable } = require('node:stream');

function zipResponse(payloadBytes, totalBytes) {
  return {
    status: 200,
    headers: { 'content-length': String(totalBytes) },
    data: Readable.from([Buffer.from(payloadBytes)]),
  };
}

test('short engine download is rejected and leaves nothing behind', async (t) => {
  const { downloader, dir } = useIsolatedDownloader(t, async () => zipResponse([1, 2, 3], 10));
  await assert.rejects(downloader.downloadEngineZip(fakeWindow, 'cpu'), /incomplete/i);
  assert.equal(fs.existsSync(path.join(dir, 'engines', 'cpu')), false);
});

test('hash mismatch is rejected and the zip is deleted', async (t) => {
  const { downloader, dir } = useIsolatedDownloader(t, async () => zipResponse([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10));
  await assert.rejects(downloader.downloadEngineZip(fakeWindow, 'cpu'), /fingerprint|sha256|hash/i);
  const leftovers = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else leftovers.push(e.name);
    }
  };
  if (fs.existsSync(path.join(dir, 'engines'))) walk(path.join(dir, 'engines'));
  assert.deepEqual(leftovers, []);
});

test('zip-slip entries are rejected without writing', async (t) => {
  const { downloader } = useIsolatedDownloader(t, async () => { throw new Error('must not fetch'); });
  assert.throws(() => downloader.safeEntryPath('../evil.exe', 'C:\\engines\\cpu'), /Unsafe zip entry/);
  assert.throws(() => downloader.safeEntryPath('/abs/evil.exe', 'C:\\engines\\cpu'), /Unsafe zip entry/);
  assert.throws(() => downloader.safeEntryPath('C:\\evil.exe', 'C:\\engines\\cpu'), /Unsafe zip entry/);
  assert.ok(downloader.safeEntryPath('sub/whisper-cli.exe', 'C:\\engines\\cpu').endsWith('whisper-cli.exe'));
});

test('extraction keeps only wanted files', async (t) => {
  const { downloader, dir } = useIsolatedDownloader(t, async () => { throw new Error('must not fetch'); });
  const fixture = path.join(__dirname, 'fixtures', 'engine-test.zip');
  const exe = await downloader.extractEngineZip(fixture, 'cpu', ['whisper-cli.exe']);
  assert.equal(exe, path.join(dir, 'engines', 'cpu', 'whisper-cli.exe'));
  assert.equal(fs.readFileSync(exe, 'utf8'), 'FAKE-EXE');
  assert.equal(fs.existsSync(path.join(dir, 'engines', 'cpu', 'docs', 'readme.txt')), false);
});

test('smoke test passes for a working binary', async (t) => {
  const { downloader } = useIsolatedDownloader(t, async () => { throw new Error('must not fetch'); });
  assert.equal(await downloader.smokeTestEngine(process.execPath, async (bin, args) => {
    const { execFile } = require('node:child_process');
    const { promisify } = require('node:util');
    await promisify(execFile)(bin, args, { timeout: 30000 });
  }), true);
});

test('smoke test fails for a crashing binary', async (t) => {
  const { downloader } = useIsolatedDownloader(t, async () => { throw new Error('must not fetch'); });
  await assert.rejects(
    downloader.smokeTestEngine(process.execPath, async () => { const e = new Error('boom'); e.code = 1; throw e; }),
    /startup check/i,
  );
});

test('gpu detection: nvidia wins when nvidia-smi runs', async (t) => {
  const { downloader } = useIsolatedDownloader(t, async () => { throw new Error('must not fetch'); });
  assert.equal(await downloader.detectGpu({
    run: async () => ({ stdout: 'NVIDIA GeForce RTX 4070' }),
    fileExists: () => false, platform: 'win32',
  }), 'nvidia');
});

test('gpu detection: amd on Radeon controller with Vulkan dll', async (t) => {
  const { downloader } = useIsolatedDownloader(t, async () => { throw new Error('must not fetch'); });
  const run = async (command) => {
    if (command === 'nvidia-smi') throw new Error('not found');
    if (command === 'wmic-video') return { stdout: 'Radeon RX 7800 XT' };
    throw new Error(`unexpected command: ${command}`);
  };
  assert.equal(await downloader.detectGpu({ run, fileExists: () => true, platform: 'win32' }), 'amd');
});

test('gpu detection: cpu fallback when nothing matches', async (t) => {
  const { downloader } = useIsolatedDownloader(t, async () => { throw new Error('must not fetch'); });
  assert.equal(await downloader.detectGpu({
    run: async () => { throw new Error('nope'); },
    fileExists: () => false, platform: 'win32',
  }), 'cpu');
});

test('engineInstalled reflects the on-disk binary', async (t) => {
  const { downloader, dir } = useIsolatedDownloader(t, async () => { throw new Error('must not fetch'); });
  assert.equal(downloader.engineInstalled('cpu'), false);
  const exeDir = path.join(dir, 'engines', 'cpu');
  fs.mkdirSync(exeDir, { recursive: true });
  fs.writeFileSync(path.join(exeDir, 'whisper-cli.exe'), 'x');
  assert.equal(downloader.engineInstalled('cpu'), true);
  assert.equal(downloader.engineBinaryPath('cpu'), path.join(exeDir, 'whisper-cli.exe'));
  assert.equal(downloader.engineInstalled('amd'), false);
});


test('extraction finds a nested binary', async (t) => {
  const { downloader, dir } = useIsolatedDownloader(t, async () => { throw new Error('must not fetch'); });
  const fixture = path.join(__dirname, 'fixtures', 'engine-nested-test.zip');
  const exe = await downloader.extractEngineZip(fixture, 'cpu');
  assert.equal(exe, path.join(dir, 'engines', 'cpu', 'Release', 'whisper-cli.exe'));
  assert.equal(fs.readFileSync(exe, 'utf8'), 'FAKE-NESTED-EXE');
});

test('installed check finds a nested binary', async (t) => {
  const { downloader, dir } = useIsolatedDownloader(t, async () => { throw new Error('must not fetch'); });
  assert.equal(downloader.engineInstalled('cpu'), false);
  const nested = path.join(dir, 'engines', 'cpu', 'Release');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'whisper-cli.exe'), 'x');
  assert.equal(downloader.engineInstalled('cpu'), true);
  assert.equal(downloader.engineBinaryPath('cpu'), path.join(nested, 'whisper-cli.exe'));
});


test('smoke failure with a crash code explains the CPU problem', async (t) => {
  const { downloader } = useIsolatedDownloader(t, async () => { throw new Error('must not fetch'); });
  const crash = new Error('Command failed: whisper-cli.exe --help');
  crash.code = 3221225501;
  await assert.rejects(downloader.smokeTestEngine('x', async () => { throw crash; }), /Illegal instruction|newer CPU/i);
});

test('removeEngine deletes the flavor dir and tolerates absence', async (t) => {
  const { downloader, dir } = useIsolatedDownloader(t, async () => { throw new Error('must not fetch'); });
  const flavorDir = path.join(dir, 'engines', 'amd');
  fs.mkdirSync(flavorDir, { recursive: true });
  fs.writeFileSync(path.join(flavorDir, 'whisper-cli.exe'), 'x');
  downloader.removeEngine('amd');
  assert.equal(fs.existsSync(flavorDir), false);
  assert.equal(downloader.engineInstalled('amd'), false);
  downloader.removeEngine('amd');
});

