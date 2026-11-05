import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Load the repository-root .env so VITE_DEV_PORT / VITE_DEV_API
// are picked up by `npm run dev` just like the API server does.
const rootEnv = resolve(fileURLToPath(new URL('.', import.meta.url)), '../.env');
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.VITE_DEV_PORT || 5173),
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API || 'http://127.0.0.1:3001',
        // Preserve the browser-facing host for the API's same-origin check.
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          flow: ['@xyflow/react'],
          markdown: ['streamdown'],
        },
      },
    },
  },
});
