import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // Relative base so the static build works under any sub-path (e.g. GitHub Pages).
  base: './',
  // Read the monorepo-level .env.
  envDir: '../..',
  // `pnpm dev:phone`: reachable on the Wi-Fi over HTTPS (self-signed), because phones only
  // give GPS, wake lock and vibration to secure pages.
  plugins: [react(), ...(mode === 'phone' ? [basicSsl()] : [])],
  server: {
    port: 5173,
    host: mode === 'phone' ? true : 'localhost',
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
}));
