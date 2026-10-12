import test from 'node:test';
import assert from 'node:assert/strict';
import { messages } from '../src/messages.js';

const FORBIDDEN_CHARACTERS = ['—', '–', '→', '←', '·', '!', '¡'];
const FORBIDDEN_WORDS = [
  'blazing fast', 'seamless', 'robust', 'powerful', 'leverage', 'effortless', 'game-changer',
  'rápido y sencillo', 'potente', 'revolucionario',
];
const EMOJI = /\p{Extended_Pictographic}/u;

const SAMPLE = {
  host: 'ejemplo.es', names: ['ejemplo.es', 'otro.es'], days: 3, a: 'ejemplo.es', b: 'www.ejemplo.es',
  validTo: new Date('2026-12-10T00:00:00Z'), issued: new Date('2026-10-01T00:00:00Z'), every: 60, age: 75, mode: 'manual',
};

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'function') {
    try {
      const result = value(SAMPLE, 3, 5);
      if (typeof result === 'string') out.push(result);
      else collectStrings(result, out);
    } catch {
      out.push(value(new Date('2026-12-10T00:00:00Z'), 3));
    }
  } else if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) collectStrings(inner, out);
  }
  return out;
}

for (const lang of ['en', 'es']) {
  test(`${lang}: no long dashes, arrows, bullets, exclamations or emoji`, () => {
    const strings = collectStrings(messages[lang]);
    assert.ok(strings.length > 30, 'the collector should reach the message tree');
    for (const text of strings) {
      for (const character of FORBIDDEN_CHARACTERS) {
        assert.ok(!text.includes(character), `"${character}" in: ${text}`);
      }
      assert.ok(!EMOJI.test(text), `emoji in: ${text}`);
    }
  });

  test(`${lang}: no brochure words`, () => {
    const joined = collectStrings(messages[lang]).join('\n').toLowerCase();
    for (const word of FORBIDDEN_WORDS) assert.ok(!joined.includes(word), `"${word}" found`);
  });
}

test('both languages define the same problems and notes', () => {
  assert.deepEqual(Object.keys(messages.en.problems), Object.keys(messages.es.problems));
  assert.deepEqual(Object.keys(messages.en.notes), Object.keys(messages.es.notes));
});
