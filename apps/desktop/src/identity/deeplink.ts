// SPDX-License-Identifier: GPL-3.0-only
import { PairingCodeString } from '@azeroth/contracts';
import { DEEP_LINK_SCHEME } from '../config';

/** Extracts the pairing code from `azeroth-journey://pair?code=WOLF-3K7P`; null for anything else. */
export function parsePairingUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return null;
  if (url.hostname !== 'pair') return null;
  const code = url.searchParams.get('code')?.trim().toUpperCase();
  if (!code) return null;
  const parsed = PairingCodeString.safeParse(code);
  return parsed.success ? parsed.data : null;
}

/** First valid pairing code among several launch URLs. */
export function firstPairingCode(urls: readonly string[]): string | null {
  for (const u of urls) {
    const c = parsePairingUrl(u);
    if (c) return c;
  }
  return null;
}
