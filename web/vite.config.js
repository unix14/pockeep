import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('../shared', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': shared } },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    // during development the API runs separately on :3000
    proxy: { '/api': 'http://localhost:3000' }
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 800 }
});
