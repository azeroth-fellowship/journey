// SPDX-License-Identifier: GPL-3.0-only
import { LinkCodeString, TravellerName } from '@azeroth/contracts';

export type NameCheck = { ok: true; value: string } | { ok: false; message: string };

/** Client-side check; the rules come from the contracts schema so they cannot drift from the API. */
export function validateTravellerName(raw: string): NameCheck {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, message: 'Choose a traveller name.' };
  const parsed = TravellerName.safeParse(value);
  if (parsed.success) return { ok: true, value };
  return { ok: false, message: 'Use 3-24 characters: letters, digits, _ or -, starting with a letter or digit.' };
}

export type LinkCodeCheck = { ok: true; value: string } | { ok: false; message: string };

/** Accepts "link-8h2q-k7zm", "LINK 8H2Q K7ZM", "8h2qk7zm" and similar; returns the canonical LINK-XXXX-XXXX form. */
export function normalizeLinkCode(raw: string): LinkCodeCheck {
  const chars = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (chars.length === 0) return { ok: false, message: 'Enter the code from the website.' };
  const suffix = chars.startsWith('LINK') && chars.length > 4 ? chars.slice(4) : chars;
  const parsed = LinkCodeString.safeParse(`LINK-${suffix.slice(0, 4)}-${suffix.slice(4)}`);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, message: 'Codes look like LINK-8H2Q-K7ZM.' };
}
