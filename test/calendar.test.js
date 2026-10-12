import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar, fold } from '../src/calendar.js';

const NOW = new Date('2026-10-12T12:00:00Z');
const r = (host, validTo, connected = true) => ({ host, connected, validTo: new Date(validTo) });

function unfold(text) {
  return text.replace(/\r\n /g, '');
}

test('one all-day reminder per valid certificate, warn-days before expiry', () => {
  const { text, count } = buildCalendar([r('ejemplo.es', '2026-11-28T22:51:00Z')], { lang: 'es', warnDays: 14, now: NOW });
  assert.equal(count, 1);
  const t = unfold(text);
  assert.match(t, /BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(t, /DTSTART;VALUE=DATE:20261114\r\n/);
  assert.match(t, /DTEND;VALUE=DATE:20261115\r\n/);
  assert.match(t, /SUMMARY:Renovar el certificado TLS de ejemplo\.es\r\n/);
  assert.match(t, /Si se renueva solo\\, no te hace falta este aviso/);
  assert.match(t, /END:VCALENDAR\r\n$/);
});

test('if the reminder day has passed, it goes today; expired or unreachable get none', () => {
  const { text, count } = buildCalendar([
    r('pronto.es', '2026-10-15T00:00:00Z'),
    r('caducado.es', '2026-10-01T00:00:00Z'),
    r('caido.es', '2026-12-01T00:00:00Z', false),
  ], { now: NOW });
  assert.equal(count, 1);
  assert.match(text, /DTSTART;VALUE=DATE:20261012/);
});

test('the same certificate gives the same UID, so importing twice does not duplicate', () => {
  const a = buildCalendar([r('ejemplo.es', '2026-11-28T22:51:00Z')], { now: NOW }).text;
  const b = buildCalendar([r('ejemplo.es', '2026-11-28T22:51:00Z')], { now: new Date('2026-10-13T00:00:00Z') }).text;
  assert.equal(/UID:(\S+)/.exec(a)[1], /UID:(\S+)/.exec(b)[1]);
});

test('every line is at most 75 octets and lines end in CRLF', () => {
  const { text } = buildCalendar([r('un-dominio-con-un-nombre-bastante-largo-para-probar.ejemplo.es', '2026-12-28T00:00:00Z')], { lang: 'es', now: NOW });
  for (const line of text.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.ok(!/[^\r]\n/.test(text));
});

test('folding never splits a multi-byte character', () => {
  const folded = fold(`DESCRIPTION:${'ñ'.repeat(60)}`);
  for (const part of folded.split('\r\n ')) assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(part)));
  assert.equal(folded.replace(/\r\n /g, ''), `DESCRIPTION:${'ñ'.repeat(60)}`);
});
