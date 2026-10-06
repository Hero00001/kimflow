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
  return path.join(engineDir(flavor), spec.binaryName);
}

function engineInstalled(flavor) {
  try {
    return fs.existsSync(engineBinaryPath(validateFlavor(flavor)));
  } catch {
    return false;
  }
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
  const wanted = wantedFiles && wantedFiles.length > 0 ? wantedFiles : ['whisper-cli.exe'];
  const destDir = engineDir(flavor);
  fs.mkdirSync(destDir, { recursive: true });
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const kept = [];
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
        if (/\/$/.test(entry.fileName) || !wanted.includes(base)) {
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
          out.on('finish', () => { kept.push(target); zip.readEntry(); });
          stream.on('error', (readError) => { zip.close(); reject(readError); });
          stream.pipe(out);
        });
      });
      zip.on('end', () => {
        const exe = path.join(destDir, 'whisper-cli.exe');
        if (!kept.includes(exe)) {
          reject(new Error('Engine archive did not contain whisper-cli.exe'));
          return;
        }
        resolve(exe);
      });
      zip.readEntry();
    });
  });
}

module.exports = { enginesRoot, engineDir, engineBinaryPath, engineInstalled, downloadEngineZip, safeEntryPath, extractEngineZip };
