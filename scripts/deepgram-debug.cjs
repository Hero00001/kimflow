/* Debug the raw Deepgram pre-recorded request/response independent of the app.
 *
 * Usage:
 *   node scripts/deepgram-debug.cjs <wav> [language]
 *
 * Language may be a specific code (en, ja, ar, zh) or "multi" for Nova-3
 * multilingual. Uses the saved Deepgram API key from KimFlow settings, or the
 * DEEPGRAM_API_KEY environment variable when set. Keys are never logged.
 */
const fs = require('fs');
const settings = require('../backend/settings.cjs');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

(async () => {
  const wavPath = process.argv[2];
  const language = argValue('--language', 'multi');
  const key = process.env.DEEPGRAM_API_KEY || settings.load().deepgramApiKey;
  if (!wavPath) {
    console.error('Usage: node scripts/deepgram-debug.cjs <file.wav> [--language multi|en|ja|ar|zh]');
    process.exit(2);
  }
  if (!key) {
    console.error('No Deepgram API key found. Enter one in KimFlow Settings, or set DEEPGRAM_API_KEY.');
    process.exit(2);
  }
  if (!fs.existsSync(wavPath)) {
    console.error(`WAV file not found: ${wavPath}`);
    process.exit(2);
  }

  const { createClient } = require('@deepgram/sdk');
  const deepgram = createClient(key);
  const options = { model: 'nova-3', language, smart_format: true };

  const query = new URL('https://api.deepgram.com/v1/listen');
  Object.keys(options).forEach((name) => query.searchParams.append(name, String(options[name])));
  console.log(`Request URL : ${query.toString()}`);

  const response = await deepgram.listen.prerecorded.transcribeFile(fs.readFileSync(wavPath), options);

  if (response?.error) {
    console.error(`Deepgram error: ${response.error.message || response.error}`);
    process.exit(1);
  }
  const data = response?.result;
  if (!data) {
    console.error('Deepgram responded without a result object.');
    process.exit(1);
  }
  console.log('Metadata     :', JSON.stringify({
    duration: data.metadata?.duration,
    channels: data.metadata?.channels,
    models: data.metadata?.models,
    model_info: safeNames(data.metadata?.model_info),
    warnings: data.metadata?.warnings,
  }, null, 2));
  console.log('Results keys :', Object.keys(data.results || {}).join(', '));
  const channels = data.results?.channels || [];
  console.log('Channels     :', channels.length);
  channels.forEach((channel, index) => {
    console.log(`Channel[${index}] detected_language:`, channel.detected_language, 'alternatives:', (channel.alternatives || []).length);
    (channel.alternatives || []).forEach((alt, i) => {
      console.log(`  alt[${i}] transcript:`, JSON.stringify(alt?.transcript));
      console.log(`  alt[${i}] languages :`, JSON.stringify(alt?.languages));
      console.log(`  alt[${i}] words     :`, (alt?.words || []).length);
    });
  });
})().catch((error) => {
  console.error('Request failed :', error.message || String(error));
  process.exit(1);
});

function safeNames(modelInfo) {
  if (!modelInfo) return undefined;
  return Object.values(modelInfo).map((entry) => `${entry?.arch}/${entry?.name}@${entry?.version}`).join(', ');
}