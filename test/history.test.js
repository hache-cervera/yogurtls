import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHistory, parseEntries, identityFor, normalizeSerial, historiesFor } from '../src/history.js';
import { judge } from '../src/verdict.js';
import { renderReport } from '../src/format.js';

const NOW = new Date('2026-10-12T12:00:00Z');
const DAY = 86_400_000;

// A crt.sh row as the JSON API returns it. Dates have no time zone and are UTC.
function row(serial, notBefore, days, issuer = "C=US, O=Let's Encrypt, CN=R11", name = 'ejemplo.es') {
  const from = new Date(`${notBefore}T00:00:00Z`);
  const to = new Date(from.getTime() + days * DAY);
  const fmt = (d) => d.toISOString().slice(0, 19);
  return { serial_number: serial, not_before: fmt(from), not_after: fmt(to), issuer_name: issuer, common_name: name, name_value: `${name}\nwww.${name}` };
}

// Renewed every 60 days, 90-day certificates.
function automaticRows(lastIssued = '2026-09-01') {
  const rows = [];
  let at = new Date(`${lastIssued}T00:00:00Z`).getTime() - 5 * 60 * DAY;
  for (let i = 0; i < 6; i++) {
    const day = new Date(at).toISOString().slice(0, 10);
    rows.push(row(`0a${i}`, day, 90));
    rows.push(row(`0a${i}`, day, 90)); // precertificate, same serial
    at += 60 * DAY;
  }
  return rows;
}

test('serials are compared without case, separators or leading zeros', () => {
  assert.equal(normalizeSerial('00:0A:B1'), 'ab1');
  assert.equal(normalizeSerial('0AB1'), 'ab1');
});

test('a wildcard certificate is looked up under the wildcard', () => {
  assert.equal(identityFor('www.ejemplo.es', ['ejemplo.es', '*.ejemplo.es']), '*.ejemplo.es');
  assert.equal(identityFor('www.ejemplo.es', ['ejemplo.es', 'www.ejemplo.es', '*.ejemplo.es']), 'www.ejemplo.es');
  assert.equal(identityFor('ejemplo.es', ['*.ejemplo.es']), 'ejemplo.es');
});

test('precertificates are not counted twice and other names are ignored', () => {
  const rows = [...automaticRows(), row('ff', '2026-09-05', 90, undefined, 'otro.es')];
  const certs = parseEntries(rows, 'ejemplo.es');
  assert.equal(certs.length, 6);
});

test('every 60 days is automatic and healthy', () => {
  const certs = parseEntries(automaticRows('2026-09-01'), 'ejemplo.es');
  const h = analyzeHistory({ serial: '0A5', validFrom: new Date('2026-09-01T00:00:00Z'), issuer: "Let's Encrypt" }, certs, NOW);
  assert.equal(h.mode, 'automatic');
  assert.equal(h.intervalDays, 60);
  assert.equal(h.newer, null);
  assert.equal(h.stalled, false);
});

test('automatic but overdue with nothing newer: the renewal has stalled', () => {
  const certs = parseEntries(automaticRows('2026-07-20'), 'ejemplo.es');
  const h = analyzeHistory({ serial: '0A5', validFrom: new Date('2026-07-20T00:00:00Z'), issuer: "Let's Encrypt" }, certs, NOW);
  assert.equal(h.mode, 'automatic');
  assert.equal(h.stalled, true);
});

test('a newer certificate from the same issuer that is not served: renewed but not installed', () => {
  const rows = automaticRows('2026-08-01');
  rows.push(row('0b9', '2026-10-01', 90));
  const certs = parseEntries(rows, 'ejemplo.es');
  const h = analyzeHistory({ serial: '0A5', validFrom: new Date('2026-08-01T00:00:00Z'), issuer: "Let's Encrypt" }, certs, NOW);
  assert.ok(h.newer);
  assert.equal(h.newer.serial, 'b9');
  assert.equal(h.stalled, false);
});

test('a newer certificate issued yesterday is given time to be deployed', () => {
  const rows = automaticRows('2026-08-15');
  rows.push(row('0b9', '2026-10-11', 90));
  const certs = parseEntries(rows, 'ejemplo.es');
  const h = analyzeHistory({ serial: '0A5', validFrom: new Date('2026-08-15T00:00:00Z'), issuer: "Let's Encrypt" }, certs, NOW);
  assert.equal(h.newer, null);
});

