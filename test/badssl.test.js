import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { spawnSync } from 'node:child_process';
import { checkHost } from '../src/check.js';
import { judge } from '../src/verdict.js';

// Real cases published by badssl.com. Without a network they are skipped, not failed.
const CASES = [
  ['expired.badssl.com', 'fail', ['expired']],
  ['wrong.host.badssl.com', 'fail', ['name']],
  ['self-signed.badssl.com', 'fail', ['selfSigned']],
  ['untrusted-root.badssl.com', 'fail', ['untrusted']],
  ['incomplete-chain.badssl.com', 'warn', ['incompleteChain']],
];

let online = true;

before(async () => {
  try {
    await dns.lookup('expired.badssl.com');
  } catch {
    online = false;
  }
});

for (const [host, status, expected] of CASES) {
  test(`${host} is ${status} with ${expected.join(', ')}`, async (t) => {
    if (!online) return t.skip('no network');
    const result = await checkHost(host);
    const verdict = judge(result, { warnDays: 0 });
    assert.equal(verdict.unhandled, null);
    assert.equal(verdict.status, status);
    for (const id of expected) assert.ok(verdict.problems.some((p) => p.id === id), `missing ${id}`);
  });
}

test('the command line gives exit code 2 for an expired certificate', (t) => {
  if (!online) return t.skip('no network');
  const bin = new URL('../bin/yogurtls.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const r = spawnSync(process.execPath, [bin, 'expired.badssl.com'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /FAIL/);
});
