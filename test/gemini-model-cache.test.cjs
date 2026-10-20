// test/gemini-model-cache.test.cjs
//
// Regression test for the MEDIUM defect: a transient network error was
// cached as "model not found" for the whole process.
//
// `inspectModel` caught transport failures and stored
// `{ found: false, error: 'network' }` in `inspectedModels` forever.
// `validateModel` turns any `!found` into "model X was not found for this
// API key", so a two-second network blip poisoned every later dictation with
// a factually wrong diagnosis that could not be cleared without restarting
// the app.
const test = require('node:test');
const assert = require('node:assert');

/**
 * Load a fresh backend/gemini.cjs with axios stubbed.
 *
 * The module captures `axios` at import time, so the stub has to be in place
 * BEFORE the module is loaded — and the module has to be reloaded so its
 * internal model cache starts empty.
 */
function loadGeminiWithAxios(t, impl) {
  const axiosResolved = require.resolve('axios');
  const geminiResolved = require.resolve('../backend/gemini.cjs');
  const previousAxios = require.cache[axiosResolved];
  const previousGemini = require.cache[geminiResolved];
  require.cache[axiosResolved] = {
    id: axiosResolved, filename: axiosResolved, loaded: true,
    exports: { get: impl },
  };
  delete require.cache[geminiResolved];
  t.after(() => {
    if (previousAxios) require.cache[axiosResolved] = previousAxios;
    else delete require.cache[axiosResolved];
    if (previousGemini) require.cache[geminiResolved] = previousGemini;
    else delete require.cache[geminiResolved];
  });
  return require('../backend/gemini.cjs');
}

test('a network failure is not cached as "model not found"', async (t) => {
  let calls = 0;
  const gemini = loadGeminiWithAxios(t, async () => {
    calls += 1;
    if (calls === 1) throw new Error('getaddrinfo ENOTFOUND generativelanguage.googleapis.com');
    return {
      status: 200,
      data: { supportedGenerationMethods: ['generateContent'], displayName: 'Flash' },
    };
  });

  const first = await gemini.validateModel('key', 'gemini-3.6-flash');
  assert.equal(first.ok, false, 'the first lookup fails');
  assert.match(first.message, /could not reach|connection|try again/i);
  assert.doesNotMatch(first.message, /not found/i, 'a network blip is not "model not found"');

  // The second lookup must retry rather than serve the cached failure.
  const second = await gemini.validateModel('key', 'gemini-3.6-flash');
  assert.equal(second.ok, true, 'the second lookup succeeds after the blip');
  assert.equal(calls, 2);
});

test('a model that genuinely does not exist is reported as not found', async (t) => {
  const gemini = loadGeminiWithAxios(t, async () => ({ status: 404, data: {} }));
  const result = await gemini.validateModel('key', 'gemini-does-not-exist');
  assert.equal(result.ok, false);
  assert.match(result.message, /not found/i);
});
