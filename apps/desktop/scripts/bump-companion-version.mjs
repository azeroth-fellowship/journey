#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Keeps the companion's version in one place per file: package.json, src-tauri/tauri.conf.json,
// src-tauri/Cargo.toml (and the azeroth-desktop entry of Cargo.lock, so `cargo build --locked` stays valid).
//
//   node scripts/bump-companion-version.mjs 0.2.0            set all of them
//   node scripts/bump-companion-version.mjs --check 0.2.0    verify they all equal 0.2.0 (exit 1 otherwise)
//   node scripts/bump-companion-version.mjs --check companion-v0.2.0   same; a release tag is accepted
//
// Paths are relative to this file, so it works from any working directory and in any repo layout that keeps
// apps/desktop together.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAG_PREFIX = 'companion-v';
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const files = {
  packageJson: join(root, 'package.json'),
  tauriConf: join(root, 'src-tauri', 'tauri.conf.json'),
  cargoToml: join(root, 'src-tauri', 'Cargo.toml'),
  cargoLock: join(root, 'src-tauri', 'Cargo.lock'),
};
const CARGO_PACKAGE_NAME = 'azeroth-desktop';

const read = (p) => readFileSync(p, 'utf8');
// Edit text in place (keeping each file's line endings and formatting) instead of re-serialising JSON.
const JSON_VERSION = /^(\s*"version"\s*:\s*")([^"]*)(")/m;
const TOML_PACKAGE_VERSION = /(\[package\][^[]*?^version\s*=\s*")([^"]*)(")/ms;
const LOCK_VERSION = new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${CARGO_PACKAGE_NAME}"\\r?\\nversion = ")([^"]*)(")`);

function currentVersions() {
  const grab = (re, text, what) => {
    const m = re.exec(text);
    if (!m) throw new Error(`could not find the version in ${what}`);
    return m[2];
  };
  return {
    'package.json': grab(JSON_VERSION, read(files.packageJson), 'package.json'),
    'src-tauri/tauri.conf.json': grab(JSON_VERSION, read(files.tauriConf), 'tauri.conf.json'),
    'src-tauri/Cargo.toml': grab(TOML_PACKAGE_VERSION, read(files.cargoToml), 'Cargo.toml'),
  };
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const check = args[0] === '--check';
const input = (check ? args[1] : args[0])?.trim();
if (!input) fail('usage: bump-companion-version.mjs <version> | --check <version|companion-vX.Y.Z>');
const version = input.startsWith(TAG_PREFIX) ? input.slice(TAG_PREFIX.length) : input;
if (!SEMVER.test(version)) fail(`"${input}" is not a valid version (expected X.Y.Z or X.Y.Z-pre.1, tag form ${TAG_PREFIX}X.Y.Z)`);

if (check) {
  const found = currentVersions();
  const bad = Object.entries(found).filter(([, v]) => v !== version);
  if (bad.length) {
    console.error(`error: tag/version ${version} does not match the companion's files:`);
    for (const [f, v] of Object.entries(found)) console.error(`  ${v === version ? 'ok  ' : 'FAIL'} ${f}: ${v}`);
    console.error(`Run \`node apps/desktop/scripts/bump-companion-version.mjs ${version}\`, commit, and re-tag.`);
    process.exit(1);
  }
  console.log(`companion version ${version} matches package.json, tauri.conf.json and Cargo.toml`);
} else {
  const set = (file, re, label) => {
    const text = read(file);
    if (!re.test(text)) fail(`could not find the version in ${label}`);
    writeFileSync(file, text.replace(re, (_, a, _old, c) => `${a}${version}${c}`));
  };
  set(files.packageJson, JSON_VERSION, 'package.json');
  set(files.tauriConf, JSON_VERSION, 'tauri.conf.json');
  set(files.cargoToml, TOML_PACKAGE_VERSION, 'Cargo.toml');
  if (existsSync(files.cargoLock) && LOCK_VERSION.test(read(files.cargoLock))) set(files.cargoLock, LOCK_VERSION, 'Cargo.lock');
  console.log(`companion version set to ${version}. Next: commit, then \`git tag ${TAG_PREFIX}${version} && git push origin ${TAG_PREFIX}${version}\`.`);
}
