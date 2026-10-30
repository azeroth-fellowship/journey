// SPDX-License-Identifier: GPL-3.0-only
/** Custom URL scheme the companion registers. Keep in sync with tauri.conf.json and src-tauri/src/lib.rs (DEEP_LINK_SCHEME). */
export const DEEP_LINK_SCHEME = 'azeroth-journey';

export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
export const WEBSITE_URL: string = import.meta.env.VITE_WEB_URL ?? 'http://localhost:3000';
