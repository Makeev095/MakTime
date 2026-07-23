type SmsSendResult = { ok: true } | { ok: false; error: string };

const SMS_PROVIDER = (process.env.SMS_PROVIDER || 'console').toLowerCase();
const SMS_RU_API_ID = process.env.SMS_RU_API_ID || '';
const SMS_RU_FROM = process.env.SMS_RU_FROM || '';

function getFetch():
  | ((input: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<any>)
  | null {
  const fetchImpl = (globalThis as any).fetch;
  return typeof fetchImpl === 'function' ? fetchImpl : null;
}

async function sendViaSmsRu(phoneE164: string, message: string): Promise<SmsSendResult> {
  if (!SMS_RU_API_ID) {
    return { ok: false, error: 'SMS_RU_API_ID missing' };
  }

  const fetchImpl = getFetch();
  if (!fetchImpl) {
    return { ok: false, error: 'fetch unavailable on server runtime' };
  }

  const params = new URLSearchParams({
    api_id: SMS_RU_API_ID,
    to: phoneE164,
    msg: message,
    json: '1',
  });
  if (SMS_RU_FROM) {
    params.set('from', SMS_RU_FROM);
  }

  try {
    const response = await fetchImpl(`https://sms.ru/sms/send?${params.toString()}`, {
      method: 'GET',
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload) {
      return { ok: false, error: `sms.ru http ${response.status}` };
    }

    if (payload.status !== 'OK') {
      return { ok: false, error: payload.status_text || 'sms.ru error' };
    }

    const smsByPhone = payload.sms?.[phoneE164];
    if (smsByPhone?.status === 'OK') {
      return { ok: true };
    }

    return { ok: false, error: smsByPhone?.status_text || 'sms.ru send failed' };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'sms.ru request failed' };
  }
}

export function logSmsStartup(): void {
  if (SMS_PROVIDER === 'smsru') {
    if (SMS_RU_API_ID) {
      console.log('[SMS] Provider sms.ru configured');
    } else {
      console.warn('[SMS] Provider sms.ru selected but SMS_RU_API_ID is missing');
    }
    return;
  }

  console.warn(
    '[SMS] Provider is "console". OTP codes will be logged to server logs and SMS will not be sent to phones.'
  );
}

export async function sendSmsCode(phoneE164: string, code: string): Promise<SmsSendResult> {
  const message = `MakTalk code: ${code}. Valid for 5 minutes.`;

  if (SMS_PROVIDER === 'smsru') {
    return sendViaSmsRu(phoneE164, message);
  }

  console.log(`[SMS][console] ${phoneE164} -> ${code}`);
  return { ok: true };
}
