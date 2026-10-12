// Checks the renewal-history inference against cases whose answer is known, before trusting it.
// Same rule as the study of 1,000 .es sites: if it fails on what you know for sure, it is not published.
//
// Input: a JSON file with the certificates already measured, so no website is contacted again:
//   [{ "host": "...", "serial": "...", "validFrom": "2026-08-30T21:53:00Z", "issuer": "Let's Encrypt", "names": ["..."] }, ...]
// Only crt.sh, a public log, is asked. One name every 3 seconds.
//
// usage: node scripts/validate-history.mjs measured.json --now 2026-10-09 [--sample 150] [--out detail.csv]
// The detail file has domain names: keep it local, it is in .gitignore.

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fetchHistory, analyzeHistory, identityFor } from '../src/history.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { now: { type: 'string' }, sample: { type: 'string' }, out: { type: 'string' }, seed: { type: 'string' } },
});
if (!positionals[0] || !values.now) {
  console.error('usage: node scripts/validate-history.mjs measured.json --now YYYY-MM-DD [--sample n] [--out file.csv]');
  process.exit(3);
}

const AUTOMATIC_BY_DESIGN = /let's encrypt|google trust services|zerossl|certainly|amazon/i;
const now = new Date(`${values.now}T12:00:00Z`);
const all = JSON.parse(readFileSync(positionals[0], 'utf8')).filter((r) => r.serial && r.validFrom);

// Fixed seed so the sample can be repeated.
let seed = Number(values.seed ?? 20261012);
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const shuffled = [...all].sort(() => random() - 0.5);
const sample = values.sample ? shuffled.slice(0, Number(values.sample)) : shuffled;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
for (const [i, r] of sample.entries()) {
  const identity = identityFor(r.host, r.names ?? []);
  let lookup = await fetchHistory(identity);
  if (lookup.error) {
    await sleep(30_000);
    lookup = await fetchHistory(identity);
  }
  const served = { serial: r.serial, validFrom: new Date(r.validFrom), issuer: r.issuer };
  const h = lookup.error ? { mode: 'error', reason: lookup.error } : analyzeHistory(served, lookup.certificates, now);
  rows.push({ host: r.host, issuer: r.issuer, byDesign: AUTOMATIC_BY_DESIGN.test(r.issuer ?? ''), ...h });
  process.stderr.write(`\r${i + 1}/${sample.length}`);
  await sleep(3_000);
}
process.stderr.write('\n');

const count = (list, f) => list.filter(f).length;
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)} %` : 'n/a');
const known = rows.filter((r) => r.byDesign);
const knownConcluded = known.filter((r) => r.mode === 'automatic' || r.mode === 'manual');
const others = rows.filter((r) => !r.byDesign);

console.log(`Sample: ${rows.length}. crt.sh errors: ${count(rows, (r) => r.mode === 'error')}.`);
console.log('');
console.log(`Issuers that renew automatically by design: ${known.length}`);
console.log(`  automatic: ${count(known, (r) => r.mode === 'automatic')}  manual: ${count(known, (r) => r.mode === 'manual')}  unknown: ${count(known, (r) => r.mode === 'unknown')}  error: ${count(known, (r) => r.mode === 'error')}`);
console.log(`  unknown by reason: notFound ${count(known, (r) => r.reason === 'notFound')}, many ${count(known, (r) => r.reason === 'many')}, short ${count(known, (r) => r.reason === 'short')}, unclear ${count(known, (r) => r.reason === 'unclear')}`);
console.log(`  right when it concludes: ${pct(count(knownConcluded, (r) => r.mode === 'automatic'), knownConcluded.length)}`);
console.log(`  concludes at all: ${pct(knownConcluded.length, known.filter((r) => r.mode !== 'error').length)}`);
console.log(`  alarms: renewed-not-installed ${count(known, (r) => r.newer)}, stalled ${count(known, (r) => r.stalled)}`);
console.log('');
console.log(`Other issuers: ${others.length}`);
console.log(`  automatic: ${count(others, (r) => r.mode === 'automatic')}  manual: ${count(others, (r) => r.mode === 'manual')}  unknown: ${count(others, (r) => r.mode === 'unknown')}`);
console.log(`  alarms: renewed-not-installed ${count(others, (r) => r.newer)}, stalled ${count(others, (r) => r.stalled)}`);
console.log('');
console.log('Pass criteria, fixed before running:');
console.log(`  1. no "manual" among automatic-by-design issuers: ${count(known, (r) => r.mode === 'manual') === 0 ? 'PASS' : 'FAIL'}`);
const right = knownConcluded.length ? count(knownConcluded, (r) => r.mode === 'automatic') / knownConcluded.length : 0;
console.log(`  2. at least 95 % "automatic" when it concludes on them: ${right >= 0.95 ? 'PASS' : 'FAIL'}`);
const reach = known.length ? knownConcluded.length / known.filter((r) => r.mode !== 'error').length : 0;
console.log(`  3. concludes on at least half of them (otherwise it is honest but useless): ${reach >= 0.5 ? 'PASS' : 'FAIL'}`);
console.log('  4. every alarm checked by hand in crt.sh; more than 2 % false alarms means the alarms are not published.');
console.log('  5. 10 "manual" cases from other issuers checked by hand in crt.sh for plausibility.');

if (values.out) {
  const header = 'host,issuer,byDesign,mode,reason,intervalDays,renewalsSeen,newer,stalled';
  const lines = rows.map((r) => [r.host, `"${r.issuer ?? ''}"`, r.byDesign, r.mode, r.reason ?? '', r.intervalDays ?? '', r.renewalsSeen ?? '', r.newer ? r.newer.notBefore.toISOString().slice(0, 10) : '', r.stalled ?? ''].join(','));
  writeFileSync(values.out, `${header}\n${lines.join('\n')}\n`);
  console.log(`\nDetail (with names, keep it local): ${values.out}`);
}
