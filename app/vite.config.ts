import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const version = JSON.parse(readFileSync(new URL('./version.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true, // reachable from a phone on the same Wi-Fi
  },
  build: {
    // Older Android WebViews (no Google services = often no WebView updates) need conservative output.
    target: ['es2020', 'chrome87'],
    // Capacitor copies this folder into the Android app.
    outDir: 'dist',
  },
});