test('a CDN backup certificate from another authority is not a missed install', () => {
  const rows = automaticRows('2026-09-01');
  rows.push(row('0c1', '2026-09-20', 90, 'C=US, O=Google Trust Services, CN=WE1'));
  const certs = parseEntries(rows, 'ejemplo.es');
  const h = analyzeHistory({ serial: '0A5', validFrom: new Date('2026-09-01T00:00:00Z'), issuer: "Let's Encrypt" }, certs, NOW);
  assert.equal(h.newer, null);
});

test('once a year is manual', () => {
  const issuer = 'C=GR, O=Hellenic Academic and Research Institutions CA, CN=GEANT TLS RSA 1';
  const rows = [row('1', '2023-11-02', 365, issuer), row('2', '2024-11-01', 365, issuer), row('3', '2025-11-01', 365, issuer)];
  const certs = parseEntries(rows, 'ejemplo.es');
  const h = analyzeHistory({ serial: '3', validFrom: new Date('2025-11-01T00:00:00Z'), issuer: 'Hellenic Academic and Research Institutions CA' }, certs, NOW);
  assert.equal(h.mode, 'manual');
  assert.equal(h.intervalDays, 365);
  assert.equal(h.stalled, false);
});

test('a single certificate is too little history', () => {
  const certs = parseEntries([row('1', '2026-09-01', 90)], 'ejemplo.es');
  const h = analyzeHistory({ serial: '1', validFrom: new Date('2026-09-01T00:00:00Z'), issuer: "Let's Encrypt" }, certs, NOW);
  assert.equal(h.mode, 'unknown');
  assert.equal(h.renewalsSeen, 1);
});

test('certificates issued together count as one renewal', () => {
  const rows = automaticRows('2026-09-01');
  rows.push(row('0d1', '2026-09-02', 90));
  const certs = parseEntries(rows, 'ejemplo.es');
  const h = analyzeHistory({ serial: '0A5', validFrom: new Date('2026-09-01T00:00:00Z'), issuer: "Let's Encrypt" }, certs, NOW);
  assert.equal(h.renewalsSeen, 6);
  assert.equal(h.newer, null);
});

function served(validFrom, durationDays, serial) {
  const from = new Date(`${validFrom}T00:00:00Z`);
  const to = new Date(from.getTime() + durationDays * DAY);
  return {
    host: 'ejemplo.es', connected: true, issuer: "Let's Encrypt", validFrom: from, validTo: to,
    daysLeft: Math.floor((to - NOW) / DAY), durationDays, names: ['ejemplo.es', 'www.ejemplo.es'],
    nameMatches: true, selfSigned: false, validationError: null, fingerprint: 'AA', serial,
  };
}

const fakeFetch = (rows, status = 200) => async () => ({ status, ok: status === 200, json: async () => rows });

test('the stalled renewal turns amber and says how to find the error', async () => {
  const result = served('2026-07-20', 90, '0A5');
  await historiesFor([result], { now: NOW, fetchImpl: fakeFetch(automaticRows('2026-07-20')) });
  const verdict = judge(result, { now: NOW });
  assert.equal(verdict.status, 'warn');
  const text = renderReport([{ result, verdict }], 'es', { now: NOW, columns: 300 });
  assert.match(text, /Renovación\s+automática, cada 60 días/);
  assert.match(text, /certbot renew --dry-run/);
});

test('renewed but not installed tells you to reload the server', async () => {
  const rows = automaticRows('2026-08-01');
  rows.push(row('0b9', '2026-10-01', 90));
  const result = served('2026-08-01', 90, '0A5');
  await historiesFor([result], { now: NOW, fetchImpl: fakeFetch(rows) });
  const verdict = judge(result, { now: NOW });
  assert.equal(verdict.status, 'warn');
  const text = renderReport([{ result, verdict }], 'en', { now: NOW, columns: 300 });
  assert.match(text, /A newer certificate was issued on 1 Oct 2026/);
  assert.match(text, /systemctl reload nginx/);
});

