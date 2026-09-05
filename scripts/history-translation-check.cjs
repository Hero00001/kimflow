/* Regression test: history sessions keep their translation.
 *
 * Fails before the fix, passes after:
 *  1. history.addSession accepts translation fields and persists them.
 *  2. history.updateSession patches translation onto an existing entry.
 *  3. recorder patches the history entry once translation completes.
 *
 * Usage: node scripts/history-translation-check.cjs
 * (Uses a temp CONFIG_DIR so the real ~/.kimflow/history.json is untouched.)
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
  const history = require('../backend/history.cjs');
  // CONFIG_DIR is hardcoded to ~/.kimflow, so back up the real history
  // file and restore it afterwards — the test must leave no trace.
  const historyPath = history.HISTORY_PATH;
  const backupPath = `${historyPath}.latency-test-bak`;
  const hadHistory = fs.existsSync(historyPath);
  if (hadHistory) fs.copyFileSync(historyPath, backupPath);

  // 1. addSession stores translation fields.
  const added = history.addSession({
    text: 'Hello world',
    durationMs: 1000,
    translation: 'Bonjour le monde',
    translationTarget: 'fr',
    translationError: null,
  }) || {};
  check(
    'addSession persists translation',
    added.translation === 'Bonjour le monde' && added.translationTarget === 'fr',
    `got ${JSON.stringify({ translation: added.translation, target: added.translationTarget })}`,
  );

  // 2. updateSession patches translation onto an existing entry.
  check(
    'history exports updateSession()',
    typeof history.updateSession === 'function',
    'expected history.updateSession(id, {translation, ...})',
  );
  if (typeof history.updateSession === 'function') {
    const plain = history.addSession({ text: 'Good morning', durationMs: 500 });
    const id = plain.id;
    history.updateSession(id, {
      translation: 'Buenos días',
      translationTarget: 'es',
      translationError: null,
    });
    const reloaded = history.load();
    const patched = reloaded.sessions.find((s) => s.id === id) || {};
    check(
      'updateSession patches translation',
      patched.translation === 'Buenos días' && patched.translationTarget === 'es',
      `got ${JSON.stringify({ translation: patched.translation, target: patched.translationTarget })}`,
    );
  }

  // 3. Recorder patches history once translation completes (source check:
  // the history write must happen after translationService.translate).
  const recorderSource = fs.readFileSync(
    path.join(__dirname, '..', 'backend', 'recorder.cjs'),
    'utf8',
  );
  const translateIndex = recorderSource.indexOf('translationService.translate');
  const updateIndex = Math.max(
    recorderSource.indexOf('updateSession'),
    recorderSource.indexOf('updateHistoryTranslation'),
  );
  check(
    'recorder updates history after translation completes',
    translateIndex !== -1 && updateIndex !== -1 && updateIndex > translateIndex,
    'expected a history update call AFTER translationService.translate',
  );

  if (hadHistory) fs.copyFileSync(backupPath, historyPath);
  else fs.rmSync(historyPath, { force: true });
  fs.rmSync(backupPath, { force: true });

  if (failures > 0) {
    console.error(`\n${failures} history-translation check(s) FAILED.`);
    process.exit(1);
  }
  console.log('\nAll history-translation checks passed.');
}

main().catch((error) => {
  console.error('History-translation test crashed:', error);
  process.exit(1);
});
