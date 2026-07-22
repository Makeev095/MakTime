import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.maktalk.app',
  appName: 'MakTalk',
  webDir: 'dist',
  server: {
    // By default the native wrappers load the production web app.
    // Override with CAP_SERVER_URL for staging/local testing.
    url: process.env.CAP_SERVER_URL || 'https://maktalk.ru',
    cleartext: false,
    androidScheme: 'https',
    allowNavigation: ['maktalk.ru', '*.maktalk.ru'],
  },
};

export default config;
