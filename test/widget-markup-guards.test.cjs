// test/widget-markup-guards.test.cjs
//
// The static guards in test/widget-markup.test.cjs cover the historical
// file:// traps. These are the adversarial additions: they fail if someone
// makes the idle capsule interactive, wires a `start` action through a
// double-quoted string the older single-quote check would miss, adds an inline
// handler the CSP silently kills, or references the network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Normalise CRLF: git may check these files out with Windows line endings,
// and the assertions below match on exact character sequences.
const html = fs.readFileSync(path.join('src', 'widget', 'widget.html'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join('src', 'widget', 'widget.css'), 'utf8').replace(/\r\n/g, '\n');
const js = fs.readFileSync(path.join('src', 'widget', 'widget.js'), 'utf8').replace(/\r\n/g, '\n');

/** The `<div class="c c-idle">…</div>` block, which must stay decorative. */
const idleBlock = /<div class="c c-idle"[^>]*>([\s\S]*?)<\/div>/.exec(html)[1];
/** The `<div class="c c-live">…</div>` block, which owns the three controls. */
const liveBlock = /<div class="c c-live"[^>]*>([\s\S]*)<\/div>\s*<div class="c c-proc"/.exec(html)[1];

test('the idle capsule contains no interactive element', () => {
  assert.ok(!/<button/i.test(idleBlock), 'idle must stay decorative: no button');
  assert.ok(!/tabindex=/i.test(idleBlock), 'idle must not be focusable');
  assert.ok(!/<a\s/i.test(idleBlock), 'idle must not be a link');
  assert.ok(!/on(click|mousedown|mouseup)=/i.test(idleBlock), 'no inline handlers');
});

test('every button in the document lives in the listening/paused layer', () => {
  const buttons = html.match(/<button\b/g) || [];
  assert.equal(buttons.length, 3, `expected exactly 3 controls, found ${buttons.length}`);
  const buttonsInLive = liveBlock.match(/<button\b/g) || [];
  assert.equal(buttonsInLive.length, 3, 'all controls must be inside .c-live');
});

test('widget.js never sends a start action, whatever the quoting style', () => {
  // The older guard only matched single quotes, so `send("start")` slipped
  // through it. Match any quoting style, including template literals.
  assert.ok(!/['"`]start['"`]/.test(js), 'the widget must never send a start action');
  assert.ok(!/\bstart\b/.test(js.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')),
    'no un-commented `start` identifier should appear in the widget renderer');
});

test('widget.js only forwards the four documented overlay actions', () => {
  const allowed = new Set(['pause', 'resume', 'stop', 'cancel']);
  const literals = [...js.matchAll(/\bsend\(\s*['"`]([a-z]+)['"`]\s*\)/g)].map((match) => match[1]);
  assert.ok(literals.length >= 2, 'expected send() calls for stop and cancel');
  for (const action of literals) {
    assert.ok(allowed.has(action), `send('${action}') is not an allowed overlay action`);
  }
  // The pause button's action is chosen by a ternary; both arms must be legal.
  const ternary = /send\(\s*state === 'paused' \? '([a-z]+)' : '([a-z]+)'\s*\)/.exec(js);
  assert.ok(ternary, 'the pause/resume ternary changed shape; re-verify its actions');
  assert.ok(allowed.has(ternary[1]) && allowed.has(ternary[2]));
});

test('no inline event handlers anywhere in the markup', () => {
  // script-src 'self' without 'unsafe-inline' makes these silently dead.
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'inline handlers are blocked by the CSP and would fail silently');
});

test('the widget references no network URL in any of its three files', () => {
  for (const [name, text] of [['widget.html', html], ['widget.css', css], ['widget.js', js]]) {
    assert.ok(!/https?:\/\//i.test(text), `${name} must not reference a remote origin`);
    assert.ok(!/\/\/cdn\./i.test(text), `${name} must not reference a CDN`);
  }
});

test('no emoji anywhere in the widget assets', () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F2FF}]/u;
  for (const [name, text] of [['widget.html', html], ['widget.css', css], ['widget.js', js]]) {
    assert.ok(!emoji.test(text), `${name} contains an emoji`);
  }
});

test('the renderer ready sentinel is the last thing widget.js does', () => {
  const trimmed = js.trimEnd();
  assert.ok(trimmed.endsWith('window.__kimflowWidgetReady = true;\n})();'), 'the sentinel must be set after init');
  // Exactly one assignment: a second one could mask an early failure.
  assert.equal((js.match(/__kimflowWidgetReady\s*=/g) || []).length, 1);
});

test('the widget does not reach for a DOM API the CSP or sandbox would break', () => {
  // eval/new Function/remote scripts would be blocked at runtime by the CSP.
  assert.ok(!/\beval\s*\(/.test(js), 'eval is blocked by the CSP');
  assert.ok(!/new Function\s*\(/.test(js), 'new Function is blocked by the CSP');
  assert.ok(!/document\.write/.test(js));
  assert.ok(!/innerHTML\s*=/.test(js), 'textContent only: the widget must not inject markup');
});
