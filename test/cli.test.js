import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = new URL('../bin/yogurtls.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// English unless the test asks for Spanish, whatever the language of the machine running the tests.
function run(...args) {
  const lang = args.includes('--es') ? [] : ['--en'];
  return spawnSync(process.execPath, [BIN, ...lang, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
}

test('without arguments it is a usage error', () => {
  const r = run();
  assert.equal(r.status, 3);
  assert.match(r.stderr, /no domains given/);
});

test('--es changes the language of errors too', () => {
  const r = run('--es');
  assert.equal(r.status, 3);
  assert.match(r.stderr, /no has indicado ningún dominio/);
});

test('--help prints the usage and exits 0', () => {
  const r = run('--help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Exit codes: 0 all green/);
});

test('--version prints the package version', () => {
  const r = run('--version');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^\d+\.\d+\.\d+\n$/);
});

test('an invalid domain, a port and a bad --warn-days are usage errors', () => {
  assert.equal(run('no es un dominio').status, 3);
  assert.equal(run('ejemplo.es:8443').status, 3);
  const r = run('ejemplo.es', '--warn-days', 'abc');
  assert.equal(r.status, 3);
  assert.match(r.stderr, /--warn-days needs a whole number/);
});

test('an unreadable --file is a usage error', () => {
  const r = run('--file', join(tmpdir(), 'yogurtls-no-existe.txt'));
  assert.equal(r.status, 3);
  assert.match(r.stderr, /cannot read the file/);
});

test('a --file with only blank lines and comments gives no domains', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'yogurtls-')), 'dominios.txt');
  writeFileSync(file, '# solo comentarios\n\n   \n# otro\n');
  const r = run('--file', file);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /no domains given/);
});

test('localhost has nothing on 443: red, exit code 2, plain words', () => {
  const r = run('localhost');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /localhost\s+FAIL/);
  assert.match(r.stdout, /localhost doesn't answer over HTTPS\./);
  assert.match(r.stdout, /0 green, 0 amber, 1 red\./);
  assert.ok(!/\u001b\[/.test(r.stdout));
});

test('--en is accepted alongside a domain', () => {
  const r = run('localhost');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /localhost\s+FAIL/);
});
