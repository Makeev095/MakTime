import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

type NativePlatform = 'ios' | 'android';

function resolveTokenEndpoint(platform: NativePlatform): '/api/devices/apns-token' | '/api/devices/fcm-token' {
  return platform === 'ios' ? '/api/devices/apns-token' : '/api/devices/fcm-token';
}

async function saveNativePushToken(authToken: string, platform: NativePlatform, deviceToken: string) {
  const endpoint = resolveTokenEndpoint(platform);
  await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      token: deviceToken,
      platform,
    }),
  });
}

export function useNativePushRegistration(
  authToken: string | null,
  onPushSignal?: () => void
) {
  useEffect(() => {
    if (!authToken) return;

    const platform = Capacitor.getPlatform();
    if (platform !== 'ios' && platform !== 'android') return;
    const nativePlatform = platform as NativePlatform;

    // Avoid noisy "plugin is not implemented" when the native binary
    // wasn't rebuilt with @capacitor/push-notifications yet.
    if (!Capacitor.isPluginAvailable('PushNotifications')) {
      console.info('[Push] plugin unavailable on', nativePlatform, '(rebuild native app after cap sync)');
      return;
    }

    let active = true;

    const setupPush = async () => {
      try {
        // Cap can report the plugin as "available" while the native class is
        // missing from an outdated binary — probe with checkPermissions.
        const permissionProbe = await PushNotifications.checkPermissions().catch((err: any) => {
          const msg = String(err?.message || err || '');
          if (/not implemented|UNIMPLEMENTED/i.test(msg)) return null;
          throw err;
        });
        if (!permissionProbe) {
          console.info('[Push] native plugin missing — run npm run mobile:sync:prod and rebuild iOS');
          return;
        }

        if (nativePlatform === 'android') {
          await PushNotifications.createChannel({
            id: 'maktalk-default',
            name: 'MakTalk notifications',
            description: 'Chat messages and calls',
            importance: 5,
            visibility: 1,
            sound: 'default',
          });
        }

        let permission = permissionProbe;
        if (permission.receive === 'prompt') {
          permission = await PushNotifications.requestPermissions();
        }
        if (permission.receive !== 'granted') {
          console.warn('[Push] Permission not granted');
          return;
        }

        await PushNotifications.removeAllListeners();

        await PushNotifications.addListener('registration', (token) => {
          if (!active) return;
          void saveNativePushToken(authToken, nativePlatform, token.value).catch((err) => {
            console.warn('[Push] token save failed:', err?.message || err);
          });
        });

        await PushNotifications.addListener('registrationError', (error) => {
          console.warn('[Push] registration error:', error);
        });

        await PushNotifications.addListener('pushNotificationReceived', () => {
          if (!active) return;
          onPushSignal?.();
        });

        await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          if (!active) return;
          const data = action.notification.data || {};
          window.dispatchEvent(new CustomEvent('maktalk:push-open', { detail: data }));
          onPushSignal?.();
        });

        await PushNotifications.register();
      } catch (error: any) {
        const msg = String(error?.message || error || '');
        if (/not implemented|UNIMPLEMENTED/i.test(msg)) {
          console.info('[Push] native plugin missing — run npm run mobile:sync:prod and rebuild iOS');
          return;
        }
        console.warn('[Push] setup failed:', msg);
      }
    };

    void setupPush();

    return () => {
      active = false;
      if (Capacitor.isPluginAvailable('PushNotifications')) {
        void PushNotifications.removeAllListeners();
      }
    };
  }, [authToken, onPushSignal]);
}
