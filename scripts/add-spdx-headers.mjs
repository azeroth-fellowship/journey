#!/usr/bin/env node
// Adds `SPDX-License-Identifier: GPL-3.0-only` to first-party source files of the public (GPL) part of the repo.
// Idempotent: files that already carry an SPDX line in their first 5 lines are left alone.
//
//   node scripts/add-spdx-headers.mjs [--check] [--root <dir>]
//
// --check lists files that lack a header and exits 1 (no writes). Generated/build output is never touched.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

const ID = 'GPL-3.0-only';
const args = process.argv.slice(2);
const check = args.includes('--check');
const rootArg = args.indexOf('--root');
const root = resolve(rootArg >= 0 ? args[rootArg + 1] : '.');

// Public first-party source roots, relative to the repo root. Missing ones are skipped.
const ROOTS = [
  'apps/addon/src',
  'apps/addon/tests',
  'apps/desktop/src',
  'apps/desktop/scripts',
  'apps/desktop/src-tauri/src',
  'apps/desktop/src-tauri/build.rs',
  'apps/desktop/vite.config.ts',
  'packages/contracts/src',
  'packages/api-client/src',
  'scripts/add-spdx-headers.mjs',
];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'target', 'gen', '.next']);

// extension -> [prefix, suffix]
const COMMENT = {
  '.ts': ['// ', ''], '.tsx': ['// ', ''], '.mjs': ['// ', ''], '.js': ['// ', ''], '.rs': ['// ', ''],
  '.wowlua': ['-- ', ''], '.lua': ['-- ', ''],
  '.css': ['/* ', ' */'],
};

function* walk(p) {
  const st = statSync(p, { throwIfNoEntry: false });
  if (!st) return;
  if (st.isFile()) { yield p; return; }
  for (const name of readdirSync(p)) {
    if (SKIP_DIRS.has(name)) continue;
    yield* walk(join(p, name));
  }
}

const CRLF = String.fromCharCode(13, 10);
const LF = String.fromCharCode(10);

let changed = 0;
for (const r of ROOTS) {
  for (const file of walk(join(root, r))) {
    const style = COMMENT[extname(file)];
    if (!style) continue;
    const text = readFileSync(file, 'utf8');
    if (text.split(LF, 5).some((l) => l.includes('SPDX-License-Identifier'))) continue;
    const eol = text.includes(CRLF) ? CRLF : LF;
    const header = `${style[0]}SPDX-License-Identifier: ${ID}${style[1]}${eol}`;
    // Keep a shebang on line 1. Insert textually so the file's own line endings stay untouched.
    const at = text.startsWith('#!') ? text.indexOf(LF) + 1 : 0;
    const next = text.slice(0, at) + header + text.slice(at);
    changed++;
    const rel = relative(root, file).split(sep).join('/');
    if (check) console.log(`missing: ${rel}`);
    else { writeFileSync(file, next); console.log(`header: ${rel}`); }
  }
}
console.log(`${check ? 'would change' : 'changed'} ${changed} file(s)`);
process.exit(check && changed ? 1 : 0);
