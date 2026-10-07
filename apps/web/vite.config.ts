import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the static build works under any sub-path (e.g. GitHub Pages).
  base: './',
  // Read the monorepo-level .env.
  envDir: '../..',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
