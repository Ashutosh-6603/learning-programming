import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { ascentApi } from './server/api-plugin.ts';

const workspaceRoot = path.resolve(import.meta.dirname, '..');

export default defineConfig({
  plugins: [react(), tailwindcss(), ascentApi(process.env['ASCENT_DATA_DIR'] ?? path.join(import.meta.dirname, 'data'))],
  define: { __WORKSPACE_ROOT__: JSON.stringify(workspaceRoot) },
  // STEPS.md files live next to this folder, in the app repos.
  server: { port: 5199, strictPort: true, fs: { allow: [workspaceRoot] } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
