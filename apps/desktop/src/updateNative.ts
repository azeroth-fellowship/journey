// SPDX-License-Identifier: GPL-3.0-only
import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import type { UpdateDeps } from './update';

/** The real updater; the app supplies the pre-install hook (flush the upload queue). */
export const nativeUpdateDeps = (beforeInstall: () => Promise<void>): UpdateDeps => ({
  isEnabled: () => invoke<boolean>('updates_enabled'),
  check: () => check(),
  relaunch,
  beforeInstall,
});
