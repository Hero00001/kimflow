'use strict';
// Minimal TypeScript -> CommonJS loader for the test suite.
//
// The i18n core (`src/i18n/index.ts`, `src/i18n/locales/*.ts`) and the error
// mapper (`src/utils.ts`) are TypeScript, but the suite runs on plain
// `node --test test/*.test.cjs`. Instead of a build step, we transpile each
// module in-memory with the real TypeScript compiler (a devDependency) and
// evaluate it in an isolated CommonJS scope. `import type` is erased by the
// compiler, so the locale files never actually `require` one another at runtime.
//
// An optional `override` hook lets a test inject a substitute module (used to
// prove the English fallback with a deliberately partial locale).

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const EXTENSIONS = ['.ts', '.tsx', '.js', '.cjs'];

function resolveFile(basePath) {
  const candidates = [];
  if (path.extname(basePath)) candidates.push(basePath);
  for (const ext of EXTENSIONS) candidates.push(basePath + ext);
  for (const ext of EXTENSIONS) candidates.push(path.join(basePath, 'index' + ext));
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

function transpile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
    reportDiagnostics: false,
  }).outputText;
}

/**
 * Load a TypeScript/CommonJS module graph rooted at `entryPath`.
 *
 * @param {string} entryPath absolute (or cwd-relative) path to the entry module
 * @param {(resolvedAbsPath: string) => object|undefined} [override] when it
 *   returns a non-undefined value for a resolved path, that value is used in
 *   place of loading the file.
 * @param {Map<string, {exports: any}>} [cache] shared module cache for one graph
 */
function loadTs(entryPath, override, cache) {
  const resolved = resolveFile(path.resolve(entryPath));
  if (!resolved) throw new Error(`Cannot resolve module: ${entryPath}`);

  const moduleCache = cache || new Map();
  if (moduleCache.has(resolved)) return moduleCache.get(resolved).exports;
  if (override) {
    const injected = override(resolved);
    if (injected !== undefined) return injected;
  }

  const code = transpile(resolved);
  const dir = path.dirname(resolved);
  const mod = { exports: {} };
  moduleCache.set(resolved, mod);

  const localRequire = (request) => {
    if (request.startsWith('.') || path.isAbsolute(request)) {
      const target = resolveFile(path.resolve(dir, request));
      if (!target) throw new Error(`Cannot resolve "${request}" from ${dir}`);
      return loadTs(target, override, moduleCache);
    }
    return require(request);
  };

  const compiled = new Function('exports', 'require', 'module', '__filename', '__dirname', code);
  compiled(mod.exports, localRequire, mod, resolved, dir);
  return mod.exports;
}

module.exports = { loadTs, resolveFile };
