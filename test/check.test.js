import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
import { checkHost, expandTargets, normalizeHost } from '../src/check.js';
import { judge } from '../src/verdict.js';

// Throwaway self-signed certificate for other.example.test. It has no value outside these tests.
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

test('normalizeHost accepts names and URLs, and rejects ports and nonsense', () => {
  assert.deepEqual(normalizeHost('Ejemplo.ES'), { host: 'ejemplo.es' });
  assert.deepEqual(normalizeHost('https://www.ejemplo.es/ruta?x=1'), { host: 'www.ejemplo.es' });
  assert.deepEqual(normalizeHost('ejemplo.es.'), { host: 'ejemplo.es' });
  assert.deepEqual(normalizeHost('bücher.es'), { host: 'xn--bcher-kva.es' });
  assert.equal(normalizeHost('ejemplo.es:8443').error, 'port');
  assert.equal(normalizeHost('no es un dominio').error, 'invalid');
  assert.equal(normalizeHost('').error, 'invalid');
  assert.equal(normalizeHost('sinpunto').error, 'invalid');
});

test('an apex domain also checks its www, and the other way round', () => {
  assert.deepEqual(expandTargets(['ejemplo.es']).map((t) => t.host), ['ejemplo.es', 'www.ejemplo.es']);
  assert.deepEqual(expandTargets(['www.ejemplo.es']).map((t) => t.host), ['www.ejemplo.es', 'ejemplo.es']);
});

test('a subdomain is checked alone', () => {
  assert.deepEqual(expandTargets(['tienda.ejemplo.es']).map((t) => t.host), ['tienda.ejemplo.es']);
});

test('two-label suffixes such as com.es keep their www', () => {
  assert.deepEqual(expandTargets(['empresa.com.es']).map((t) => t.host), ['empresa.com.es', 'www.empresa.com.es']);
});

test('asking for both names does not check any twice, and marks what was asked', () => {
  const targets = expandTargets(['ejemplo.es', 'www.ejemplo.es', 'otro.es']);
  assert.deepEqual(targets.map((t) => t.host), ['ejemplo.es', 'www.ejemplo.es', 'otro.es', 'www.otro.es']);
  assert.deepEqual(targets.map((t) => t.asked), [true, true, true, false]);
});

test('IP addresses and localhost get no www', () => {
  assert.deepEqual(expandTargets(['127.0.0.1']).map((t) => t.host), ['127.0.0.1']);
  assert.deepEqual(expandTargets(['localhost']).map((t) => t.host), ['localhost']);
});

let server;
let port;

before(async () => {
  server = tls.createServer({ key: fixture('selfsigned-key.pem'), cert: fixture('selfsigned-cert.pem') }, (socket) => socket.end());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(() => server.close());

test('a local self-signed certificate is read and judged red for two reasons', async () => {
  const result = await checkHost('localhost', { port });
  assert.equal(result.connected, true);
  assert.equal(result.selfSigned, true);
  assert.equal(result.nameMatches, false);
  assert.deepEqual(result.names, ['other.example.test']);
  assert.ok(result.durationDays > 36000);
  const verdict = judge(result);
  assert.equal(verdict.status, 'fail');
  assert.deepEqual(verdict.problems.map((p) => p.id).sort(), ['name', 'selfSigned']);
  assert.equal(verdict.unhandled, null);
});

test('a closed port is reported as no answer, not as a crash', async () => {
  const free = await new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port: chosen } = probe.address();
      probe.close(() => resolve(chosen));
    });
  });
  const result = await checkHost('localhost', { port: free });
  assert.equal(result.connected, false);
  assert.equal(result.failure, 'ECONNREFUSED');
  assert.deepEqual(judge(result).problems.map((p) => p.id), ['noHttps']);
});

test('a name that does not exist in DNS fails with ENOTFOUND', async () => {
  const result = await checkHost('esto-no-existe.invalid');
  assert.equal(result.connected, false);
  assert.equal(result.failure, 'ENOTFOUND');
});
