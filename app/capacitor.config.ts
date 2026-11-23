import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Play Store package ID — permanent once published. Do not change.
  appId: 'in.galla.app',
  appName: 'Galla',
  webDir: 'dist',
  android: {
    // Allows talking to a local dev server over http (e.g. http://10.0.2.2:3000) in debug builds.
    // The release build should only ever call the https Railway API.
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
};

export default config;
