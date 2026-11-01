// test/widget-markup.test.cjs
//
// Static guards on the widget renderer files: relative-only subresources, a
// strict CSP, no emoji, no visible text, and the animations the spec requires.
//
// These are the properties that break silently at runtime (an absolute `src`
// resolves to the filesystem root under file://, which is exactly the bug
// test/overlay-entry.test.cjs exists to guard against).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML_PATH = path.join('src', 'widget', 'widget.html');
const CSS_PATH = path.join('src', 'widget', 'widget.css');
const JS_PATH = path.join('src', 'widget', 'widget.js');

const html = fs.readFileSync(HTML_PATH, 'utf8');
const css = fs.readFileSync(CSS_PATH, 'utf8');
const js = fs.readFileSync(JS_PATH, 'utf8');

test('widget.html references only relative subresources', () => {
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(references.length >= 3, 'expected the stylesheet and both scripts');
  for (const reference of references) {
    assert.ok(reference.startsWith('./'), `subresource must be relative: ${reference}`);
    assert.ok(!reference.startsWith('/'), `absolute subresource breaks file:// loading: ${reference}`);
  }
});

test('widget.html declares a strict CSP', () => {
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  const content = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  for (const directive of [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'none'",
    "connect-src 'none'",
    "img-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ]) {
    assert.ok(content.includes(directive), `CSP is missing "${directive}"`);
  }
});

test('widget.html uses classic scripts, not modules', () => {
  assert.ok(!/<script[^>]*type="module"/.test(html), 'the widget scripts must stay classic <script> files');
  assert.match(html, /<script src="\.\/widget-pure\.js"><\/script>/);
  assert.match(html, /<script src="\.\/widget\.js"><\/script>/);
});

test('widget.html carries the widget root marker', () => {
  assert.match(html, /<body data-widget-root>/);
});

test('widget.html contains no emoji and no visible text', () => {
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(html), 'no emoji allowed');

  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)[1];
  const text = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]*>/g, '').trim();
  assert.equal(text, '', `the widget must be text-free, found: ${JSON.stringify(text)}`);
});

test('the only accessible text is the sr-only live region', () => {
  assert.match(html, /<div id="live-region" class="sr-only" role="status" aria-live="polite"><\/div>/);
  // The three controls are announced through aria-label, never through glyphs.
  for (const label of ['Pause', 'Stop and transcribe', 'Cancel recording']) {
    assert.ok(html.includes(`aria-label="${label}"`), `missing aria-label "${label}"`);
  }
});

test('widget.html ships the spec structure: 5 idle dots, 12 bars, 5 processing dots', () => {
  const idleBlock = /<div class="c c-idle"[^>]*>([\s\S]*?)<\/div>/.exec(html)[1];
  assert.equal((idleBlock.match(/<i class="dt">/g) || []).length, 5);
  const barsBlock = /<div class="bars" id="bars"[^>]*>([\s\S]*?)<\/div>/.exec(html)[1];
  assert.equal((barsBlock.match(/<i><\/i>/g) || []).length, 12);
  const procBlock = /<div class="c c-proc"[^>]*>([\s\S]*?)<\/div>/.exec(html)[1];
  assert.equal((procBlock.match(/<i class="dt">/g) || []).length, 5);
});

test('widget.js signals readiness as its last statement', () => {
  assert.match(js, /window\.__kimflowWidgetReady = true;/);
  assert.match(js, /window\.__kimflowWidgetReady = true;\s*\}\)\(\);\s*$/, 'the sentinel must be set after init');
});

test('widget.js is a classic script with no imports', () => {
  assert.ok(!/^\s*import\s/m.test(js), 'no ESM imports in a classic script');
  assert.ok(!/require\(/.test(js), 'no CommonJS require in the renderer');
  assert.match(js, /window\.api/);
  assert.ok(!/window\.widget/.test(js), 'the preload bridge is exposed as window.api');
});

test('widget.js never starts a recording (idle is decorative)', () => {
  assert.ok(!/'start'/.test(js), 'the widget must not send a start action');
});

test('widget.css defines the eq and blink keyframes and the reduced-motion branch', () => {
  assert.match(css, /@keyframes eq\{0%,100%\{transform:scaleY\(\.18\)\}50%\{transform:scaleY\(1\)\}\}/);
  assert.match(css, /@keyframes blink\{0%,100%\{opacity:\.25\}50%\{opacity:1\}\}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{/);
  assert.match(css, /\.bars i,\.c-proc \.dt\{animation:none\}/);
});

test('widget.css freezes the bars while paused', () => {
  assert.match(css, /\[data-state="paused"\] \.bars i\{animation:none;transform:scaleY\(\.18\)\}/);
});

test('widget.css keeps the capsule draggable and the buttons clickable', () => {
  assert.match(css, /\.pill\{[^}]*-webkit-app-region:drag[^}]*\}/);
  assert.match(css, /\.btn\{[^}]*-webkit-app-region:no-drag[^}]*\}/);
  assert.match(css, /\.pill\{[^}]*cursor:grab[^}]*\}/);
  assert.match(css, /\.pill:active\{cursor:grabbing\}/);
});

test('widget.css drives only the bars and processing dots from --live', () => {
  const liveConsumers = [...css.matchAll(/^([^{}\n]*)\{[^}]*var\(--live\)[^}]*\}/gm)].map((match) => match[1].trim());
  assert.deepEqual(liveConsumers.sort(), ['.bars i', '.c-proc .dt'].sort());
});

test('widget.css fetches no font file', () => {
  assert.ok(!/@font-face/.test(css), 'Inter must not be bundled or fetched');
  assert.ok(!/url\(/.test(css), 'no external asset may be referenced');
});
