import admin from 'firebase-admin';

const FCM_PROJECT_ID = process.env.FCM_PROJECT_ID;
const FCM_CLIENT_EMAIL = process.env.FCM_CLIENT_EMAIL;
const FCM_PRIVATE_KEY = (process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const FCM_STORAGE_BUCKET = process.env.FCM_STORAGE_BUCKET;

let firebaseApp: admin.app.App | null = null;

function hasFcmConfig(): boolean {
  return !!(FCM_PROJECT_ID && FCM_CLIENT_EMAIL && FCM_PRIVATE_KEY);
}

function ensureFirebaseApp(): admin.app.App | null {
  if (firebaseApp) return firebaseApp;
  if (!hasFcmConfig()) return null;

  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FCM_PROJECT_ID,
        clientEmail: FCM_CLIENT_EMAIL,
        privateKey: FCM_PRIVATE_KEY,
      }),
      ...(FCM_STORAGE_BUCKET ? { storageBucket: FCM_STORAGE_BUCKET } : {}),
    });
  } catch (error: any) {
    if (admin.apps.length > 0) {
      firebaseApp = admin.app();
    } else {
      console.warn('[FCM] init failed:', error?.message || error);
      return null;
    }
  }

  return firebaseApp;
}

export function logFcmStartup(): void {
  if (!hasFcmConfig()) {
    console.warn(
      '[FCM] Not configured (FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY). Android/background notifications disabled.'
    );
    return;
  }

  const app = ensureFirebaseApp();
  if (!app) {
    console.warn('[FCM] Config present but initialization failed.');
    return;
  }

  console.log(`[FCM] Config present, project: ${FCM_PROJECT_ID}`);
}

export type FcmNotificationPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

export async function sendFcmNotification(
  deviceToken: string | undefined,
  payload: FcmNotificationPayload
): Promise<{ ok: boolean; error?: string }> {
  const token = (deviceToken ?? '').trim();
  if (token.length < 16) {
    return { ok: false, error: 'no_device_token' };
  }

  const app = ensureFirebaseApp();
  if (!app) {
    return { ok: false, error: 'fcm_not_configured' };
  }

  try {
    await app.messaging().send({
      token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data,
      android: {
        priority: 'high',
        notification: {
          channelId: 'maktalk-default',
          priority: 'high',
          sound: 'default',
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
        },
        payload: {
          aps: {
            sound: 'default',
            contentAvailable: true,
          },
        },
      },
    });

    return { ok: true };
  } catch (error: any) {
    const message = error?.errorInfo?.message || error?.message || 'send_error';
    console.warn('[FCM] send failed:', message);
    return { ok: false, error: String(message) };
  }
}
