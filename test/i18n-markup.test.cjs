'use strict';
// Ticket 06 category 4: no hardcoded user-visible English in the markup,
// plus two structural guarantees: every data-i18n key exists in English (so no
// raw key can reach the screen) and every element id `dom.ts` resolves still
// exists (it throws at module load on a missing id).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const { loadTs } = require('./helpers/ts-loader.cjs');
const EN = loadTs('src/i18n/locales/en.ts').en;

const MARKUP = {
  'index.html': fs.readFileSync('index.html', 'utf8'),
  'src/overlay.html': fs.readFileSync('src/overlay.html', 'utf8'),
};

// Text that is allowed to contain Latin letters: the product name only.
// Window-control glyphs (− □ ✕) and overlay glyphs (▶ Ⅱ ■ ×) are non-Latin and
// therefore pass the scan without needing an entry here.
const ALLOWED_LATIN_TEXT = new Set(['KimFlow']);

function stripNonVisible(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    // Neutralise HTML entities (e.g. &#x2212;) so entity syntax does not read
    // as Latin text. The decoded glyph itself is non-Latin.
    .replace(/&#x?[0-9a-fA-F]+;|&[a-zA-Z]+;/g, '\u00b7');
}

test('no hardcoded user-visible English text remains in index.html or overlay.html', () => {
  const offenders = [];
  for (const [file, html] of Object.entries(MARKUP)) {
    const visible = stripNonVisible(html);
    const textNodes = visible.split(/<[^>]*>/g);
    for (const raw of textNodes) {
      const text = raw.trim();
      if (!text || !/[A-Za-z]/.test(text)) continue;
      if (ALLOWED_LATIN_TEXT.has(text)) continue;
      offenders.push(`${file}: ${JSON.stringify(text)}`);
    }
  }
  assert.deepEqual(offenders, [], `hardcoded English text: ${offenders.join(' | ')}`);
});

test('no literal title/aria-label/placeholder/alt attributes (all are data-i18n driven)', () => {
  const offenders = [];
  for (const [file, html] of Object.entries(MARKUP)) {
    const literal = /(?:^|\s)(title|aria-label|placeholder|alt)="([^"]*)"/g;
    let match;
    while ((match = literal.exec(html)) !== null) {
      if (match[2].length > 0) offenders.push(`${file}: ${match[1]}="${match[2]}"`);
    }
  }
  assert.deepEqual(offenders, [], `literal user-visible attributes: ${offenders.join(' | ')}`);
});

test('every data-i18n key referenced by the markup exists in English', () => {
  const missing = [];
  const pattern = /data-i18n(?:-title|-aria-label|-placeholder)?="([^"]+)"/g;
  for (const [file, html] of Object.entries(MARKUP)) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const key = match[1];
      if (!Object.prototype.hasOwnProperty.call(EN, key)) missing.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], `markup references unknown keys: ${missing.join(' | ')}`);
});

test('every element id resolved by dom.ts still exists in index.html', () => {
  const dom = fs.readFileSync('src/dom.ts', 'utf8');
  const indexHtml = MARKUP['index.html'];
  const ids = [...dom.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 50, 'expected dom.ts to resolve many ids');
  const missing = ids.filter((id) => !indexHtml.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `dom.ts ids missing from index.html: ${missing.join(', ')}`);
});

test('the five settings sections and the UI-language control are present', () => {
  const indexHtml = MARKUP['index.html'];
  const sections = indexHtml.match(/<details class="settings-section"/g) || [];
  assert.equal(sections.length, 5, 'expected five settings sections');
  assert.match(indexHtml, /<details class="settings-section" open>/, 'first section must default open');
  assert.ok(indexHtml.includes('id="ui-language-select"'), 'UI-language select missing');
  for (const value of ['en', 'ar', 'zh']) {
    assert.ok(indexHtml.includes(`<option value="${value}"`), `missing UI-language option ${value}`);
  }
});

test('the titlebar is exempt from RTL mirroring (dir=ltr + physical margin)', () => {
  assert.match(MARKUP['index.html'], /id="titlebar" dir="ltr"/, 'titlebar must pin dir="ltr"');
  const css = fs.readFileSync('src/style.css', 'utf8');
  const controls = css.slice(css.indexOf('#window-controls'), css.indexOf('#window-controls') + 400);
  assert.match(controls, /margin-right:\s*8px/, '#window-controls must keep a physical margin-right');
});

test('overlay.html loads the extracted overlay module as a Vite input', () => {
  assert.match(MARKUP['src/overlay.html'], /<script type="module" src="\/src\/overlay\.ts"><\/script>/);
  const vite = fs.readFileSync('vite.config.ts', 'utf8');
  assert.match(vite, /overlay:\s*"src\/overlay\.html"/);
});

test('the font stack appends Arabic and CJK families in both entry points', () => {
  const css = fs.readFileSync('src/style.css', 'utf8');
  for (const family of ['Noto Sans Arabic', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC']) {
    assert.ok(css.includes(family), `style.css missing font family ${family}`);
    assert.ok(MARKUP['src/overlay.html'].includes(family), `overlay.html missing font family ${family}`);
  }
});
