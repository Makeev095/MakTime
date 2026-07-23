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

    // Push needs a paid Apple Developer team + rebuilt native binary.
    // Until then, skip quietly — chat/calls still work online.
    if (!Capacitor.isPluginAvailable('PushNotifications')) {
      return;
    }

    let active = true;

    const setupPush = async () => {
      try {
        const permissionProbe = await PushNotifications.checkPermissions().catch((err: any) => {
          const msg = String(err?.message || err || '');
          if (/not implemented|UNIMPLEMENTED/i.test(msg)) return null;
          throw err;
        });
        if (!permissionProbe) return;

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
          return;
        }

        await PushNotifications.removeAllListeners();

        await PushNotifications.addListener('registration', (token) => {
          if (!active) return;
          void saveNativePushToken(authToken, nativePlatform, token.value).catch(() => {});
        });

        await PushNotifications.addListener('registrationError', () => {});

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
      } catch {
        // Ignore until native push is fully configured.
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
