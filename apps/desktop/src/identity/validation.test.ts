// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { normalizeLinkCode, validateTravellerName } from './validation';

describe('normalizeLinkCode', () => {
  it.each(['LINK-8H2Q-K7ZM', 'link-8h2q-k7zm', ' link 8h2q k7zm ', 'LINK8H2QK7ZM', '8h2qk7zm', '8H-2QK7-ZM'])('normalizes %j', (v) => {
    expect(normalizeLinkCode(v)).toEqual({ ok: true, value: 'LINK-8H2Q-K7ZM' });
  });

  it.each(['', '   ', '---'])('asks for a code when %j is blank', (v) => {
    const r = normalizeLinkCode(v);
    expect(!r.ok && r.message).toMatch(/enter/i);
  });

  it.each(['LINK-8H2Q', 'LINK-8H2Q-K7Z', 'LINK-8H2Q-K7ZMX', 'WOLF-3K7P-ABCD', '12'])('rejects %j', (v) => {
    expect(normalizeLinkCode(v).ok).toBe(false);
  });
});

describe('validateTravellerName', () => {
  it.each(['abc', 'Trav_el-1', 'a'.repeat(24), '  padded  '])('accepts %j', (v) => {
    const r = validateTravellerName(v);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(v.trim());
  });

  it.each(['', '   ', 'ab', 'a'.repeat(25), '-abc', '_abc', 'has space', 'bad!chars', 'ünï'])('rejects %j', (v) => {
    expect(validateTravellerName(v).ok).toBe(false);
  });

  it('gives a distinct message for empty input', () => {
    const r = validateTravellerName('');
    expect(!r.ok && r.message).toMatch(/choose/i);
  });
});
