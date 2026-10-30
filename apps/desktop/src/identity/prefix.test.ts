// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAIRING_SIGNATURE_PREFIX } from '@azeroth/contracts';
import { DEEP_LINK_SCHEME } from '../config';

// Rust duplicates these constants (it must not sign arbitrary messages); guard against drift.
const rust = readFileSync(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const rustConfig = readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8');

describe('Rust/TS constant parity', () => {
  it('pairing signature prefix', () => {
    expect(rust).toContain(`const PAIRING_SIGNATURE_PREFIX: &str = "${PAIRING_SIGNATURE_PREFIX}";`);
  });
  it('deep link scheme', () => {
    expect(rust).toContain(`const DEEP_LINK_SCHEME: &str = "${DEEP_LINK_SCHEME}";`);
    expect(JSON.parse(rustConfig).plugins['deep-link'].desktop.schemes).toEqual([DEEP_LINK_SCHEME]);
  });
});
