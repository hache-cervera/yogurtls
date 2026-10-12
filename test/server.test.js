import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readLeaf, covers, findDiskCert, readCertFile, findAutoRenewal, serverFindings } from '../src/server.js';
import { judge } from '../src/verdict.js';
import { renderReport } from '../src/format.js';

// Throwaway self-signed certificates for ejemplo.es, made for these tests only.
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const OLD = fixture('disk-old.pem');
const NEW = fixture('disk-new.pem');
const WILD = fixture('disk-wildcard.pem');
const NOW = new Date('2026-09-15T12:00:00Z');

// A fake file system: { '/dir': ['a', 'b'], '/dir/a/fullchain.pem': '...' }, or an error code string.
function fakeFs(tree) {
  const get = (p) => {
    const v = tree[p];
    if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    if (typeof v === 'string' && v.startsWith('ERR:')) throw Object.assign(new Error(v), { code: v.slice(4) });
    return v;
  };
  return { readdir: async (p) => get(p), readFile: async (p) => get(p) };
}
const DIRS = [{ base: '/etc/letsencrypt/live', file: 'fullchain.pem', tool: 'certbot' }];

function served(pem) {
  const leaf = readLeaf(pem);
  return { host: 'ejemplo.es', connected: true, issuer: leaf.issuer, validFrom: leaf.validFrom, validTo: leaf.validTo,
    daysLeft: Math.floor((leaf.validTo - NOW) / 86_400_000), durationDays: 90, names: leaf.names, nameMatches: true,
    selfSigned: false, validationError: null, fingerprint: leaf.fingerprint };
}

test('the first certificate of a PEM file is read with its names and dates', () => {
  const leaf = readLeaf(NEW + OLD);
  assert.deepEqual(leaf.names, ['ejemplo.es', 'www.ejemplo.es']);
  assert.equal(leaf.validFrom.toISOString().slice(0, 10), '2026-09-01');
  assert.equal(readLeaf('not a certificate'), null);
});

test('a wildcard covers a subdomain but not the apex unless listed', () => {
  assert.ok(covers(['*.ejemplo.es'], 'www.ejemplo.es'));
  assert.ok(!covers(['*.ejemplo.es'], 'ejemplo.es'));
  assert.ok(!covers(['*.ejemplo.es'], 'a.b.ejemplo.es'));
});

test('finds the certificate that covers the host, newest first, in any certbot folder', async () => {
  const fs = fakeFs({
    '/etc/letsencrypt/live': ['ejemplo.es', 'ejemplo.es-0001', 'otro.es', 'README'],
    '/etc/letsencrypt/live/ejemplo.es/fullchain.pem': OLD,
    '/etc/letsencrypt/live/ejemplo.es-0001/fullchain.pem': NEW,
    '/etc/letsencrypt/live/otro.es/fullchain.pem': 'ERR:ENOENT',
  });
  const disk = await findDiskCert('www.ejemplo.es', { dirs: DIRS, fsImpl: fs });
  assert.equal(disk.found, true);
  assert.equal(disk.path, '/etc/letsencrypt/live/ejemplo.es-0001/fullchain.pem');
  assert.equal(disk.tool, 'certbot');
});

test('a wildcard certificate on disk is found for a subdomain', async () => {
  const fs = fakeFs({ '/etc/letsencrypt/live': ['w'], '/etc/letsencrypt/live/w/fullchain.pem': WILD });
  assert.equal((await findDiskCert('tienda.ejemplo.es', { dirs: DIRS, fsImpl: fs })).found, true);
});

test('without permission it says so instead of "not found"', async () => {
  const fs = fakeFs({ '/etc/letsencrypt/live': 'ERR:EACCES' });
  assert.deepEqual(await findDiskCert('ejemplo.es', { dirs: DIRS, fsImpl: fs }), { found: false, denied: true });
});

test('--cert reads a given file, and reports a missing one', async () => {
  const ok = await readCertFile('/x.pem', { fsImpl: fakeFs({ '/x.pem': NEW }) });
  assert.equal(ok.found, true);
  const missing = await readCertFile('/y.pem', { fsImpl: fakeFs({}) });
  assert.equal(missing.missing, true);
});

test('same certificate on disk and on the site: no problem', () => {
  const disk = { found: true, path: '/p', tool: 'certbot', leaf: readLeaf(NEW) };
  const s = serverFindings(served(NEW), disk, { checked: true, method: 'certbot.timer' });
  assert.equal(s.match, true);
  const v = judge({ ...served(NEW), server: s }, { now: NOW });
  assert.equal(v.status, 'good');
  const text = renderReport([{ result: { ...served(NEW), server: s }, verdict: v }], 'es', { now: NOW, columns: 300 });
  assert.match(text, /En el disco\s+\/p \(es el mismo que envía la web\)/);
  assert.match(text, /Renovación\s+configurada \(certbot\.timer\)/);
});

test('newer on disk than on the site: renewed but not reloaded', () => {
  const disk = { found: true, path: '/p', tool: 'certbot', leaf: readLeaf(NEW) };
  const s = serverFindings(served(OLD), disk, { checked: true, method: 'certbot.timer' });
  assert.equal(s.match, false);
  assert.equal(s.diskNewer, true);
  const v = judge({ ...served(OLD), server: s }, { now: NOW });
  assert.equal(v.status, 'warn');
  assert.ok(v.problems.some((p) => p.id === 'renewedNotInstalled'));
  const text = renderReport([{ result: { ...served(OLD), server: s }, verdict: v }], 'en', { now: NOW, columns: 300 });
  assert.match(text, /systemctl reload nginx/);
});

