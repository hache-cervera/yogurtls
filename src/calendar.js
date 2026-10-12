// A calendar file (.ics, RFC 5545) with one all-day reminder per certificate,
// some days before it expires. It imports into Google Calendar, Outlook or Apple Calendar.

import { createHash } from 'node:crypto';

const DAY_MS = 86_400_000;

const TEXT = {
  en: {
    summary: (host) => `Renew the TLS certificate of ${host}`,
    description: (host, date) => `It expires on ${date}. If it renews on its own, you don't need this reminder. Check it with: npx yogurtls ${host}`,
  },
  es: {
    summary: (host) => `Renovar el certificado TLS de ${host}`,
    description: (host, date) => `Caduca el ${date}. Si se renueva solo, no te hace falta este aviso. Compruébalo con: npx yogurtls ${host}`,
  },
};

function ymd(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function stamp(date) {
  return `${date.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

// Text values escape backslash, semicolon, comma and line breaks.
function esc(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Lines longer than 75 octets are folded: CRLF plus one space, without splitting a character.
export function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, 'utf8');
    const limit = parts.length === 0 ? 75 : 74;
    if (size + len > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += len;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/**
 * results: TLS check results (host, connected, validTo). Only certificates that have not expired get a reminder.
 * The reminder goes warnDays before expiry, or today if that day has already passed.
 */
export function buildCalendar(results, { lang = 'en', warnDays = 14, now = new Date(), formatDate } = {}) {
  const t = TEXT[lang] ?? TEXT.en;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//yogurtls//yogurtls//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  let count = 0;
  for (const r of results) {
    if (!r.connected || !r.validTo || r.validTo <= now) continue;
    let day = new Date(r.validTo.getTime() - warnDays * DAY_MS);
    day = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    if (day < today) day = today;
    const next = new Date(day.getTime() + DAY_MS);
    const uid = createHash('sha1').update(`${r.host}|${r.validTo.toISOString()}`).digest('hex');
    const shown = formatDate ? formatDate(r.validTo) : r.validTo.toISOString().slice(0, 10);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}@yogurtls`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${ymd(day)}`,
      `DTEND;VALUE=DATE:${ymd(next)}`,
      `SUMMARY:${esc(t.summary(r.host))}`,
      `DESCRIPTION:${esc(t.description(r.host, shown))}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(t.summary(r.host))}`,
      'TRIGGER:PT9H',
      'END:VALARM',
      'END:VEVENT',
    );
    count++;
  }
  lines.push('END:VCALENDAR');
  return { text: `${lines.map(fold).join('\r\n')}\r\n`, count };
}
