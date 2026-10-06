// test/model-download.test.cjs
//
// A download that ends early must not be enthroned as the model: byte counts
// are checked against content-length before the file goes live.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, PassThrough } = require('node:stream');

const fakeWindow = { isDestroyed: () => false, webContents: { send: () => {} } };

function useIsolatedDownloader(t, getImpl) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-model-'));
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
  const downloader = require('../backend/model-download.cjs');
  const settings = require('../backend/settings.cjs');
  return { downloader, dir: settings.CONFIG_DIR };
}

function streamResponse(payload, total) {
  return {
    status: 200,
    headers: { 'content-length': String(total) },
    data: Readable.from([Buffer.from(payload)]),
  };
}

test('short download is rejected and leaves no model behind', async (t) => {
  const { downloader, dir } = useIsolatedDownloader(t, async () => streamResponse('abc', 10));
  await assert.rejects(downloader.downloadModel(fakeWindow, 'small'), /incomplete/i);
  assert.equal(fs.existsSync(path.join(dir, 'ggml-small.bin')), false);
});

test('complete download goes live with exact bytes', async (t) => {
  const { downloader, dir } = useIsolatedDownloader(t, async () => streamResponse('0123456789', 10));
  await downloader.downloadModel(fakeWindow, 'small');
  assert.equal(fs.readFileSync(path.join(dir, 'ggml-small.bin'), 'utf8'), '0123456789');
  const leftovers = fs.readdirSync(dir).filter((name) => name.includes('.download'));
  assert.deepEqual(leftovers, []);
});

test('concurrent downloads of the same model do not mix bytes', async (t) => {
  const streams = [new PassThrough(), new PassThrough()];
  let calls = 0;
  const { downloader, dir } = useIsolatedDownloader(t, async () => {
    const stream = streams[calls++];
    return { status: 200, headers: { 'content-length': '10' }, data: stream };
  });
  const first = downloader.downloadModel(fakeWindow, 'small');
  const second = downloader.downloadModel(fakeWindow, 'small');
  // Interleave chunks deterministically: shared temp files would mix these.
  streams[0].write('AAAAA');
  streams[1].write('BBBBB');
  streams[0].end('AAAAA');
  streams[1].end('BBBBB');
  await Promise.all([first, second]);
  const final = fs.readFileSync(path.join(dir, 'ggml-small.bin'), 'utf8');
  assert.ok(final === 'AAAAAAAAAA' || final === 'BBBBBBBBBB', `mixed payload: ${final}`);
});
