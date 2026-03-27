import apn from 'apn';
import fs from 'fs';

/** Тот же .p8 и переменные, что и для VoIP; topic = основной bundle ID (без `.voip`). */
const KEY_PATH = process.env.APNS_KEY_PATH;
const KEY_ID = process.env.APNS_KEY_ID;
const TEAM_ID = process.env.APNS_TEAM_ID;
const BUNDLE_ID = process.env.APNS_BUNDLE_ID;
const PRODUCTION = process.env.APNS_PRODUCTION === 'true' || process.env.APNS_PRODUCTION === '1';

let provider: apn.Provider | null = null;

export function logApnsAlertStartup(): void {
  if (!KEY_PATH || !KEY_ID || !TEAM_ID || !BUNDLE_ID) {
    console.warn(
      '[Alert/APNS] Not configured (same vars as VoIP: APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID). Offline chat pushes disabled.'
    );
    return;
  }
  if (!fs.existsSync(KEY_PATH)) {
    console.warn('[Alert/APNS] Key file not found:', KEY_PATH);
    return;
  }
  console.log(
    `[Alert/APNS] Config present (${PRODUCTION ? 'production' : 'sandbox'}), topic ${BUNDLE_ID} (alert)`
  );
}

function ensureProvider(): apn.Provider | null {
  if (provider) return provider;
  if (!KEY_PATH || !KEY_ID || !TEAM_ID || !BUNDLE_ID) return null;
  if (!fs.existsSync(KEY_PATH)) return null;
  provider = new apn.Provider({
    token: {
      key: KEY_PATH,
      keyId: KEY_ID,
      teamId: TEAM_ID,
    },
    production: PRODUCTION,
  });
  return provider;
}

export type ChatAlertPayload = {
  conversationId: string;
  title: string;
  body: string;
};

/** Обычный APNs alert (не VoIP). Клиент читает `conversationId` из корня payload. */
export async function sendChatMessageAlert(
  deviceTokenHex: string | undefined,
  data: ChatAlertPayload
): Promise<{ ok: boolean; error?: string }> {
  const token = (deviceTokenHex ?? '').replace(/\s/g, '').toLowerCase();
  if (token.length < 32) {
    return { ok: false, error: 'no_device_token' };
  }

  const p = ensureProvider();
  if (!p) {
    return { ok: false, error: 'apns_not_configured' };
  }

  const note = new apn.Notification();
  note.topic = BUNDLE_ID!;
  note.priority = 10;
  note.expiry = Math.floor(Date.now() / 1000) + 86400;
  note.sound = 'default';
  note.alert = { title: data.title, body: data.body };
  note.payload = { conversationId: data.conversationId };

  try {
    const result = await p.send(note, token);
    if (result.failed?.length) {
      const f = result.failed[0] as {
        status?: string;
        response?: { reason?: string };
        error?: Error;
      };
      const reason = f.response?.reason ?? f.status ?? f.error?.message ?? 'unknown';
      console.warn('[Alert/APNS] send failed:', reason, f.response);
      return { ok: false, error: String(reason) };
    }
    return { ok: true };
  } catch (e: any) {
    console.warn('[Alert/APNS] send error:', e?.message ?? e);
    return { ok: false, error: e?.message ?? 'send_error' };
  }
}
