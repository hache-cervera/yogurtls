#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { checkAll, expandTargets, normalizeHost } from '../src/check.js';
import { judge } from '../src/verdict.js';
import { renderReport } from '../src/format.js';
import { messages, formatDateFor } from '../src/messages.js';
import { renderLogo } from '../src/logo.js';
import { createInterface } from 'node:readline/promises';
import { writeFileSync } from 'node:fs';
import { findDiskCert, readCertFile, findAutoRenewal, serverFindings } from '../src/server.js';
import { buildCalendar } from '../src/calendar.js';

const EXIT = { good: 0, warn: 1, fail: 2, error: 3 };

function usageError(text) {
  process.stderr.write(`${text}\n`);
  process.exitCode = EXIT.error;
}

function readDomainFile(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function readVersion() {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
}

// Spanish when the system is in Spanish, English otherwise. --es and --en override it.
function systemLang() {
  const fromEnv = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '';
  let locale = fromEnv && fromEnv !== 'C' && fromEnv !== 'POSIX' ? fromEnv : '';
  if (!locale) {
    try {
      locale = Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
      locale = '';
    }
  }
  return /^es\b|^es[-_]/i.test(locale) ? 'es' : 'en';
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        file: { type: 'string' },
        'warn-days': { type: 'string' },
        es: { type: 'boolean' },
        en: { type: 'boolean' },
        server: { type: 'boolean' },
        servidor: { type: 'boolean' },
        cert: { type: 'string' },
        calendar: { type: 'string' },
        calendario: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    return usageError(messages[systemLang()].usage.unknownOption(error.message));
  }
  const { values, positionals } = parsed;
  const lang = values.es ? 'es' : values.en ? 'en' : systemLang();
  const m = messages[lang];

  if (values.help) {
    process.stdout.write(`${m.usage.text}\n`);
    return;
  }
  if (values.version) {
    process.stdout.write(`${readVersion()}\n`);
    return;
  }

  const serverMode = Boolean(values.server || values.servidor);
  const calendarFile = values.calendar ?? values.calendario;
  if (values.cert !== undefined && !serverMode) return usageError(m.usage.certNeedsServer);

  const warnRaw = values['warn-days'];
  const warnDays = warnRaw === undefined ? 14 : Number(warnRaw);
  if (!Number.isInteger(warnDays) || warnDays < 0) return usageError(m.usage.badWarnDays(warnRaw));

  let raws = [...positionals];
  if (values.file !== undefined) {
    try {
      raws = raws.concat(readDomainFile(values.file));
    } catch {
      return usageError(m.usage.fileUnreadable(values.file));
    }
  }
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (raws.length === 0 && interactive) {
    // Run with nothing at all (a double click, a first try): ask instead of failing.
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(m.usage.ask);
    rl.close();
    raws = answer.split(/[\s,]+/).filter(Boolean);
  }
  if (raws.length === 0) return usageError(m.usage.noDomains);

  const hosts = [];
  for (const raw of raws) {
    const normalized = normalizeHost(raw);
    if (normalized.error === 'port') return usageError(m.usage.portNotSupported(raw));
    if (normalized.error) return usageError(m.usage.badDomain(raw));
    if (!hosts.includes(normalized.host)) hosts.push(normalized.host);
  }

  if (values.cert !== undefined && hosts.length !== 1) return usageError(m.usage.certOneDomain);

  const now = new Date();
  const useColor = Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env);
  if (process.stdout.isTTY) {
    const trueColor = /truecolor|24bit/i.test(process.env.COLORTERM ?? '') || process.platform === 'win32';
    process.stdout.write(`\n${renderLogo(readVersion(), { useColor, trueColor })}\n\n`);
  }
  const results = await checkAll(expandTargets(hosts), { now });
  // A www that does not exist in DNS is not a failure: only hosts the user asked for are reported.
  const shown = results.filter((r) => r.asked || r.failure !== 'ENOTFOUND');
  if (serverMode) {
    // Automatic renewal is only judged when the certificate was found where certbot or acme.sh keep it.
    let auto;
    for (const result of shown) {
      const disk = values.cert !== undefined ? await readCertFile(values.cert) : await findDiskCert(result.host);
      if (disk.found && !values.cert && auto === undefined) auto = await findAutoRenewal();
      result.server = serverFindings(result, disk, disk.found && !values.cert ? auto : null);
    }
  }
  const judged = shown.map((result) => ({ result, verdict: judge(result, { warnDays, now }) }));

  const columns = Math.min(process.stdout.columns || 100, 110);
  process.stdout.write(`${renderReport(judged, lang, { useColor, columns, now })}\n`);
  if (calendarFile !== undefined) {
    const { text, count } = buildCalendar(shown, { lang, warnDays, now, formatDate: (d) => formatDateFor(lang, d) });
    try {
      writeFileSync(calendarFile, text);
      process.stdout.write(`\n${m.usage.calendarSaved(count, calendarFile)}\n`);
    } catch {
      return usageError(m.usage.calendarUnwritable(calendarFile));
    }
  }

  let worst = 'good';
  for (const { result, verdict } of judged) {
    if (verdict.unhandled) {
      process.stderr.write(`${m.unhandled(result.host, verdict.unhandled)}\n`);
      worst = 'error';
    } else if (EXIT[verdict.status] > EXIT[worst] && worst !== 'error') {
      worst = verdict.status;
    }
  }
  process.exitCode = EXIT[worst];
}

main().catch((error) => {
  process.stderr.write(`yogurtls: ${error.message}\n`);
  process.exitCode = EXIT.error;
});
