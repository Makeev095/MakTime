import type { CapacitorConfig } from '@capacitor/cli';

const capEnv = process.env.CAP_ENV || 'production';
const fallbackServerUrl = capEnv === 'staging'
  ? 'https://staging.maktalk.ru'
  : 'https://maktalk.ru';
const serverUrl = process.env.CAP_SERVER_URL || fallbackServerUrl;
const serverHost = (() => {
  try {
    return new URL(serverUrl).hostname;
  } catch {
    return 'maktalk.ru';
  }
})();
const allowNavigation = serverHost.includes('.')
  ? [serverHost, `*.${serverHost}`]
  : [serverHost];

const config: CapacitorConfig = {
  appId: 'ru.maktalk.app',
  appName: 'MakTalk',
  webDir: 'dist',
  server: {
    // Default target can switch between production/staging via CAP_ENV.
    // Highest priority is explicit CAP_SERVER_URL.
    url: serverUrl,
    cleartext: false,
    androidScheme: 'https',
    allowNavigation,
  },
};

export default config;
