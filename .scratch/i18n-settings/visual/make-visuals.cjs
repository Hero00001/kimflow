'use strict';
// Visual verification harness.
//
// Renders the REAL built markup (dist/index.html, dist/src/overlay.html), the
// REAL built stylesheet, and the REAL locale data in headless Chromium, then
// screenshots each language. The app's own bundle is removed (it needs the
// Electron `window.api` bridge); an inline script applies the locale exactly as
// `applyLanguage()` + `renderStatic()` do, so what is captured is the true
// CSS/markup/glyph rendering.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const { loadTs } = require(path.resolve('test/helpers/ts-loader.cjs'));

const CHROME = path.join(process.env.USERPROFILE, 'AppData', 'Local', 'ms-playwright',
  'chromium-1248', 'chrome-win64', 'chrome.exe');
const OUT = path.resolve('.scratch/i18n-settings/visual');

const LOCALES = {
  en: loadTs('src/i18n/locales/en.ts').en,
  ar: loadTs('src/i18n/locales/ar.ts').ar,
  zh: loadTs('src/i18n/locales/zh.ts').zh,
};

const SAMPLE = {
  en: 'This is a sample transcript, rendered to check the English layout.',
  ar: 'هذا نص تجريبي لعرض التخطيط باللغة العربية.',
  zh: '这是一段示例转录文本，用于检查中文排版。',
};

function inlineScript(locale, lang, page) {
  return `<script>
(function () {
  var LOC = ${JSON.stringify(locale)};
  var LANG = ${JSON.stringify(lang)};
  var PAGE = ${JSON.stringify(page)};
  document.documentElement.lang = LANG;
  document.documentElement.dir = (LANG === 'ar') ? 'rtl' : 'ltr';
  function t(k, params) {
    var s = Object.prototype.hasOwnProperty.call(LOC, k) ? LOC[k] : k;
    if (params) s = s.replace(/\\{(\\w+)\\}/g, function (m, n) {
      return Object.prototype.hasOwnProperty.call(params, n) ? params[n] : m;
    });
    return s;
  }
  function each(sel, fn) { document.querySelectorAll(sel).forEach(fn); }
  each('[data-i18n]', function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
  each('[data-i18n-title]', function (el) { el.title = t(el.getAttribute('data-i18n-title')); });
  each('[data-i18n-aria-label]', function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label'))); });
  each('[data-i18n-placeholder]', function (el) { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
  function set(id, txt) { var e = document.getElementById(id); if (e) e.textContent = txt; }
  if (PAGE === 'settings' || PAGE === 'settings-collapsed') {
    document.getElementById('page-transcribe').classList.add('hidden');
    document.getElementById('page-settings').classList.remove('hidden');
    var lr = document.getElementById('local-row'); if (lr) lr.classList.remove('hidden');
    if (PAGE === 'settings') each('.settings-section', function (d) { d.open = true; });
    set('speechmatics-key-status', t('settings.key.none'));
    set('deepgram-key-status', t('settings.key.none'));
    set('gemini-key-status', t('settings.key.none'));
    set('binary-path-display', t('settings.binary.notSelected'));
    set('hotkey-display', 'Ctrl+Shift+Space');
    var hki = document.getElementById('hotkey-input'); if (hki) hki.value = 'CmdOrCtrl+Shift+Space';
    set('download-btn', t('settings.download.download'));
    var flavors = [['engine-cpu-btn', 'CPU', '8 MB'], ['engine-nvidia-btn', 'NVIDIA', '273 MB'], ['engine-amd-btn', 'AMD', '18 MB']];
    flavors.forEach(function (x) { set(x[0], t('settings.engine.download.flavor', { flavor: x[1], size: x[2] })); });
    var es = document.getElementById('engine-suggestion');
    if (es) { es.textContent = t('settings.engine.suggested', { gpu: 'NVIDIA' }); es.classList.remove('hidden'); }
  } else if (PAGE === 'transcribe') {
    set('transcript-text', ${JSON.stringify(SAMPLE[lang])});
  }
})();
</script>`;
}

function writeHarness(sourceFile, targetFile, { lang, page, locale }) {
  let html = fs.readFileSync(sourceFile, 'utf8');
  html = html.replace(/<script type="module"[^>]*><\/script>/g, '');
  html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');
  // file:// blocks CORS-mode subresources; drop `crossorigin` so the real
  // stylesheet loads.
  html = html.replace(/ crossorigin/g, '');
  html = html.replace('</body>', `${inlineScript(locale, lang, page)}</body>`);
  fs.writeFileSync(targetFile, html, 'utf8');
}

function shoot(targetFile, pngFile, width, height) {
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--screenshot=${pngFile}`,
    `file:///${targetFile.replace(/\\/g, '/')}`,
  ], { stdio: 'ignore' });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const distRoot = path.resolve('dist');
  const produced = [];

  try {
    for (const lang of ['en', 'ar', 'zh']) {
      const locale = LOCALES[lang];

      // Settings — all sections expanded.
      writeHarness('dist/index.html', path.join(distRoot, `__visual_index_${lang}_settings.html`), { lang, page: 'settings', locale });
      let png = path.join(OUT, `${lang}_settings_open.png`);
      shoot(path.join(distRoot, `__visual_index_${lang}_settings.html`), png, 1200, 1500);
      produced.push(png);

      // Settings — default collapsed state (only the first section open).
      writeHarness('dist/index.html', path.join(distRoot, `__visual_index_${lang}_collapsed.html`), { lang, page: 'settings-collapsed', locale });
      png = path.join(OUT, `${lang}_settings_collapsed.png`);
      shoot(path.join(distRoot, `__visual_index_${lang}_collapsed.html`), png, 1200, 760);
      produced.push(png);

      // Transcribe page.
      writeHarness('dist/index.html', path.join(distRoot, `__visual_index_${lang}_transcribe.html`), { lang, page: 'transcribe', locale });
      png = path.join(OUT, `${lang}_transcribe.png`);
      shoot(path.join(distRoot, `__visual_index_${lang}_transcribe.html`), png, 1200, 760);
      produced.push(png);

      // Overlay widget (real 200x46 window).
      writeHarness('dist/src/overlay.html', path.join(distRoot, 'src', `__visual_overlay_${lang}.html`), { lang, page: 'overlay', locale });
      png = path.join(OUT, `${lang}_overlay.png`);
      shoot(path.join(distRoot, 'src', `__visual_overlay_${lang}.html`), png, 200, 46);
      produced.push(png);
    }
  } finally {
    // Clean up the temporary harnesses written into dist/.
    for (const file of fs.readdirSync(distRoot)) {
      if (file.startsWith('__visual_')) fs.rmSync(path.join(distRoot, file));
    }
    for (const file of fs.readdirSync(path.join(distRoot, 'src'))) {
      if (file.startsWith('__visual_')) fs.rmSync(path.join(distRoot, 'src', file));
    }
  }

  console.log('produced:');
  for (const png of produced) console.log('  ' + path.relative(process.cwd(), png));
}

main().catch((error) => { console.error(error); process.exit(1); });
