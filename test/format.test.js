import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../src/format.js';
import { judge } from '../src/verdict.js';

const NOW = new Date('2026-10-10T12:00:00Z');

function item(overrides = {}, host = 'ejemplo.es') {
  const result = {
    host, connected: true, issuer: "Let's Encrypt",
    validFrom: new Date('2026-09-10T00:00:00Z'), validTo: new Date('2026-12-09T00:00:00Z'),
    daysLeft: 60, durationDays: 90, names: [host], nameMatches: true, selfSigned: false,
    validationError: null, fingerprint: 'AA', ...overrides,
  };
  return { result, verdict: judge(result, { now: NOW }) };
}

const ANSI = /\u001b\[/;

test('without colour there are no escape codes and the status is a word', () => {
  const text = renderReport([item()], 'es', { useColor: false, now: NOW });
  assert.ok(!ANSI.test(text));
  assert.match(text, /ejemplo\.es\s+BIEN/);
  assert.match(text, /1 en verde, 0 en ámbar, 0 en rojo\./);
});

test('with colour the word is still there', () => {
  const text = renderReport([item()], 'en', { useColor: true, now: NOW });
  assert.ok(ANSI.test(text));
  assert.match(text, /GOOD/);
});

test('the report is aligned: every value starts in the same column', () => {
  const text = renderReport([item({ validationError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })], 'es', { now: NOW, columns: 200 });
  const valueColumns = text.split('\n')
    .map((line) => /^ {2}\S.*?\S {2,}(?=\S)/.exec(line))
    .filter(Boolean)
    .map((match) => match[0].length);
  assert.ok(valueColumns.length >= 5, 'expected several labelled lines');
  assert.equal(new Set(valueColumns).size, 1, `columns differ: ${valueColumns}`);
});

test('www and apex with different certificates add an informative line and keep the status', () => {
  const apex = item({ fingerprint: 'AA' }, 'ejemplo.es');
  const www = item({ fingerprint: 'BB' }, 'www.ejemplo.es');
  const text = renderReport([apex, www], 'en', { now: NOW });
  assert.match(text, /`ejemplo\.es` and `www\.ejemplo\.es` use different certificates\./);
  assert.match(text, /2 green, 0 amber, 0 red\./);
});

test('no informative line when both share the certificate', () => {
  const text = renderReport([item({ fingerprint: 'AA' }, 'ejemplo.es'), item({ fingerprint: 'AA' }, 'www.ejemplo.es')], 'en', { now: NOW });
  assert.ok(!text.includes('different certificates'));
});

test('long names lists are shortened', () => {
  const names = Array.from({ length: 20 }, (_, i) => `n${i}.ejemplo.es`);
  const bad = item({ nameMatches: false, validationError: 'ERR_TLS_CERT_ALTNAME_INVALID', names }, 'otro.ejemplo.es');
  const text = renderReport([bad], 'en', { now: NOW, columns: 300 });
  assert.match(text, /\+12 more/);
});