test('older on disk than on the site: another server answers, not a reload', () => {
  const disk = { found: true, path: '/p', tool: 'certbot', leaf: readLeaf(OLD) };
  const s = serverFindings(served(NEW), disk, { checked: true, method: 'certbot.timer' });
  const v = judge({ ...served(NEW), server: s }, { now: NOW });
  assert.ok(v.problems.some((p) => p.id === 'diskDiffers'));
  assert.ok(!v.problems.some((p) => p.id === 'renewedNotInstalled'));
});

test('no automatic renewal found is amber and says how to turn it on', () => {
  const disk = { found: true, path: '/p', tool: 'certbot', leaf: readLeaf(NEW) };
  const s = serverFindings(served(NEW), disk, { checked: true, method: null });
  const v = judge({ ...served(NEW), server: s }, { now: NOW });
  assert.equal(v.status, 'warn');
  const text = renderReport([{ result: { ...served(NEW), server: s }, verdict: v }], 'es', { now: NOW, columns: 300 });
  assert.match(text, /systemctl enable --now certbot\.timer/);
});

test('when the certificate is not on this machine, nothing is concluded about renewal', () => {
  const s = serverFindings(served(NEW), { found: false, denied: false }, null);
  const v = judge({ ...served(NEW), server: s }, { now: NOW });
  assert.equal(v.status, 'good');
  const text = renderReport([{ result: { ...served(NEW), server: s }, verdict: v }], 'es', { now: NOW, columns: 300 });
  assert.match(text, /no está donde lo guardan certbot o acme\.sh/);
  assert.match(text, /sin comprobar: no he encontrado el certificado/);
});

const runOk = (enabled) => async (cmd, args) => {
  if (cmd === 'systemctl') return { ok: enabled.includes(args[1]), stdout: enabled.includes(args[1]) ? 'enabled\n' : 'disabled\n' };
  return { ok: false, stdout: '' };
};

test('certbot timer enabled counts as automatic renewal', async () => {
  const r = await findAutoRenewal({ platform: 'linux', runImpl: runOk(['certbot.timer']), fsImpl: fakeFs({}) });
  assert.deepEqual(r, { checked: true, method: 'certbot.timer' });
  const snap = await findAutoRenewal({ platform: 'linux', runImpl: runOk(['snap.certbot.renew.timer']), fsImpl: fakeFs({}) });
  assert.equal(snap.method, 'snap.certbot.renew.timer');
});

test('a cron line for acme.sh or certbot counts; a commented one does not', async () => {
  const acme = await findAutoRenewal({ platform: 'linux', runImpl: async (c) => (c === 'crontab' ? { ok: true, stdout: '12 0 * * * "/root/.acme.sh"/acme.sh --cron --home "/root/.acme.sh" > /dev/null\n' } : { ok: false, stdout: '' }), fsImpl: fakeFs({}) });
  assert.equal(acme.method, 'acme.sh (cron)');
  const certbot = await findAutoRenewal({ platform: 'linux', runImpl: runOk([]), fsImpl: fakeFs({ '/etc/cron.d': ['certbot'], '/etc/cron.d/certbot': '0 */12 * * * root test -x /usr/bin/certbot && certbot -q renew\n' }) });
  assert.equal(certbot.method, 'certbot (cron)');
  const commented = await findAutoRenewal({ platform: 'linux', runImpl: runOk([]), fsImpl: fakeFs({ '/etc/crontab': '# 0 3 * * * certbot renew\n' }) });
  assert.equal(commented.method, null);
});

test('off Linux it does not look', async () => {
  assert.deepEqual(await findAutoRenewal({ platform: 'win32' }), { checked: false });
});

test('behind a CDN (another authority in front), a newer certificate on disk is not "renewed but not reloaded"', () => {
  // The case found on a real server: Cloudflare sends its own certificate, the origin keeps a Let's Encrypt one.
  const disk = { found: true, path: '/p', tool: null, leaf: readLeaf(NEW) };
  const site = { ...served(OLD), issuer: 'Google Trust Services' };
  const s = serverFindings(site, disk, null);
  assert.equal(s.inFront, true);
  const v = judge({ ...site, server: s }, { now: NOW });
  assert.ok(!v.problems.some((p) => p.id === 'renewedNotInstalled' || p.id === 'diskDiffers'));
  assert.equal(v.status, 'good');
  const text = renderReport([{ result: { ...site, server: s }, verdict: v }], 'es', { now: NOW, columns: 300 });
  assert.match(text, /delante responde otro sistema, como un CDN tipo Cloudflare/);
  assert.ok(!/systemctl reload/.test(text));
});

test('without permission it also points to --cert, since the certificates may live elsewhere', () => {
  const s = serverFindings(served(NEW), { found: false, denied: true }, null);
  const text = renderReport([{ result: { ...served(NEW), server: s }, verdict: judge({ ...served(NEW), server: s }, { now: NOW }) }], 'es', { now: NOW, columns: 300 });
  assert.match(text, /ejecútalo con sudo\. Si tus certificados están en otro sitio \(Docker, un panel\), usa --cert/);
});
