// Maximum validity of publicly trusted TLS certificates.
// Source: CA/Browser Forum Baseline Requirements, section 6.3.2 (v2.3.1),
// https://github.com/cabforum/servercert/blob/main/docs/BR.md
// The limit applies by issue date, not by expiry date.
export const VALIDITY_SCHEDULE = [
  { from: '2026-03-15', maxDays: 200 },
  { from: '2027-03-15', maxDays: 100 },
  { from: '2029-03-15', maxDays: 47 },
];

const RED_PROBLEMS = new Set(['noHttps', 'expired', 'name', 'selfSigned', 'untrusted']);

// An OpenSSL error code only counts as explained when the matching problem was detected.
const ERROR_TO_PROBLEM = {
  CERT_HAS_EXPIRED: 'expired',
  ERR_TLS_CERT_ALTNAME_INVALID: 'name',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'selfSigned',
  SELF_SIGNED_CERT_IN_CHAIN: 'untrusted',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'untrusted',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'incompleteChain',
};

function calendarNotes(durationDays, now) {
  const upcoming = VALIDITY_SCHEDULE.filter((step) => new Date(step.from) > now);
  if (upcoming.length === 0) return [];
  const next = upcoming[0];
  if (durationDays > next.maxDays) return [{ id: next.maxDays === 100 ? 'over100' : 'over47' }];
  const notes = [{ id: next.maxDays === 100 ? 'ok100' : 'ok47' }];
  if (next.maxDays === 100 && durationDays <= 47) notes.push({ id: 'ok47' });
  return notes;
}

export function judge(result, { warnDays = 14, now = new Date() } = {}) {
  if (!result.connected) {
    return { status: 'fail', problems: [{ id: 'noHttps', params: { host: result.host } }], notes: [], unhandled: null };
  }

  const problems = [];
  const expired = result.daysLeft < 0 || result.validTo < now;
  if (expired) problems.push({ id: 'expired', params: { validTo: result.validTo } });
  if (!result.nameMatches) problems.push({ id: 'name', params: { host: result.host, names: result.names } });
  if (result.selfSigned) problems.push({ id: 'selfSigned', params: {} });
  const code = result.validationError;
  if (ERROR_TO_PROBLEM[code] === 'untrusted' && !result.selfSigned) problems.push({ id: 'untrusted', params: {} });
  const incompleteChain = code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
  if (incompleteChain) problems.push({ id: 'incompleteChain', params: {} });
  if (!expired && result.daysLeft < warnDays) problems.push({ id: 'expiringSoon', params: { days: result.daysLeft } });

  const found = new Set(problems.map((p) => p.id));
  const explained = code === null || (ERROR_TO_PROBLEM[code] !== undefined && found.has(ERROR_TO_PROBLEM[code]));
  const unhandled = explained ? null : code;

  const hasRed = problems.some((p) => RED_PROBLEMS.has(p.id));
  const status = hasRed ? 'fail' : problems.length > 0 ? 'warn' : 'good';
  const notes = expired ? [] : calendarNotes(result.durationDays, now);
  return { status, problems, notes, unhandled, chainComplete: chainStatus(result, incompleteChain) };
}

// With a self-signed certificate or an unknown authority there is nothing to say about the chain.
function chainStatus(result, incompleteChain) {
  if (incompleteChain) return false;
  if (result.selfSigned) return null;
  if (ERROR_TO_PROBLEM[result.validationError] === 'untrusted') return null;
  return true;
}
