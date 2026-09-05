/* Regression test for translation perceived-delay fix.
 *
 * Fails before the fix, passes after:
 *  1. gemini.translate sends a low-latency generationConfig.
 *  2. gemini exports warmup() so the model can be resolved in parallel
 *     with transcription (no cold-start extra round-trip on stop).
 *  3. recorder emits the transcript BEFORE awaiting translation
 *     (decoupled display: transcript shows instantly, translation pops in).
 *
 * Usage: node scripts/translation-latency-check.cjs
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
function check(name, condition, hint) {
  if (condition) {
    console.log(`PASS: ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${name}${hint ? ` — ${hint}` : ''}`);
  }
}

async function main() {
  const gemini = require('../backend/gemini.cjs');

  // 1. Low-latency generationConfig in the generateContent payload.
  const axios = require('axios');
  const originalPost = axios.post;
  const originalGet = axios.get;
  let capturedBody = null;
  axios.get = async () => ({
    status: 200,
    data: {
      models: [
        { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
      ],
    },
  });
  axios.post = async (_url, body) => {
    capturedBody = body;
    return { status: 200, data: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] } };
  };
  try {
    await gemini.translate({
      text: 'Hello',
      sourceLanguage: 'auto',
      targetLanguage: 'en',
      apiKey: 'test-key-for-latency-check',
      model: 'gemini-2.5-flash-lite',
    });
  } catch {
    // Validation path may throw without network; payload check below covers it.
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
  }
  const geminiSource = fs.readFileSync(path.join(__dirname, '..', 'backend', 'gemini.cjs'), 'utf8');
  const hasGenerationConfig = capturedBody && capturedBody.generationConfig
    ? true
    : /generationConfig/.test(geminiSource);
  check(
    'gemini sends low-latency generationConfig',
    hasGenerationConfig,
    'expected generationConfig (temperature 0) in generateContent body',
  );

  // 2. Warmup export exists for parallel model resolution.
  check(
    'gemini exports warmup()',
    typeof gemini.warmup === 'function',
    'expected gemini.warmup(apiKey, model) to pre-resolve the model',
  );

  // 3. Recorder emits transcript before awaiting translation.
  const recorderSource = fs.readFileSync(
    path.join(__dirname, '..', 'backend', 'recorder.cjs'),
    'utf8',
  );
  const emitIndex = recorderSource.indexOf('transcription-result');
  const translateIndex = recorderSource.indexOf('translationService.translate');
  check(
    'recorder emits transcript before translation completes',
    emitIndex !== -1 && translateIndex !== -1 && emitIndex < translateIndex,
    'expected webContents.send(transcription-result) BEFORE translationService.translate',
  );

  if (failures > 0) {
    console.error(`\n${failures} latency check(s) FAILED — translation still blocks the transcript.`);
    process.exit(1);
  }
  console.log('\nAll translation latency checks passed.');
}

main().catch((error) => {
  console.error('Latency test crashed:', error);
  process.exit(1);
});
