// test/paste-helper.test.cjs
//
// Unit tests for the persistent SendInput paste helper's stdin/stdout
// protocol, driven by an injectable fake child process — the same pattern
// test/helpers/electron-main-harness.cjs uses. NO real keystroke is sent
// here: the helper's Add-Type compile and the actual SendInput call can
// only be verified in a real Windows session with a focused target app.
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  ensureHelper,
  sendPaste,
  pasteViaHelper,
  shutdownPasteHelper,
  PASTE_HELPER_TIMEOUT_MS,
} = require('../backend/paste-helper.cjs');

/** A fake child process that behaves like the PowerShell helper. */
function createFakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.stdinLines = [];
  child.killCount = 0;
  child.kill = () => {
    child.killCount += 1;
    if (child.exitCode === null) {
      child.exitCode = 1;
      // Deferred so handlers registered after the kill call still run.
      setImmediate(() => child.emit('exit', 1, null));
    }
    return true;
  };
  return child;
}

/**
 * Wire a fake child up as a well-behaved helper: prints READY after the
 * current microtask queue (as the real Add-Type compile would), then answers
 * each stdin `paste` line with `PASTE_OK`.
 */
function behaveAsGoodHelper(child) {
  setImmediate(() => child.stdout.write('READY\n'));
  let buffer = '';
  child.stdin.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      child.stdinLines.push(line);
      if (line === 'paste') child.stdout.write('PASTE_OK\n');
      if (line === 'quit') {
        child.exitCode = 0;
        child.emit('exit', 0, null);
      }
    }
  });
}

/** A spawn injection that always hands out the given fake children in order. */
function fakeSpawn(children) {
  const spawned = [];
  const spawnImpl = () => {
    if (children.length === 0) throw new Error('no fake child left');
    const child = children.shift();
    spawned.push(child);
    return child;
  };
  spawnImpl.spawned = spawned;
  return spawnImpl;
}

test('pasteViaHelper sends exactly one paste line and resolves on PASTE_OK', async () => {
  const child = createFakeChild();
  behaveAsGoodHelper(child);
  const spawnImpl = fakeSpawn([child]);

  await pasteViaHelper({ spawn: spawnImpl });

  assert.deepEqual(child.stdinLines, ['paste']);
  // The helper must have been started lazily, with an encoded command.
  assert.equal(spawnImpl.spawned.length, 1);
  shutdownPasteHelper();
});

test('the helper is respawned once after being shut down', async () => {
  const first = createFakeChild();
  behaveAsGoodHelper(first);
  const second = createFakeChild();
  behaveAsGoodHelper(second);
  const spawnImpl = fakeSpawn([first, second]);

  await pasteViaHelper({ spawn: spawnImpl });
  shutdownPasteHelper();
  await pasteViaHelper({ spawn: spawnImpl });

  assert.equal(spawnImpl.spawned.length, 2, 'a second child was spawned');
  shutdownPasteHelper();
});

test('a COMPILE_FAIL during startup rejects with the reason', async () => {
  const child = createFakeChild();
  setImmediate(() => {
    child.stdout.write('COMPILE_FAIL Add-Type blocked by policy\n');
    child.exitCode = 1;
    child.emit('exit', 1, null);
  });
  const spawnImpl = fakeSpawn([child]);

  await assert.rejects(
    () => pasteViaHelper({ spawn: spawnImpl }),
    /Add-Type blocked by policy/,
  );
});

test('a PASTE_FAIL answer rejects with the helper reason', async () => {
  const child = createFakeChild();
  setImmediate(() => child.stdout.write('READY\n'));
  child.stdin.on('data', () => child.stdout.write('PASTE_FAIL SendInput injected 0 of 4 events\n'));
  const spawnImpl = fakeSpawn([child]);

  await assert.rejects(
    () => pasteViaHelper({ spawn: spawnImpl }),
    /injected 0 of 4 events/,
  );
  shutdownPasteHelper();
});

test('a paste that gets no answer times out and kills the helper', async () => {
  const child = createFakeChild();
  setImmediate(() => child.stdout.write('READY\n'));
  // No responder: the helper never answers.
  const spawnImpl = fakeSpawn([child]);

  await assert.rejects(
    () => pasteViaHelper({ spawn: spawnImpl, timeoutMs: 20 }),
    /timed out/,
  );
  assert.equal(child.killCount, 1, 'the wedged helper was killed');
  shutdownPasteHelper();
});

test('a helper that exits before READY rejects the startup', async () => {
  const child = createFakeChild();
  child.stderr.write('some powershell noise\n');
  setImmediate(() => {
    child.exitCode = 1;
    child.emit('exit', 1, null);
  });
  const spawnImpl = fakeSpawn([child]);

  await assert.rejects(
    () => pasteViaHelper({ spawn: spawnImpl }),
    /exited during startup/,
  );
});

test('a paste pending when the helper exits is rejected', async () => {
  const child = createFakeChild();
  setImmediate(() => child.stdout.write('READY\n'));
  const spawnImpl = fakeSpawn([child]);

  const state = await ensureHelper({ spawn: spawnImpl });
  const pastePromise = sendPaste(state, PASTE_HELPER_TIMEOUT_MS);
  // The process dies while the paste is in flight.
  setImmediate(() => {
    child.exitCode = 1;
    child.emit('exit', 1, null);
  });
  await assert.rejects(() => pastePromise, /exited unexpectedly/);
});

test('quit via shutdownPasteHelper asks the helper to quit', async () => {
  const child = createFakeChild();
  behaveAsGoodHelper(child);
  const spawnImpl = fakeSpawn([child]);

  await pasteViaHelper({ spawn: spawnImpl });
  shutdownPasteHelper();

  assert.ok(child.stdinLines.includes('quit'), 'the helper was asked to quit');
});

test('the helper refuses to run off Windows', async () => {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: 'linux' });
  try {
    await assert.rejects(
      () => pasteViaHelper({ spawn: () => createFakeChild() }),
      /only available on Windows/,
    );
  } finally {
    Object.defineProperty(process, 'platform', { value: original });
  }
});
