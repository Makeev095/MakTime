import apn from 'apn';
import fs from 'fs';

const KEY_PATH = process.env.APNS_KEY_PATH;
const KEY_ID = process.env.APNS_KEY_ID;
const TEAM_ID = process.env.APNS_TEAM_ID;
/** Bundle ID приложения без `.voip` (например com.maktime.app) */
const BUNDLE_ID = process.env.APNS_BUNDLE_ID;
const PRODUCTION = process.env.APNS_PRODUCTION === 'true' || process.env.APNS_PRODUCTION === '1';

let provider: apn.Provider | null = null;

export function logApnsVoipStartup(): void {
  if (!KEY_PATH || !KEY_ID || !TEAM_ID || !BUNDLE_ID) {
    console.warn(
      '[VoIP/APNS] Not configured (APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID). Offline calls will not wake iOS.'
    );
    return;
  }
  if (!fs.existsSync(KEY_PATH)) {
    console.warn('[VoIP/APNS] Key file not found:', KEY_PATH);
    return;
  }
  console.log(
    `[VoIP/APNS] Config present (${PRODUCTION ? 'production' : 'sandbox'}), topic ${BUNDLE_ID}.voip`
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

export type VoipCallPayload = {
  callUUID: string;
  from: string;
  callerName: string;
  conversationId: string;
};

/** Отправка VoIP push (PushKit). Требует apns-push-type: voip — патчим заголовки. */
export async function sendVoipIncomingCall(
  deviceTokenHex: string | undefined,
  data: VoipCallPayload
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
  note.topic = `${BUNDLE_ID}.voip`;
  note.priority = 10;
  note.expiry = 0;
  note.contentAvailable = true;
  note.payload = {
    callUUID: data.callUUID,
    from: data.from,
    callerName: data.callerName,
    conversationId: data.conversationId,
  };

  const proto = apn.Notification.prototype as unknown as { headers(this: apn.Notification): Record<string, string> };
  (note as unknown as { headers(): Record<string, string> }).headers = function (this: apn.Notification) {
    const h = proto.headers.call(this);
    return { ...h, 'apns-push-type': 'voip' };
  };

  try {
    const result = await p.send(note, token);
    if (result.failed?.length) {
      const f = result.failed[0] as {
        status?: string;
        response?: { reason?: string };
        error?: Error;
      };
      const reason = f.response?.reason ?? f.status ?? f.error?.message ?? 'unknown';
      console.warn('[VoIP/APNS] send failed:', reason, f.response);
      return { ok: false, error: String(reason) };
    }
    return { ok: true };
  } catch (e: any) {
    console.warn('[VoIP/APNS] send error:', e?.message ?? e);
    return { ok: false, error: e?.message ?? 'send_error' };
  }
}
