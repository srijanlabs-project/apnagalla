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
    target: 'es2022',
    // Capacitor copies this folder into the Android app.
    outDir: 'dist',
  },
});
