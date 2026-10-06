// backend/engine-download.cjs — one-click whisper engine acquisition.
// Download/verify/extract/smoke-test pipeline for the pinned flavors in
// engine-manifest.cjs. Mirrors model-download.cjs patterns deliberately:
// same progress channel, same tmp+rename atomicity, same byte-count gate.
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./settings.cjs');
const { getEngineSpec, validateFlavor } = require('./engine-manifest.cjs');

function enginesRoot() {
  return path.join(CONFIG_DIR, 'engines');
}

function engineDir(flavor) {
  return path.join(enginesRoot(), validateFlavor(flavor));
}

function engineBinaryPath(flavor) {
  const spec = getEngineSpec(validateFlavor(flavor));
  const dir = engineDir(flavor);
  // Upstream zips nest the binary (e.g. Release/whisper-cli.exe) — locate it
  // instead of assuming top level. Falls back to the top-level path when
  // nothing is installed yet so callers always get a usable string.
  return findEngineBinary(dir, spec.binaryName) || path.join(dir, spec.binaryName);
}

function engineInstalled(flavor) {
  try {
    return findEngineBinary(engineDir(validateFlavor(flavor))) !== null;
  } catch {
    return false;
  }
}

// Recursive basename search: engine zips lay out files differently per
// release (top level vs Release/ subfolder). Case-insensitive like Windows.
function findEngineBinary(dir, binaryName = 'whisper-cli.exe') {
  const wanted = String(binaryName).toLowerCase();
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === wanted) return full;
    }
  }
  return null;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

async function downloadEngineZip(mainWindow, flavor) {
  const spec = getEngineSpec(validateFlavor(flavor));
  fs.mkdirSync(enginesRoot(), { recursive: true });
  const tempDest = path.join(enginesRoot(), `.${spec.key}-${crypto.randomUUID()}.zip`);
  try {
    const response = await axios.get(spec.url, {
      responseType: 'stream',
      timeout: 120000,
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Engine download failed with status ${response.status}`);
    }
    const total = Number(response.headers['content-length']) || 0;
    let downloaded = 0;
    const writer = fs.createWriteStream(tempDest);
    response.data.on('data', (chunk) => {
      downloaded += chunk.length;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          downloaded, total, percent: total ? (downloaded / total) * 100 : 0,
        });
      }
    });
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });
    if (total > 0 && downloaded !== total) {
      throw new Error(`Engine download incomplete: received ${downloaded} of ${total} bytes`);
    }
    if (sha256File(tempDest) !== spec.sha256.toLowerCase()) {
      throw new Error('Engine download did not match its fingerprint — deleted, please try again');
    }
    return tempDest;
  } catch (error) {
    try { fs.unlinkSync(tempDest); } catch { /* partial download cleanup */ }
    throw error;
  }
}

function safeEntryPath(entryName, destDir) {
  const normalized = String(entryName).replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Unsafe zip entry: ${entryName}`);
  }
  const resolved = path.resolve(destDir, normalized);
  const root = path.resolve(destDir) + path.sep;
  if (resolved !== path.resolve(destDir) && !resolved.startsWith(root)) {
    throw new Error(`Unsafe zip entry: ${entryName}`);
  }
  return resolved;
}

function extractEngineZip(zipPath, flavor, wantedFiles) {
  // yauzl is required lazily so startup and every non-download path pay nothing.
  const yauzl = require('yauzl');
  validateFlavor(flavor);
  // Default keeps the exe plus every DLL: a Windows exe without its sibling
  // DLLs refuses to start (0xC0000135), so exe-only extraction can never pass
  // the smoke test. Layout is preserved — DLLs stay next to their exe.
  const wanted = wantedFiles && wantedFiles.length > 0 ? wantedFiles : null;
  const destDir = engineDir(flavor);
  fs.mkdirSync(destDir, { recursive: true });
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      zip.on('error', reject);
      zip.on('entry', (entry) => {
        let target;
        try {
          target = safeEntryPath(entry.fileName, destDir);
        } catch (entryError) {
          zip.close();
          return reject(entryError);
        }
        const base = path.basename(entry.fileName);
        const keep = wanted
          ? wanted.includes(base)
          : base.toLowerCase() === 'whisper-cli.exe' || base.toLowerCase().endsWith('.dll');
        if (/\/$/.test(entry.fileName) || !keep) {
          zip.readEntry();
          return;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            zip.close();
            return reject(streamError);
          }
          const out = fs.createWriteStream(target);
          out.on('error', (writeError) => { zip.close(); reject(writeError); });
          out.on('finish', () => { zip.readEntry(); });
          stream.on('error', (readError) => { zip.close(); reject(readError); });
          stream.pipe(out);
        });
      });
      zip.on('end', () => {
        const exe = findEngineBinary(destDir, 'whisper-cli.exe');
        if (!exe) {
          reject(new Error('Engine archive did not contain whisper-cli.exe'));
          return;
        }
        resolve(exe);
      });
      zip.readEntry();
    });
  });
}

module.exports = { enginesRoot, engineDir, engineBinaryPath, engineInstalled, findEngineBinary, removeEngine, downloadEngineZip, safeEntryPath, extractEngineZip, smokeTestEngine, detectGpu };

const { execFile } = require('node:child_process');

async function defaultExec(binaryPath, args, options) {
  const { promisify } = require('node:util');
  await promisify(execFile)(binaryPath, args, options);
}

async function smokeTestEngine(binaryPath, execFn = defaultExec) {
  // A downloaded engine must prove it starts on THIS machine before it
  // becomes active (catches AVX2-baseline crashes like exit 3221225501).
  // Crash exit codes get the human explanation, not raw exec output.
  const { isCrashExitCode, crashErrorMessage } = require('./engines/local-whisper.cjs');
  try {
    await execFn(binaryPath, ['--help'], { timeout: 30000, windowsHide: true });
    return true;
  } catch (error) {
    const detail = error instanceof Error && error.message ? error.message : String(error);
    const code = error && error.code;
    if (code != null && isCrashExitCode(code)) {
      throw new Error(`Engine failed its startup check.${crashErrorMessage(code, detail)}`);
    }
    throw new Error(`Engine failed its startup check: ${detail}`);
  }
}

function removeEngine(flavor) {
  validateFlavor(flavor);
  try {
    fs.rmSync(engineDir(flavor), { recursive: true, force: true });
  } catch { /* already gone is fine */ }
}

async function detectGpu(deps = {}) {
  const run = deps.run || (async (command) => {
    const { promisify } = require('node:util');
    const { stdout } = await promisify(execFile)(
      command === 'nvidia-smi' ? 'nvidia-smi' : 'powershell',
      command === 'nvidia-smi' ? ['-L'] : ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name'],
      { timeout: 15000, windowsHide: true },
    );
    return { stdout: String(stdout) };
  });
  const fileExists = deps.fileExists || fs.existsSync;
  const platform = deps.platform || process.platform;
  try {
    await run('nvidia-smi');
    return 'nvidia';
  } catch { /* not an NVIDIA machine */ }
  if (platform === 'win32') {
    try {
      const { stdout } = await run('wmic-video');
      if (/amd|radeon/i.test(stdout)) {
        const vulkanDll = 'C:\\Windows\\System32\\vulkan-1.dll';
        if (fileExists(vulkanDll)) return 'amd';
      }
    } catch { /* fall through to cpu */ }
  }
  return 'cpu';
}
