// SPDX-License-Identifier: GPL-3.0-only
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { PAIRING_SIGNATURE_PREFIX, type DiscoveredCharacter } from '@azeroth/contracts';
import type { Identity } from './machine';

/** Event name emitted by src-tauri with the raw deep-link URL(s). */
export const DEEP_LINK_EVENT = 'deep-link-urls';

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Creates the keypair on first call (private key stays in the OS keychain); returns the raw public key, base64. */
export const ensureDevicePublicKey = () => invoke<string>('ensure_device_key');
export const deviceName = () => invoke<string>('device_name');
export const loadIdentity = () => invoke<Identity | null>('load_identity');
export const saveIdentity = (identity: Identity) => invoke<void>('save_identity', { ...identity });
export const clearIdentity = () => invoke<void>('clear_identity');
export const initialDeepLinks = () => invoke<string[]>('initial_deep_links');
export const defaultWowDir = () => invoke<string | null>('default_wow_dir');
/** Raw text of the addon's SavedVariables file, one entry per WoW account folder. */
export const readSavedVariables = (wowDir: string) => invoke<string[]>('read_saved_variables', { wowDir });
export const discoverCharacters = (wowDir: string) => invoke<DiscoveredCharacter[]>('discover_characters', { wowDir });

/** Signs `PAIRING_SIGNATURE_PREFIX + code`; Rust refuses any message without that prefix. */
export const signPairing = (code: string) => invoke<string>('sign_pairing', { message: PAIRING_SIGNATURE_PREFIX + code });

export function onDeepLink(cb: (urls: string[]) => void): Promise<() => void> {
  return listen<string[]>(DEEP_LINK_EVENT, (e) => cb(e.payload));
}

export const openWebsite = (path?: string) => invoke<void>('open_website', { path });
/** Updates the tray menu label ("Pause syncing" / "Resume syncing"). */
export const setPaused = (paused: boolean) => invoke<void>('set_paused', { paused });
export const TRAY_PAUSE_EVENT = 'tray-toggle-pause';
export const onTrayTogglePause = (cb: () => void): Promise<() => void> => listen(TRAY_PAUSE_EVENT, () => cb());

/** Native folder picker; null when cancelled. */
export async function pickFolder(defaultPath?: string): Promise<string | null> {
  const picked = await openDialog({ directory: true, multiple: false, ...(defaultPath ? { defaultPath } : {}) });
  return typeof picked === 'string' ? picked : null;
}
