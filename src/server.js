// Server mode: run on the machine that serves the site and look from the inside.
// Two things that cannot be seen from outside:
//   1. whether the certificate on disk is the one the site sends (renewed but not reloaded),
//   2. whether automatic renewal is set up (certbot timer, or a cron job for certbot or acme.sh).
// Nothing is sent anywhere: it reads local files and asks systemctl and crontab.

import { X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { posix as path } from 'node:path';

const PEM = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;

function namesOf(x509) {
  const alt = x509.subjectAltName;
  if (!alt) return [];
  return alt.split(', ').filter((n) => n.startsWith('DNS:')).map((n) => n.slice(4).toLowerCase());
}

export function covers(names, host) {
  if (names.includes(host)) return true;
  const parent = host.split('.').slice(1).join('.');
  return Boolean(parent) && names.includes(`*.${parent}`);
}

// The first certificate in a PEM file is the site's own (the leaf); the rest is the chain.
export function readLeaf(text) {
  const match = PEM.exec(text);
  if (!match) return null;
  const x509 = new X509Certificate(match[0]);
  return {
    fingerprint: x509.fingerprint256,
    validFrom: new Date(x509.validFrom),
    validTo: new Date(x509.validTo),
    names: namesOf(x509),
    issuer: issuerOrg(x509.issuer),
  };
}

// The organisation (O=) of the issuer, as the TLS check reports it for the served certificate.
function issuerOrg(text) {
  const lines = String(text ?? '').split('\n');
  const o = lines.find((l) => l.startsWith('O='));
  const cn = lines.find((l) => l.startsWith('CN='));
  return o ? o.slice(2) : cn ? cn.slice(3) : null;
}

// Where certbot and acme.sh keep certificates. Each folder may hold one certificate for several names.
export function certDirs(home = os.homedir()) {
  return [
    { base: '/etc/letsencrypt/live', file: 'fullchain.pem', tool: 'certbot' },
    { base: path.join(home, '.acme.sh'), file: 'fullchain.cer', tool: 'acme.sh' },
    { base: '/root/.acme.sh', file: 'fullchain.cer', tool: 'acme.sh' },
  ];
}

/**
 * Finds the certificate on disk that covers host.
 * Returns { found: true, path, tool, leaf } | { found: false, denied: bool }.
 */
export async function findDiskCert(host, { dirs = certDirs(), fsImpl = fs } = {}) {
  let denied = false;
  const candidates = [];
  for (const { base, file, tool } of dirs) {
    let entries;
    try {
      entries = await fsImpl.readdir(base);
    } catch (error) {
      if (error.code === 'EACCES' || error.code === 'EPERM') denied = true;
      continue;
    }
    for (const entry of entries) {
      const full = path.join(base, entry, file);
      try {
        const leaf = readLeaf(await fsImpl.readFile(full, 'utf8'));
        if (leaf && covers(leaf.names, host)) candidates.push({ path: full, tool, leaf });
      } catch (error) {
        if (error.code === 'EACCES' || error.code === 'EPERM') denied = true;
      }
    }
  }
  if (candidates.length === 0) return { found: false, denied };
  // Old certificates can stay in other folders: the newest one is the one that matters.
  candidates.sort((a, b) => b.leaf.validFrom - a.leaf.validFrom);
  return { found: true, ...candidates[0] };
}

export async function readCertFile(file, { fsImpl = fs } = {}) {
  try {
    const leaf = readLeaf(await fsImpl.readFile(file, 'utf8'));
    return leaf ? { found: true, path: file, tool: null, leaf } : { found: false, invalid: true };
  } catch (error) {
    return { found: false, denied: error.code === 'EACCES' || error.code === 'EPERM', missing: error.code === 'ENOENT' };
  }
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (error, stdout) => resolve({ ok: !error, stdout: String(stdout ?? '') }));
  });
}

const CRON_FILES = ['/etc/crontab', '/var/spool/cron/crontabs/root', '/var/spool/cron/root'];

/**
 * Looks for automatic renewal: certbot's systemd timer (apt or snap) or a cron job that runs certbot or acme.sh.
 * Returns { checked: true, method } with method null when nothing was found, or { checked: false } off Linux.
 */
export async function findAutoRenewal({ platform = process.platform, runImpl = run, fsImpl = fs } = {}) {
  if (platform !== 'linux') return { checked: false };
  for (const timer of ['certbot.timer', 'snap.certbot.renew.timer']) {
    const r = await runImpl('systemctl', ['is-enabled', timer]);
    if (r.ok && r.stdout.trim() === 'enabled') return { checked: true, method: timer };
  }
  const texts = [];
  try {
    for (const f of await fsImpl.readdir('/etc/cron.d')) {
      try { texts.push(await fsImpl.readFile(path.join('/etc/cron.d', f), 'utf8')); } catch { /* unreadable file */ }
    }
  } catch { /* no cron.d */ }
  for (const f of CRON_FILES) {
    try { texts.push(await fsImpl.readFile(f, 'utf8')); } catch { /* missing or not allowed */ }
  }
  const mine = await runImpl('crontab', ['-l']);
  if (mine.ok) texts.push(mine.stdout);
  // Only lines that are not commented out count.
  const lines = texts.join('\n').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.some((l) => /acme\.sh\b.*--cron/.test(l))) return { checked: true, method: 'acme.sh (cron)' };
  if (lines.some((l) => /\bcertbot\b.*\brenew\b|\bcertbot\b\s*-q\s*renew/.test(l))) return { checked: true, method: 'certbot (cron)' };
  return { checked: true, method: null };
}

/**
 * Puts together what server mode found for one host.
 * served: the result of the TLS check (with fingerprint). disk: from findDiskCert or readCertFile.
 * auto: from findAutoRenewal, or null when it was not looked at.
 */
export function serverFindings(served, disk, auto) {
  const out = { disk, auto };
  if (!disk.found) return { ...out, match: null };
  if (!served.connected || !served.fingerprint) return { ...out, match: null };
  const match = disk.leaf.fingerprint === served.fingerprint;
  if (match) return { ...out, match };
  // A different authority means another system answers in front (a CDN such as Cloudflare, or a proxy):
  // the two certificates are not two versions of the same one, so their dates say nothing about renewal.
  if (served.issuer && disk.leaf.issuer && served.issuer !== disk.leaf.issuer) return { ...out, match, inFront: true };
  return { ...out, match, diskNewer: disk.leaf.validFrom > served.validFrom };
}
