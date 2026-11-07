#!/usr/bin/env node
'use strict';
// scripts/verify-test-isolation.cjs
//
// B0 safety gate. The old `secrets.test.cjs` rewrote the REAL
// `~/.kimflow/config.json` (backing it up and restoring the bytes in a
// `finally`), and `key-status.test.cjs` / `key-trim.test.cjs` deleted real
// `secret_*.bin` blobs. A green `npm test` therefore did not prove the test
// suite was isolated — it could silently have damaged the user's settings.
//
// This script fingerprints the real config and every secret blob, runs
// `npm test`, and fails if any of them changed. It never deletes anything,
// and restores the config bytes if a run did modify them.

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HOME = os.homedir();
const LEGACY_DIR = path.join(HOME, '.kimflow');
const CONFIG = path.join(LEGACY_DIR, 'config.json');
const USER_DATA_DIR = process.env.APPDATA ? path.join(process.env.APPDATA, 'KimFlow') : null;
const SECRET_BLOB = /^secret_.*\.bin$/;

function watchedFiles() {
  const found = new Set();
  if (fs.existsSync(CONFIG)) found.add(CONFIG);
  for (const dir of [USER_DATA_DIR, LEGACY_DIR]) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (SECRET_BLOB.test(name)) found.add(path.join(dir, name));
    }
  }
  return [...found].sort();
}

function fingerprint(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file, { bigint: true });
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  // Hash alone is not enough: the old test restored identical bytes, so only
  // mtime/ctime reveal that the real file was written at all.
  return `${hash}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

function snapshot(files) {
  return new Map(files.map((file) => [file, fingerprint(file)]));
}

function main() {
  const before = snapshot(watchedFiles());
  const savedConfig = fs.existsSync(CONFIG) ? fs.readFileSync(CONFIG) : null;
  console.log(`[verify-test-isolation] watching ${before.size} real user files:`);
  for (const file of before.keys()) console.log(`  ${file}`);

  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd test' : 'npm test', {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  const afterFiles = watchedFiles();
  const after = snapshot(afterFiles);
  const changed = [];
  for (const [file, fingerprintBefore] of before) {
    if (after.get(file) !== fingerprintBefore) changed.push(file);
  }
  for (const file of afterFiles) {
    if (!before.has(file)) changed.push(file);
  }

  // Restore, never delete. Byte-for-byte, even if a suite truncated the file.
  if (savedConfig && (!fs.existsSync(CONFIG) || !fs.readFileSync(CONFIG).equals(savedConfig))) {
    try {
      fs.writeFileSync(CONFIG, savedConfig);
      console.error('[verify-test-isolation] restored the original config.json bytes');
    } catch (error) {
      console.error('[verify-test-isolation] could not restore config.json:', error.message);
    }
  }

  if (result.status !== 0) {
    console.error(`[verify-test-isolation] FAIL: npm test exited with ${result.status}`);
    process.exit(result.status || 1);
  }
  if (changed.length > 0) {
    console.error('[verify-test-isolation] FAIL: real user files were touched by npm test:');
    for (const file of changed) console.error(`  ${file}`);
    process.exit(1);
  }
  console.log('[verify-test-isolation] PASS: real config.json and all secret blobs unchanged (bytes + mtime/ctime).');
}

main();
