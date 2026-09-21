import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // Crucial for VS Code Webview where absolute paths /assets fail
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4173',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
});
