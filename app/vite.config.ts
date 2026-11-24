import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
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
