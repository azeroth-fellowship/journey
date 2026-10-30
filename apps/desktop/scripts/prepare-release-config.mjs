#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Turns src-tauri/tauri.release.conf.json into src-tauri/tauri.release.generated.conf.json (git-ignored) for
// `tauri build --config`: fills in the GitHub repo that hosts the update feed and refuses to continue while the
// updater public key is still the placeholder.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repo that hosts the GitHub Releases the updater polls (`https://github.com/<owner>/<repo>/releases/latest/download/latest.json`).
 * THE single place to set it. CI overrides it with GITHUB_REPOSITORY (the repo the workflow runs in), which is
 * what you want in the public repo; set it here for local release builds.
 */
const RELEASE_REPO = 'azeroth-fellowship/journey';
const PUBKEY_PLACEHOLDER = 'REPLACE_WITH_UPDATER_PUBLIC_KEY';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri');
const src = join(dir, 'tauri.release.conf.json');
const out = join(dir, 'tauri.release.generated.conf.json');

const fail = (msg) => {
  console.error(`error: ${msg}`);
  process.exit(1);
};

const repo = process.env.GITHUB_REPOSITORY || RELEASE_REPO;
if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || repo === 'OWNER/REPO') {
  fail(`release repo is "${repo}". Set RELEASE_REPO in scripts/prepare-release-config.mjs (or GITHUB_REPOSITORY) to <owner>/<repo>.`);
}
if (!existsSync(src)) fail(`${src} not found`);

const text = readFileSync(src, 'utf8').replaceAll('{{RELEASE_REPO}}', repo);
const conf = JSON.parse(text);
const pubkey = conf.plugins?.updater?.pubkey;
if (!pubkey || pubkey === PUBKEY_PLACEHOLDER) {
  fail('plugins.updater.pubkey in src-tauri/tauri.release.conf.json is still the placeholder. Generate a key with `cargo tauri signer generate` and paste the PUBLIC key there (see docs/releasing.md).');
}
writeFileSync(out, `${JSON.stringify(conf, null, 2)}\n`);
console.log(`wrote ${out} (update feed: ${conf.plugins.updater.endpoints.join(', ')})`);
