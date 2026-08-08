/* Diagnose the Gemini translation provider independently of transcription.
 *
 * Usage:
 *   npm run test:gemini
 *   npm run test:gemini -- --text "How are you?" --source auto --target ar --model gemini-3.6-flash
 *
 * The API key is read from the same storage the app uses (~/.kimflow/config.json),
 * or from the GEMINI_API_KEY environment variable when set. Keys are never logged.
 */
const settings = require('../backend/settings.cjs');
const gemini = require('../backend/gemini.cjs');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const text = argValue('--text', 'Hello, how are you?');
const source = argValue('--source', 'auto');
const target = argValue('--target', 'ar');
const model = argValue('--model', '');

function fail(message) {
  console.error(message);
  process.exit(2);
}

(async () => {
  const stored = settings.load();
  const apiKey = process.env.GEMINI_API_KEY || stored.geminiApiKey;
  if (!apiKey) {
    fail('No Gemini API key found. Enter one in KimFlow Advanced > Gemini API Key, or set GEMINI_API_KEY.');
  }
  if (!model) {
    const preferred = await gemini.resolveModel(apiKey);
    console.log(`Auto-selected model: ${preferred}`);
  }

  console.log(`Input language : ${source}`);
  console.log(`Target language: ${target}`);
  console.log(`Model          : ${model || 'auto (best available)'}`);
  console.log('----------------------------------------');

  try {
    const result = await gemini.translate({
      text,
      sourceLanguage: source,
      targetLanguage: target,
      apiKey,
      model: model || undefined,
    });
    console.log('Translation    :', result);
    console.log('OK - Gemini returned a translation.');
  } catch (error) {
    console.error('\nTranslation FAILED:', error.message);
    console.error('The status/details above (also written to KimFlow dev logs) distinguish endpoint,');
    console.error('model, API version, key, or formatting problems.');
    process.exit(1);
  }
})();