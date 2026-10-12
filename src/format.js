import { messages } from './messages.js';

const COLORS = { good: '\u001b[32m', warn: '\u001b[33m', fail: '\u001b[31m' };
const RESET = '\u001b[0m';

// Colour goes with the word, never instead of it.
function paint(word, status, useColor) {
  return useColor ? `${COLORS[status]}${word}${RESET}` : word;
}

function wrap(text, width) {
  if (width <= 20 || text.length <= width) return [text];
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function field(label, value, labelWidth, columns) {
  const indent = 2 + labelWidth;
  const lines = wrap(value, columns - indent);
  return lines.map((line, i) => (i === 0 ? `  ${label.padEnd(labelWidth)}${line}` : `${' '.repeat(indent)}${line}`));
}

function hostBlock({ result, verdict }, m, { useColor, columns, labelWidth, hostWidth, now }) {
  const out = [];
  const word = m.status[verdict.status];
  out.push(`${result.host.padEnd(hostWidth)}${paint(word, verdict.status, useColor)}`);
  const L = m.labels;
  const add = (label, value) => out.push(...field(label, value, labelWidth, columns));

  if (result.connected) {
    if (result.issuer) add(L.issuer, result.issuer);
    const expired = verdict.problems.some((p) => p.id === 'expired');
    if (expired) {
      const daysAgo = Math.ceil((now - result.validTo) / 86_400_000);
      add(L.expires, m.values.expiredAgo(result.validTo, daysAgo));
    } else {
      add(L.expires, m.values.expires(result.validTo, result.daysLeft));
    }
    add(L.duration, m.values.days(result.durationDays));
    if (verdict.chainComplete !== null) {
      add(L.chain, verdict.chainComplete ? m.values.chainComplete : m.values.chainIncomplete);
    }
    if (verdict.renewal) add(L.renewal, m.values.renewal(verdict.renewal));
  }
  for (const problem of verdict.problems) {
    add(L.what, m.problems[problem.id].what(problem.params));
    add(L.fix, m.problems[problem.id].fix(problem.params));
  }
  for (const note of verdict.notes) {
    const text = m.notes[note.id];
    // The 2027 fix goes in the same paragraph: a second 'How to fix' label would be mistaken for the problem's.
    add(L.year2027, [text.what(note.params ?? {}), text.fix(note.params ?? {})].filter(Boolean).join(' '));
  }
  return out;
}

// Informative line when the apex and www are valid but use different certificates. It does not change the status.
function pairNotes(judged, m, options) {
  const lines = [];
  const byHost = new Map(judged.map((j) => [j.result.host, j]));
  for (const { result, verdict } of judged) {
    if (!result.host.startsWith('www.') || verdict.status === 'fail') continue;
    const apex = byHost.get(result.host.slice(4));
    if (!apex || apex.verdict.status === 'fail') continue;
    if (!result.fingerprint || result.fingerprint === apex.result.fingerprint) continue;
    const note = m.notes.apexWwwDiffer;
    const params = { a: apex.result.host, b: result.host };
    lines.push('');
    lines.push(...field(m.labels.note, note.what(params), options.labelWidth, options.columns).map((l) => l.slice(2)));
    lines.push(...field(m.labels.fix, note.fix(params), options.labelWidth, options.columns).map((l) => l.slice(2)));
  }
  return lines;
}

export function renderReport(judged, lang, { useColor = false, columns = 100, now = new Date() } = {}) {
  const m = messages[lang];
  const labelWidth = Math.max(...Object.values(m.labels).map((l) => l.length)) + 2;
  const hostWidth = Math.max(30, ...judged.map((j) => j.result.host.length + 2));
  const options = { useColor, columns, labelWidth, hostWidth, now };

  const lines = [];
  judged.forEach((item, index) => {
    if (index > 0) lines.push('');
    lines.push(...hostBlock(item, m, options));
  });
  lines.push(...pairNotes(judged, m, options));

  const count = (status) => judged.filter((j) => j.verdict.status === status && !j.verdict.unhandled).length;
  lines.push('');
  lines.push(m.summary(count('good'), count('warn'), count('fail')));
  return lines.join('\n');
}
