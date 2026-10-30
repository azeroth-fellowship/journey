// SPDX-License-Identifier: GPL-3.0-only
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WEB_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
