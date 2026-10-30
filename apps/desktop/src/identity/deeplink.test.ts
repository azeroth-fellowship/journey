// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, it } from 'vitest';
import { firstPairingCode, parsePairingUrl } from './deeplink';

describe('parsePairingUrl', () => {
  it('extracts the code', () => {
    expect(parsePairingUrl('azeroth-journey://pair?code=WOLF-3K7P')).toBe('WOLF-3K7P');
  });

  it('normalises case and trailing slash / extra params', () => {
    expect(parsePairingUrl('azeroth-journey://pair/?x=1&code=wolf-3k7p')).toBe('WOLF-3K7P');
  });

  it.each([
    'https://example.com/pair?code=WOLF-3K7P',
    'other-scheme://pair?code=WOLF-3K7P',
    'azeroth-journey://settings?code=WOLF-3K7P',
    'azeroth-journey://pair',
    'azeroth-journey://pair?code=',
    'azeroth-journey://pair?code=NOPE',
    'azeroth-journey://pair?code=WOLF-3K7P%0Ax',
    'not a url',
    '',
  ])('rejects %j', (u) => {
    expect(parsePairingUrl(u)).toBeNull();
  });

  it('firstPairingCode skips junk', () => {
    expect(firstPairingCode(['garbage', 'azeroth-journey://pair?code=ABCD-1234'])).toBe('ABCD-1234');
    expect(firstPairingCode([])).toBeNull();
  });
});
