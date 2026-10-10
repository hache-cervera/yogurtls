import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, VALIDITY_SCHEDULE } from '../src/verdict.js';

const NOW = new Date('2026-10-10T12:00:00Z');

function connected(overrides = {}) {
  return {
    host: 'example.es',
    connected: true,
    issuer: 'Test CA',
    validFrom: new Date('2026-08-01T00:00:00Z'),
    validTo: new Date('2026-12-10T00:00:00Z'),
    daysLeft: 60,
    durationDays: 90,
    names: ['example.es'],
    nameMatches: true,
    selfSigned: false,
    validationError: null,
    fingerprint: 'AA',
    ...overrides,
  };
}

const ids = (verdict) => verdict.problems.map((p) => p.id);

test('a valid certificate is green', () => {
  const v = judge(connected(), { now: NOW });
  assert.equal(v.status, 'good');
  assert.deepEqual(ids(v), []);
  assert.equal(v.chainComplete, true);
});

test('expiring in fewer days than --warn-days is amber, and exactly at the limit is green', () => {
  assert.equal(judge(connected({ daysLeft: 5 }), { warnDays: 14, now: NOW }).status, 'warn');
  assert.deepEqual(ids(judge(connected({ daysLeft: 5 }), { warnDays: 14, now: NOW })), ['expiringSoon']);
  assert.equal(judge(connected({ daysLeft: 14 }), { warnDays: 14, now: NOW }).status, 'good');
  assert.equal(judge(connected({ daysLeft: 5 }), { warnDays: 3, now: NOW }).status, 'good');
});

test('an expired certificate is red and gets no 2027 notes', () => {
  const v = judge(connected({
    daysLeft: -30, validTo: new Date('2026-09-10T00:00:00Z'), validationError: 'CERT_HAS_EXPIRED',
  }), { now: NOW });
  assert.equal(v.status, 'fail');
  assert.deepEqual(ids(v), ['expired']);
  assert.deepEqual(v.notes, []);
  assert.equal(v.unhandled, null);
});

test('a name mismatch is red', () => {
  const v = judge(connected({ nameMatches: false, validationError: 'ERR_TLS_CERT_ALTNAME_INVALID' }), { now: NOW });
  assert.equal(v.status, 'fail');
  assert.deepEqual(ids(v), ['name']);
});

test('a self-signed certificate is red and its chain is not judged', () => {
  const v = judge(connected({ selfSigned: true, validationError: 'DEPTH_ZERO_SELF_SIGNED_CERT' }), { now: NOW });
  assert.equal(v.status, 'fail');
  assert.deepEqual(ids(v), ['selfSigned']);
  assert.equal(v.chainComplete, null);
});

test('an unknown authority is red', () => {
  for (const code of ['SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']) {
    const v = judge(connected({ validationError: code }), { now: NOW });
    assert.equal(v.status, 'fail');
    assert.deepEqual(ids(v), ['untrusted']);
  }
});

test('an incomplete chain is amber', () => {
  const v = judge(connected({ validationError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }), { now: NOW });
  assert.equal(v.status, 'warn');
  assert.deepEqual(ids(v), ['incompleteChain']);
  assert.equal(v.chainComplete, false);
});

test('an incomplete chain with a wrong name reports both and is red', () => {
  const v = judge(connected({ nameMatches: false, validationError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }), { now: NOW });
  assert.equal(v.status, 'fail');
  assert.deepEqual(ids(v).sort(), ['incompleteChain', 'name']);
});

test('no answer over HTTPS is red', () => {
  const v = judge({ host: 'x.es', connected: false, failure: 'ECONNREFUSED' }, { now: NOW });
  assert.equal(v.status, 'fail');
  assert.deepEqual(ids(v), ['noHttps']);
});

test('an error code that no problem explains is reported as unhandled, not guessed', () => {
  const v = judge(connected({ validationError: 'CERT_NOT_YET_VALID' }), { now: NOW });
  assert.equal(v.unhandled, 'CERT_NOT_YET_VALID');
});

test('before March 2027: over 100 days warns about the change, at or under 100 is fine', () => {
  assert.deepEqual(judge(connected({ durationDays: 150 }), { now: NOW }).notes.map((n) => n.id), ['over100']);
  assert.deepEqual(judge(connected({ durationDays: 90 }), { now: NOW }).notes.map((n) => n.id), ['ok100']);
  assert.deepEqual(judge(connected({ durationDays: 100 }), { now: NOW }).notes.map((n) => n.id), ['ok100']);
});

test('before March 2027: 47 days or less also meets the 2029 limit', () => {
  assert.deepEqual(judge(connected({ durationDays: 30 }), { now: NOW }).notes.map((n) => n.id), ['ok100', 'ok47']);
});

test('after 15 March 2027 the next limit is 47 days', () => {
  const later = new Date('2027-04-01T00:00:00Z');
  const valid = { validTo: new Date('2027-06-01T00:00:00Z'), daysLeft: 61 };
  assert.deepEqual(judge(connected({ ...valid, durationDays: 90 }), { now: later }).notes.map((n) => n.id), ['over47']);
  assert.deepEqual(judge(connected({ ...valid, durationDays: 45 }), { now: later }).notes.map((n) => n.id), ['ok47']);
});

test('after 15 March 2029 there is nothing left to announce', () => {
  const valid = { validTo: new Date('2029-06-01T00:00:00Z'), daysLeft: 61 };
  assert.deepEqual(judge(connected({ ...valid, durationDays: 40 }), { now: new Date('2029-04-01T00:00:00Z') }).notes, []);
});

test('the calendar constant matches the Baseline Requirements steps', () => {
  assert.deepEqual(VALIDITY_SCHEDULE.map((s) => [s.from, s.maxDays]), [
    ['2026-03-15', 200], ['2027-03-15', 100], ['2029-03-15', 47],
  ]);
});
