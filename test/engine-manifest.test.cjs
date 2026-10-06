const test = require('node:test');
const assert = require('node:assert');
const { ENGINE_FLAVORS, getEngineSpec, validateFlavor } = require('../backend/engine-manifest.cjs');

test('manifest pins all three flavors with hashes', () => {
  assert.deepEqual([...ENGINE_FLAVORS].sort(), ['amd', 'cpu', 'nvidia']);
  for (const flavor of ENGINE_FLAVORS) {
    const spec = getEngineSpec(flavor);
    assert.match(spec.url, /^https:\/\//);
    assert.match(spec.sha256, /^[0-9a-f]{64}$/);
    assert.ok(spec.bytes > 0);
    assert.equal(spec.binaryName, 'whisper-cli.exe');
  }
});

test('cpu manifest matches the verified b5130 asset', () => {
  const spec = getEngineSpec('cpu');
  assert.equal(spec.url, 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip');
  assert.equal(spec.sha256, 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c');
  assert.equal(spec.bytes, 8573270);
});

test('amd manifest matches the verified kimflow-engines release', () => {
  const spec = getEngineSpec('amd');
  assert.equal(spec.url, 'https://github.com/Hero00001/kimflow-engines/releases/download/engine-vulkan-b5130/whisper-vulkan-win-x64-b5130.zip');
  assert.equal(spec.sha256, 'dec3e0d20141ac93c4e6c54a68cb5da3a6e8ac997833c1e4a278e196e166ad06');
  assert.equal(spec.bytes, 18268815);
});

test('nvidia manifest pins CUDA 11.8', () => {
  const spec = getEngineSpec('nvidia');
  assert.equal(spec.url, 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-cublas-11.8.0-bin-x64.zip');
  assert.equal(spec.sha256, '0b29b2175bb17ec26da29677cbc7c467c57d103245144d62a49a703f6bc3fdae');
  assert.equal(spec.bytes, 272982859);
});

test('unknown flavor throws before any network', () => {
  assert.throws(() => validateFlavor('bogus'), /Unknown engine flavor: bogus/);
});
