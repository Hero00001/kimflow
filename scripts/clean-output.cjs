// scripts/clean-output.cjs
//
// Removes the local electron-builder output directory before a build.
//
// Why: electron-builder's first step is to EMPTY its output directory, and on
// this machine a stale `resources/app.asar` inside it is intermittently held
// open by an OS handle with no owning process (Defender real-time scan,
// Explorer, or a zombie app-builder handle). When that happens every build
// dies with ERR_ELECTRON_BUILDER_CANNOT_EXECUTE before it even starts.
//
// Deleting the directory here, before electron-builder sees it, means there
// is nothing left for electron-builder to empty. If THIS deletion also hits
// the lock, the build cannot be saved from the command line — reboot (which
// reliably releases the handle) and run again.
'use strict';

const fs = require('fs');

const dir = process.argv[2] || 'dist-build';

try {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`[clean-output] removed ${dir}`);
} catch (error) {
  // Non-fatal: if the directory is locked the build will fail with the
  // familiar app.asar error and the machine needs a reboot anyway.
  console.warn(`[clean-output] could not remove ${dir} (${error.message}) — continuing`);
}
