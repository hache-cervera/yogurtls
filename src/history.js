// Renewal history from Certificate Transparency logs.
// Every publicly trusted certificate is logged; crt.sh lets anyone read those logs.
// From the dates of past certificates we can tell how a name is renewed,
// which a single TLS connection cannot.

const DAY_MS = 86_400_000;
const CRT_SH = 'https://crt.sh/';

// Certificates issued within this many days of each other are one renewal
// (CDNs and some hosts issue several at once).
const SAME_RENEWAL_DAYS = 3;
// A new certificate can take a little while to be deployed after it is logged.
const DEPLOY_GRACE_DAYS = 3;
// Renewal intervals up to this look like ACME automation (certificates of 90 days or less).
const AUTOMATIC_MAX_INTERVAL = 100;
// How many recent renewals are used to work out the rhythm.
const RECENT_RENEWALS = 6;

export function normalizeSerial(serial) {
  if (!serial) return null;
  return String(serial).toLowerCase().replace(/[^0-9a-f]/g, '').replace(/^0+/, '') || '0';
}

// The name to look up: the one in the served certificate that covers the host.
// A wildcard certificate is logged under the wildcard, not under each subdomain.
export function identityFor(host, names = []) {
  const lower = names.map((n) => n.toLowerCase());
  if (lower.includes(host)) return host;
  const parent = host.split('.').slice(1).join('.');
  const wildcard = `*.${parent}`;
  if (parent && lower.includes(wildcard)) return wildcard;
  return host;
}

// crt.sh lists a precertificate and the final certificate with the same serial: keep one.
export function parseEntries(entries, identity) {
  const bySerial = new Map();
  for (const entry of entries) {
    const names = String(entry.name_value ?? '').toLowerCase().split('\n').map((n) => n.trim());
    if (!names.includes(identity) && String(entry.common_name ?? '').toLowerCase() !== identity) continue;
    const serial = normalizeSerial(entry.serial_number);
    if (!serial || bySerial.has(serial)) continue;
    const notBefore = new Date(`${entry.not_before}Z`);
    const notAfter = new Date(`${entry.not_after}Z`);
    if (Number.isNaN(notBefore.getTime())) continue;
    bySerial.set(serial, { serial, notBefore, notAfter, issuer: issuerOrg(entry.issuer_name) });
  }
  return [...bySerial.values()].sort((a, b) => a.notBefore - b.notBefore);
}

function issuerOrg(issuerName) {
  const match = /(?:^|,\s*)O="?([^",]+)"?/.exec(String(issuerName ?? ''));
  return match ? match[1].trim() : null;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Groups certificates issued together into renewals, oldest first.
function renewals(certificates) {
  const groups = [];
  for (const certificate of certificates) {
    const last = groups[groups.length - 1];
    if (last && (certificate.notBefore - last.at) / DAY_MS <= SAME_RENEWAL_DAYS) continue;
    groups.push({ at: certificate.notBefore });
  }
  return groups;
}

/**
 * served: { serial, validFrom, issuer } of the certificate the server sends.
 * certificates: parsed history (see parseEntries).
 * Returns { mode, intervalDays, renewalsSeen, newer, stalled } where
 *   mode is 'automatic' | 'manual' | 'unknown',
 *   newer is a logged certificate newer than the served one, from the same issuer, or null,
 *   stalled is true when an automatic renewal is overdue and nothing newer is logged.
 */
export function analyzeHistory(served, certificates, now = new Date()) {
  const servedSerial = normalizeSerial(served.serial);
  const history = certificates.filter((c) => c.notBefore <= now);
  const groups = renewals(history);
  const recent = groups.slice(-RECENT_RENEWALS - 1);
  const intervals = [];
  for (let i = 1; i < recent.length; i++) intervals.push(Math.round((recent[i].at - recent[i - 1].at) / DAY_MS));

  let mode = 'unknown';
  let intervalDays = null;
  if (intervals.length >= 2 || (intervals.length === 1 && intervals[0] > AUTOMATIC_MAX_INTERVAL)) {
    intervalDays = median(intervals);
    mode = intervalDays <= AUTOMATIC_MAX_INTERVAL ? 'automatic' : 'manual';
  }

  // Only the same issuer counts: CDNs keep backup certificates from another authority that they never serve.
  const servedFrom = served.validFrom;
  const newerCandidates = history.filter((c) => c.serial !== servedSerial
    && c.notBefore - servedFrom > SAME_RENEWAL_DAYS * DAY_MS
    && (now - c.notBefore) / DAY_MS >= DEPLOY_GRACE_DAYS
    && c.notAfter > now
    && (!served.issuer || !c.issuer || c.issuer === served.issuer));
  const newer = newerCandidates.length ? newerCandidates[newerCandidates.length - 1] : null;

  const ageDays = Math.floor((now - servedFrom) / DAY_MS);
  const slack = intervalDays === null ? 0 : Math.max(7, Math.round(intervalDays * 0.15));
  const stalled = mode === 'automatic' && !newer && ageDays > intervalDays + slack;

  return { mode, intervalDays, renewalsSeen: groups.length, newer, stalled, ageDays };
}

export async function fetchHistory(identity, { timeoutMs = 25_000, fetchImpl = globalThis.fetch } = {}) {
  const url = `${CRT_SH}?q=${encodeURIComponent(identity)}&output=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { 'user-agent': 'yogurtls' } });
    if (response.status === 429) return { error: 'busy' };
    if (!response.ok) return { error: 'unavailable' };
    const entries = await response.json();
    if (!Array.isArray(entries)) return { error: 'unavailable' };
    return { certificates: parseEntries(entries, identity) };
  } catch {
    return { error: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

// One lookup per name, one at a time: crt.sh is a free public service and limits heavy use.
export async function historiesFor(results, options = {}) {
  const cache = new Map();
  const bySerial = new Map();
  let busy = false;
  for (const result of results) {
    if (!result.connected || !result.serial) continue;
    // The apex and the www often share the certificate: one lookup is enough.
    const same = bySerial.get(normalizeSerial(result.serial));
    if (same) {
      result.history = same;
      continue;
    }
    const identity = identityFor(result.host, result.names);
    if (!cache.has(identity)) {
      cache.set(identity, busy ? { error: 'busy' } : await fetchHistory(identity, options));
      if (cache.get(identity).error === 'busy') busy = true;
    }
    const lookup = cache.get(identity);
    result.history = lookup.error
      ? { error: lookup.error }
      : analyzeHistory({ serial: result.serial, validFrom: result.validFrom, issuer: result.issuer }, lookup.certificates, options.now);
    if (!result.history.error) bySerial.set(normalizeSerial(result.serial), result.history);
  }
  return results;
}
