// SPDX-License-Identifier: GPL-3.0-only
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 1420, strictPort: true },
});
