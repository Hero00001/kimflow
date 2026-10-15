'use strict';
// Ticket 06 categories 5 and 6: config round-trip and first-run detection.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const settings = require('../backend/settings.cjs');
const { loadMain } = require('./helpers/electron-main-harness.cjs');

// ── Category 5: config round-trip ───────────────────────────────────────────

test('default uiLanguage is the empty string (means "not chosen yet")', () => {
  assert.equal(settings.DEFAULT_SETTINGS.uiLanguage, '');
});

test('normalizeSettings accepts en/ar/zh/"" and coerces anything else to ""', () => {
  for (const good of ['en', 'ar', 'zh', '']) {
    assert.equal(settings.normalizeSettings({ uiLanguage: good }).uiLanguage, good);
  }
  for (const bad of ['de', 'EN', 'Ar', 'ar-SA', 'auto', 'fr', 'es', '  ', 42, true, null, undefined, [], {}]) {
    assert.equal(settings.normalizeSettings({ uiLanguage: bad }).uiLanguage, '', `uiLanguage ${JSON.stringify(bad)} must coerce to ""`);
  }
  // Missing field falls back to the default.
  assert.equal(settings.normalizeSettings({}).uiLanguage, '');
  assert.equal(settings.normalizeSettings(null).uiLanguage, '');
});

test('normalizeSettings does not let uiLanguage affect inputLanguage / translationTarget', () => {
  const base = settings.normalizeSettings({ inputLanguage: 'en', translationTarget: 'fr' });
  const withAr = settings.normalizeSettings({ inputLanguage: 'en', translationTarget: 'fr', uiLanguage: 'ar' });
  assert.equal(withAr.inputLanguage, base.inputLanguage);
  assert.equal(withAr.translationTarget, base.translationTarget);
});

test('uiLanguage is never read by the transcription or translation pipeline', () => {
  for (const file of ['backend/transcribe.cjs', 'backend/translation.service.cjs', 'backend/languages.cjs']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(!source.includes('uiLanguage'), `${file} must not reference uiLanguage`);
  }
});

// ── Category 6: first-run detection ─────────────────────────────────────────

function withTempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-firstrun-'));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ } });
  return home;
}

function writeConfig(home, config) {
  fs.mkdirSync(path.join(home, '.kimflow'), { recursive: true });
  fs.writeFileSync(path.join(home, '.kimflow', 'config.json'), JSON.stringify(config), 'utf8');
}

function readConfig(home) {
  return JSON.parse(fs.readFileSync(path.join(home, '.kimflow', 'config.json'), 'utf8'));
}

async function firstRunLanguage(t, locale, stored = {}) {
  const home = withTempHome(t);
  writeConfig(home, { uiLanguage: '', ...stored });
  const harness = await loadMain({ locale, home });
  t.after(() => harness.restore());
  const event = { sender: { id: harness.instances[0].webContents.id } };
  return { delivered: harness.handlers.get('get-settings')(event).uiLanguage, onDisk: readConfig(home).uiLanguage, home };
}

test('"" resolves from the OS locale once and is persisted', async (t) => {
  for (const [locale, expected] of [['ar-SA', 'ar'], ['zh-CN', 'zh'], ['en-US', 'en']]) {
    const { delivered, onDisk } = await firstRunLanguage(t, locale);
    assert.equal(delivered, expected, `locale ${locale} should resolve to ${expected}`);
    assert.equal(onDisk, expected, `locale ${locale} should persist ${expected}`);
  }
});

test('an unsupported OS locale falls back to English', async (t) => {
  const { delivered, onDisk } = await firstRunLanguage(t, 'de-DE');
  assert.equal(delivered, 'en');
  assert.equal(onDisk, 'en');
});

test('a stored "en" is left alone even when the OS locale is Arabic', async (t) => {
  const home = withTempHome(t);
  writeConfig(home, { uiLanguage: 'en' });
  const harness = await loadMain({ locale: 'ar-SA', home });
  t.after(() => harness.restore());
  const event = { sender: { id: harness.instances[0].webContents.id } };
  assert.equal(harness.handlers.get('get-settings')(event).uiLanguage, 'en');
  assert.equal(readConfig(home).uiLanguage, 'en', 'a deliberate English choice must not be rewritten');
});

test('a stored "ar" is not re-detected to the OS language on a later launch', async (t) => {
  const home = withTempHome(t);
  writeConfig(home, { uiLanguage: 'ar' });
  const harness = await loadMain({ locale: 'en-US', home });
  t.after(() => harness.restore());
  const event = { sender: { id: harness.instances[0].webContents.id } };
  assert.equal(harness.handlers.get('get-settings')(event).uiLanguage, 'ar');
  assert.equal(readConfig(home).uiLanguage, 'ar');
});

test('detection runs exactly once (second load keeps the first result)', async (t) => {
  const home = withTempHome(t);
  writeConfig(home, { uiLanguage: '' });
  const first = await loadMain({ locale: 'ar-SA', home });
  first.restore();
  assert.equal(readConfig(home).uiLanguage, 'ar');
  // Second launch, OS locale now different: the persisted value wins.
  const second = await loadMain({ locale: 'en-US', home });
  t.after(() => second.restore());
  const event = { sender: { id: second.instances[0].webContents.id } };
  assert.equal(second.handlers.get('get-settings')(event).uiLanguage, 'ar');
  assert.equal(readConfig(home).uiLanguage, 'ar');
});

test('the renderer never receives an empty uiLanguage', async (t) => {
  const { delivered } = await firstRunLanguage(t, 'ar-SA');
  assert.notEqual(delivered, '');
  assert.ok(['en', 'ar', 'zh'].includes(delivered));
});
