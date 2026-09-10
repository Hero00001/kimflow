const test = require('node:test');
const assert = require('node:assert');
const gemini = require('../backend/gemini.cjs');
const translationService = require('../backend/translation.service.cjs');

test('polish prompt keeps language and demands plain output', () => {
  assert.equal(typeof gemini.buildPolishPrompt, 'function');
  const prompt = gemini.buildPolishPrompt('hello world', 'en');
  assert.ok(prompt.includes('hello world'));
  assert.ok(/ONLY/i.test(prompt));
  assert.ok(prompt.includes('English'));
  assert.ok(/same language/i.test(gemini.buildPolishPrompt('hello world', 'auto')));
});

test('polish facade short-circuits empty text without network', async () => {
  assert.equal(typeof translationService.polish, 'function');
  assert.equal(await translationService.polish({ text: '   ', language: 'en', apiKey: 'x' }), '');
});
