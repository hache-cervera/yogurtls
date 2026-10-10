import net from 'node:net';
import tls from 'node:tls';

const DAY_MS = 86_400_000;

// Two-label suffixes where "company.com.es" is still the root domain.
// Not the public suffix list: it covers the common cases without a dependency.
const TWO_LABEL_SUFFIXES = new Set([
  'com.es', 'org.es', 'gob.es', 'edu.es', 'nom.es',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com.mx', 'com.ar', 'com.br', 'com.au', 'co.nz', 'co.jp',
]);

export function normalizeHost(raw) {
  const text = String(raw).trim();
  if (!text) return { error: 'invalid' };
  let url;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    return { error: 'invalid' };
  }
  if (url.port && url.port !== '443') return { error: 'port' };
  const host = url.hostname.replace(/\.$/, '').toLowerCase();
  const looksLikeName = host === 'localhost' || net.isIP(host) !== 0 || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host);
  if (!looksLikeName) return { error: 'invalid' };
  return { host };
}

function isApex(host) {
  const labels = host.split('.');
  if (labels.length === 2) return true;
  return labels.length === 3 && TWO_LABEL_SUFFIXES.has(labels.slice(1).join('.'));
}

// Asking for example.es or www.example.es checks both; any other subdomain is checked alone.
export function expandTargets(hosts) {
  const targets = [];
  const seen = new Set();
  const add = (host, asked) => {
    if (seen.has(host)) return;
    seen.add(host);
    targets.push({ host, asked });
  };
  for (const host of hosts) add(host, true);
  for (const host of hosts) {
    if (net.isIP(host) !== 0 || host === 'localhost') continue;
    if (host.startsWith('www.')) add(host.slice(4), false);
    else if (isApex(host)) add(`www.${host}`, false);
  }
  return targets;
}

function namesOf(certificate) {
  const alt = certificate.subjectaltname;
  if (alt) return alt.split(', ').filter((n) => n.startsWith('DNS:')).map((n) => n.slice(4));
  return certificate.subject?.CN ? [certificate.subject.CN] : [];
}

function isSelfIssued(certificate, authorizationError) {
  if (authorizationError === 'DEPTH_ZERO_SELF_SIGNED_CERT') return true;
  return JSON.stringify(certificate.subject) === JSON.stringify(certificate.issuer);
}

function readCertificate(host, socket, now) {
  const certificate = socket.getPeerCertificate();
  const validFrom = new Date(certificate.valid_from);
  const validTo = new Date(certificate.valid_to);
  const validationError = socket.authorizationError ? String(socket.authorizationError) : null;
  return {
    host,
    connected: true,
    issuer: certificate.issuer?.O ?? certificate.issuer?.CN ?? null,
    validFrom,
    validTo,
    daysLeft: Math.floor((validTo - now) / DAY_MS),
    durationDays: Math.round((validTo - validFrom) / DAY_MS),
    names: namesOf(certificate),
    // OpenSSL reports a single error and puts the chain before the name, so the name is checked separately.
    nameMatches: tls.checkServerIdentity(host, certificate) === undefined,
    selfSigned: isSelfIssued(certificate, validationError),
    validationError,
    fingerprint: certificate.fingerprint256 ?? null,
  };
}

export function checkHost(host, { port = 443, timeoutMs = 10_000, now = new Date() } = {}) {
  return new Promise((resolve) => {
    // The certificate is read even when invalid: why it fails is what the tool has to explain.
    const options = { host, port, rejectUnauthorized: false, timeout: timeoutMs };
    if (net.isIP(host) === 0) options.servername = host;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const socket = tls.connect(options, () => finish(readCertificate(host, socket, now)));
    socket.on('timeout', () => finish({ host, connected: false, failure: 'timeout' }));
    socket.on('error', (error) => finish({ host, connected: false, failure: error.code ?? error.message }));
  });
}

export async function checkAll(targets, options = {}, concurrency = 8) {
  const results = new Array(targets.length);
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const index = next++;
      results[index] = { ...(await checkHost(targets[index].host, options)), asked: targets[index].asked };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return results;
}