test('a manual rhythm changes the 2027 note from "if" to "looks"', async () => {
  const issuer = 'C=US, O=DigiCert Inc, CN=DigiCert Global G2 TLS RSA SHA256 2020 CA1';
  const rows = [row('1', '2024-04-01', 365, issuer), row('2', '2025-03-30', 199, issuer), row('3', '2026-03-28', 199, issuer)];
  const result = { ...served('2026-03-28', 199, '3'), issuer: 'DigiCert Inc' };
  await historiesFor([result], { now: NOW, fetchImpl: fakeFetch(rows) });
  const verdict = judge(result, { now: NOW });
  const text = renderReport([{ result, verdict }], 'es', { now: NOW, columns: 300 });
  assert.match(text, /Renovación\s+parece a mano/);
  assert.match(text, /Parece que lo renuevas a mano: pasarás a hacerlo al menos 4 veces al año/);
});

test('if crt.sh fails the rest of the report is unchanged and it says so', async () => {
  const result = served('2026-09-01', 90, '0A5');
  await historiesFor([result], { now: NOW, fetchImpl: fakeFetch(null, 502) });
  const verdict = judge(result, { now: NOW });
  assert.equal(verdict.status, 'good');
  const text = renderReport([{ result, verdict }], 'en', { now: NOW, columns: 300 });
  assert.match(text, /Renewal\s+not checked: crt.sh did not answer/);
});

test('when crt.sh starts limiting, the remaining names are not asked', async () => {
  let calls = 0;
  const limited = async () => { calls++; return { status: 429, ok: false, json: async () => null }; };
  const a = served('2026-09-01', 90, '1');
  const b = { ...served('2026-09-01', 90, '2'), host: 'otro.es', names: ['otro.es'] };
  await historiesFor([a, b], { now: NOW, fetchImpl: limited });
  assert.equal(calls, 1);
  assert.equal(b.history.error, 'busy');
});

test('the apex and the www with the same certificate make one lookup', async () => {
  let calls = 0;
  const counting = async () => { calls++; return { status: 200, ok: true, json: async () => automaticRows('2026-09-01') }; };
  const apex = served('2026-09-01', 90, '0A5');
  const www = { ...served('2026-09-01', 90, '0A5'), host: 'www.ejemplo.es' };
  await historiesFor([apex, www], { now: NOW, fetchImpl: counting });
  assert.equal(calls, 1);
  assert.equal(www.history.mode, 'automatic');
});

test('if the served certificate is not in the logs, it does not conclude anything', () => {
  const certs = parseEntries(automaticRows('2026-09-01'), 'ejemplo.es');
  const h = analyzeHistory({ serial: 'DEAD', validFrom: new Date('2026-09-01T00:00:00Z'), issuer: "Let's Encrypt" }, certs, NOW);
  assert.equal(h.mode, 'unknown');
  assert.equal(h.reason, 'notFound');
  assert.equal(h.newer, null);
  assert.equal(h.stalled, false);
});

test('many certificates at once (a CDN or a fleet) is not read as one story', () => {
  const rows = automaticRows('2026-09-01');
  for (const s of ['e1', 'e2', 'e3']) rows.push(row(s, '2026-09-02', 90));
  const certs = parseEntries(rows, 'ejemplo.es');
  const h = analyzeHistory({ serial: '0A5', validFrom: new Date('2026-09-01T00:00:00Z'), issuer: "Let's Encrypt" }, certs, NOW);
  assert.equal(h.reason, 'many');
  assert.equal(h.newer, null);
});

test("Let's Encrypt with long gaps is never called manual: that is what broke the study", () => {
  const rows = [row('1', '2025-01-10', 90), row('2', '2025-07-01', 90), row('3', '2026-01-05', 90), row('4', '2026-08-20', 90)];
  const certs = parseEntries(rows, 'ejemplo.es');
  const h = analyzeHistory({ serial: '4', validFrom: new Date('2026-08-20T00:00:00Z'), issuer: "Let's Encrypt" }, certs, NOW);
  assert.notEqual(h.mode, 'manual');
  assert.equal(h.reason, 'unclear');
});

test('one long gap alone is not enough to say manual', () => {
  const issuer = 'C=US, O=DigiCert Inc, CN=DigiCert Global G2 TLS RSA SHA256 2020 CA1';
  const rows = [row('1', '2025-03-30', 365, issuer), row('2', '2026-03-28', 199, issuer)];
  const certs = parseEntries(rows, 'ejemplo.es');
  const h = analyzeHistory({ serial: '2', validFrom: new Date('2026-03-28T00:00:00Z'), issuer: 'DigiCert Inc' }, certs, NOW);
  assert.equal(h.mode, 'unknown');
});
