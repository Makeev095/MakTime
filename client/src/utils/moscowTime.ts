const MOSCOW_TIME_ZONE = 'Europe/Moscow';

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function moscowDayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value || '0000';
  const month = parts.find((p) => p.type === 'month')?.value || '00';
  const day = parts.find((p) => p.type === 'day')?.value || '00';
  return `${year}-${month}-${day}`;
}

export function formatMoscowClockTime(value: string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: MOSCOW_TIME_ZONE,
  });
}

export function formatMoscowLastSeen(value: string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';

  const now = new Date();
  const isTodayInMoscow = moscowDayKey(d) === moscowDayKey(now);
  if (isTodayInMoscow) {
    return `сегодня в ${formatMoscowClockTime(value)}`;
  }

  const datePart = d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: MOSCOW_TIME_ZONE,
  });

  return `${datePart} в ${formatMoscowClockTime(value)}`;
}

export function formatMoscowConversationTime(value: string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '';

  const now = new Date();
  const isTodayInMoscow = moscowDayKey(d) === moscowDayKey(now);
  if (isTodayInMoscow) {
    return formatMoscowClockTime(value);
  }

  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: MOSCOW_TIME_ZONE,
  });
}

export function formatMoscowDateLabel(value: string): string {
  const d = toDate(value);
  if (!d) return '';

  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: MOSCOW_TIME_ZONE,
  });
}
