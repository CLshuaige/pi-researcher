import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.GEWU_CLIENT_PORT || 5173),
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.GEWU_API_TARGET || 'http://127.0.0.1:3001',
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
