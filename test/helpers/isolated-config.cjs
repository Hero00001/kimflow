'use strict';
// test/helpers/isolated-config.cjs
//
// Load `backend/settings.cjs` and `backend/secrets.cjs` against a throwaway
// home directory. `settings.cjs` computes CONFIG_DIR from os.homedir() at
// module load, and `secrets.cjs` defaults its blob directory to that same
// CONFIG_DIR, so both modules must be evicted from require.cache BEFORE the
// environment is changed and re-required AFTER it is changed.
//
// Without this, a test can overwrite the real `~/.kimflow/config.json` and
// delete the real `secret_*.bin` blobs. `node --test` isolates files in
// separate processes, so restoring env/cache here is still done explicitly.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SETTINGS_MODULE = require.resolve('../../backend/settings.cjs');
const SECRETS_MODULE = require.resolve('../../backend/secrets.cjs');
const EVICT = [SETTINGS_MODULE, SECRETS_MODULE];

/**
 * @param {object} t node:test TestContext (used for the cleanup hook)
 * @returns {{settings: object, secrets: object, configDir: string, secretsDir: string, home: string}}
 */
function useIsolatedConfig(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-isolated-'));
  const secretsDir = path.join(home, 'userData');
  fs.mkdirSync(secretsDir, { recursive: true });

  const previousUserProfile = process.env.USERPROFILE;
  const previousHome = process.env.HOME;
  const savedCache = new Map();
  for (const resolved of EVICT) {
    if (require.cache[resolved]) {
      savedCache.set(resolved, require.cache[resolved]);
      delete require.cache[resolved];
    }
  }

  // os.homedir() reads USERPROFILE on Windows and HOME elsewhere.
  process.env.USERPROFILE = home;
  process.env.HOME = home;

  const settings = require(SETTINGS_MODULE);
  const secrets = require(SECRETS_MODULE);
  // Pin the blob directory explicitly as well, so a future change to the
  // default cannot silently point tests back at the real userData.
  secrets.setSecretsDir(secretsDir);

  t.after(() => {
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    for (const resolved of EVICT) delete require.cache[resolved];
    for (const [resolved, entry] of savedCache) require.cache[resolved] = entry;
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  return { settings, secrets, configDir: settings.CONFIG_DIR, secretsDir, home };
}

module.exports = { useIsolatedConfig };
