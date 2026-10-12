// Every user-visible string lives here.

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
};

function formatDate(lang, date) {
  return `${date.getUTCDate()} ${MONTHS[lang][date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// A certificate with hundreds of names would make the line unreadable.
function listNames(lang, names) {
  const shown = names.slice(0, 8).join(', ');
  const extra = names.length - 8;
  if (extra <= 0) return shown;
  return lang === 'es' ? `${shown}, +${extra} más` : `${shown}, +${extra} more`;
}

const en = {
  status: { good: 'GOOD', warn: 'WARN', fail: 'FAIL' },
  labels: {
    issuer: 'Issuer', expires: 'Expires', duration: 'Duration', chain: 'Chain',
    disk: 'On disk', autoRenew: 'Auto-renewal',
    year2027: '2027', what: "What's wrong", fix: 'How to fix', note: 'Note',
  },
  values: {
    chainComplete: 'complete',
    chainIncomplete: 'incomplete',
    expires: (date, daysLeft) => `${formatDate('en', date)} (${daysLeft === 1 ? '1 day left' : `${daysLeft} days left`})`,
    expiredAgo: (date, daysAgo) => `${formatDate('en', date)} (expired ${daysAgo === 1 ? '1 day' : `${daysAgo} days`} ago)`,
    days: (n) => (n === 1 ? '1 day' : `${n} days`),
    disk: (s) => {
      if (s.disk.found) return s.match === null ? `${s.disk.path}` : `${s.disk.path} (${s.match ? 'the same one the site sends' : 'not the one the site sends'})`;
      if (s.disk.denied) return 'not allowed to read the certificates: run it with sudo';
      if (s.disk.missing || s.disk.invalid) return 'that file is not a readable certificate';
      return 'not found where certbot or acme.sh keep them. If it lives elsewhere (Docker, a panel), use --cert <file>';
    },
    autoRenew: (s) => {
      if (!s.auto) return s.disk.found ? 'not checked with --cert: a container or a panel would not show up here' : 'not checked: the certificate was not found on this machine';
      if (!s.auto.checked) return 'not checked: only on Linux';
      return s.auto.method ? `set up (${s.auto.method})` : 'not found on this machine';
    },
  },
  problems: {
    noHttps: {
      what: ({ host }) => `${host} doesn't answer over HTTPS.`,
      fix: () => 'If you use this name, give it a certificate. If not, remove it from DNS.',
    },
    expired: {
      what: ({ validTo }) => `Expired on ${formatDate('en', validTo)}. Browsers show an error page.`,
      fix: () => 'Renew it now. With certbot: `certbot renew`. To stop it happening again, automate renewal with ACME.',
    },
    expiringSoon: {
      what: ({ days }) => (days === 1 ? 'Expires in 1 day.' : `Expires in ${days} days.`),
      fix: () => 'If it renews on its own, check the last renewal worked. If you renew by hand, do it now.',
    },
    name: {
      what: ({ host, names }) => `The certificate doesn't cover ${host}. It covers: ${listNames('en', names)}.`,
      fix: ({ host }) => `Add ${host} to the certificate. If you don't use this name, remove it from DNS.`,
    },
    selfSigned: {
      what: () => 'Self-signed certificate: no recognised authority issued it.',
      fix: () => "Replace it with one from a recognised authority. Let's Encrypt is free.",
    },
    untrusted: {
      what: () => "The authority that signed it isn't trusted by browsers.",
      fix: () => "Replace it with one from a recognised authority. Let's Encrypt is free.",
    },
    incompleteChain: {
      what: () => "The intermediate certificate is missing. Browsers work around it, except a freshly installed Firefox, but curl, apps, integrations and bots will fail.",
      fix: () => "Make your server send the full chain. With certbot, use `fullchain.pem` instead of `cert.pem`. Otherwise, join your certificate and your authority's intermediate in one file.",
    },
    renewedNotInstalled: {
      what: ({ path }) => `There is a newer certificate on disk (${path}), but the site still sends the old one.`,
      fix: () => 'Reload the web server so it uses it: `sudo systemctl reload nginx` (or `apache2`). Behind a CDN or load balancer, upload it there too.',
    },
    diskDiffers: {
      what: ({ path }) => `The certificate the site sends is not the one in ${path}, and the one on disk is not newer.`,
      fix: () => 'The site may be served by another machine, a CDN or a proxy with its own certificate. Check which server answers for this name.',
    },
    noAutoRenewal: {
      what: () => "I can't find automatic renewal on this machine: no certbot timer and no cron job running certbot or acme.sh.",
      fix: () => 'With certbot: `sudo systemctl enable --now certbot.timer`, then `sudo certbot renew --dry-run` to test it. If another tool renews it (a panel, a container), this check cannot see it.',
    },
  },
  notes: {
    apexWwwDiffer: {
      what: ({ a, b }) => `\`${a}\` and \`${b}\` use different certificates.`,
      fix: () => 'Check both every time you renew.',
    },
    over100: {
      what: () => 'From 15 March 2027 certificates will last 100 days at most, and 47 from 2029.',
      fix: () => "If you renew by hand, that's at least 4 times a year, and around 8 from 2029. Automate it with ACME.",
    },
    ok100: { what: () => 'Already within the 100-day limit coming in March 2027.', fix: () => '' },
    ok47: { what: () => 'Also within the 47-day limit for 2029.', fix: () => '' },
    // After March 2027 the next limit is 47 days; this is the case of a certificate that exceeds it.
    over47: {
      what: () => 'From 15 March 2029 certificates will last 47 days at most.',
      fix: () => "If you renew by hand, that's around 8 times a year. Automate it with ACME.",
    },
  },
  summary: (green, amber, red) => `${green} green, ${amber} amber, ${red} red.`,
  unhandled: (host, code) => `yogurtls: ${host}: certificate error not covered by this tool: ${code}`,
  usage: {
    text: [
      'yogurtls: check the TLS certificate of one or more domains.',
      '',
      'Usage:',
      '  yogurtls <domain> [<domain> ...]',
      '  yogurtls --file domains.txt',
      '',
      'Options:',
      '  --file <path>      read domains from a file, one per line (# starts a comment)',
      '  --warn-days <n>    amber when the certificate expires in fewer than n days (default 14)',
      '  --es, --en         language of the output (by default, the language of your system)',
      '  --server           run it on the machine that serves the site: compares the certificate on disk',
      '                     with the one the site sends, and looks for automatic renewal (Linux)',
      '  --cert <file>      with --server, the certificate file to compare (if it is not in the usual places)',
      '  --calendar <file>  save a calendar file (.ics) with a reminder before each certificate expires',
      '  -h, --help         show this help',
      '  -v, --version      show the version',
      '',
      'Exit codes: 0 all green, 1 some amber, 2 some red, 3 usage or internal error.',
    ].join('\n'),
    noDomains: 'yogurtls: no domains given. Try: yogurtls example.com',
    ask: 'Which domain do you want to check? ',
    certNeedsServer: 'yogurtls: --cert only works with --server.',
    certOneDomain: 'yogurtls: --cert compares one certificate, so give one domain.',
    calendarSaved: (n, file) => `Saved ${n === 1 ? '1 reminder' : `${n} reminders`} in ${file}. Import it into your calendar. If you renew, run it again.`,
    calendarUnwritable: (file) => `yogurtls: cannot write the file "${file}".`,
    badDomain: (raw) => `yogurtls: "${raw}" is not a valid domain name.`,
    portNotSupported: (raw) => `yogurtls: "${raw}" has a port. Only port 443 is checked.`,
    badWarnDays: (raw) => `yogurtls: --warn-days needs a whole number, got "${raw}".`,
    fileUnreadable: (path) => `yogurtls: cannot read the file "${path}".`,
    unknownOption: (message) => `yogurtls: ${message}`,
  },
};

const es = {
  status: { good: 'BIEN', warn: 'OJO', fail: 'MAL' },
  labels: {
    issuer: 'Emisor', expires: 'Caduca', duration: 'Duración', chain: 'Cadena',
    disk: 'En el disco', autoRenew: 'Renovación',
    year2027: '2027', what: 'Qué pasa', fix: 'Cómo se arregla', note: 'Nota',
  },
  values: {
    chainComplete: 'completa',
    chainIncomplete: 'incompleta',
    expires: (date, daysLeft) => `${formatDate('es', date)} (${daysLeft === 1 ? 'queda 1 día' : `quedan ${daysLeft} días`})`,
    expiredAgo: (date, daysAgo) => `${formatDate('es', date)} (caducado hace ${daysAgo === 1 ? '1 día' : `${daysAgo} días`})`,
    days: (n) => (n === 1 ? '1 día' : `${n} días`),
    disk: (s) => {
      if (s.disk.found) return s.match === null ? `${s.disk.path}` : `${s.disk.path} (${s.match ? 'es el mismo que envía la web' : 'no es el que envía la web'})`;
      if (s.disk.denied) return 'no tengo permiso para leer los certificados: ejecútalo con sudo';
      if (s.disk.missing || s.disk.invalid) return 'ese archivo no es un certificado que se pueda leer';
      return 'no está donde lo guardan certbot o acme.sh. Si está en otro sitio (Docker, un panel), usa --cert <archivo>';
    },
    autoRenew: (s) => {
      if (!s.auto) return s.disk.found ? 'sin comprobar con --cert: si la hace un contenedor o un panel, desde aquí no se ve' : 'sin comprobar: no he encontrado el certificado en esta máquina';
      if (!s.auto.checked) return 'sin comprobar: solo en Linux';
      return s.auto.method ? `configurada (${s.auto.method})` : 'no la encuentro en esta máquina';
    },
  },
  problems: {
    noHttps: {
      what: ({ host }) => `${host} no responde por HTTPS.`,
      fix: () => 'Si usas este nombre, dale un certificado. Si no, quítalo del DNS.',
    },
    expired: {
      what: ({ validTo }) => `Caducó el ${formatDate('es', validTo)}. Los navegadores muestran un aviso de error.`,
      fix: () => 'Renuévalo ya. Con certbot: `certbot renew`. Para que no se repita, automatiza la renovación con ACME.',
    },
    expiringSoon: {
      what: ({ days }) => (days === 1 ? 'Caduca en 1 día.' : `Caduca en ${days} días.`),
      fix: () => 'Si se renueva solo, comprueba que la última renovación funcionó. Si lo haces a mano, renuévalo ahora.',
    },
    name: {
      what: ({ host, names }) => `El certificado no cubre ${host}. Cubre: ${listNames('es', names)}.`,
      fix: ({ host }) => `Incluye ${host} en el certificado. Si no usas este nombre, quítalo del DNS.`,
    },
    selfSigned: {
      what: () => 'Certificado autofirmado: no lo ha emitido ninguna autoridad reconocida.',
      fix: () => "Cámbialo por uno de una autoridad reconocida. Let's Encrypt es gratis.",
    },
    untrusted: {
      what: () => 'La autoridad que lo firmó no es de confianza para los navegadores.',
      fix: () => "Cámbialo por uno de una autoridad reconocida. Let's Encrypt es gratis.",
    },
    incompleteChain: {
      what: () => 'Falta el certificado intermedio. Los navegadores lo suplen, salvo un Firefox recién instalado, pero curl, las apps, las integraciones y los bots darán error.',
      fix: () => 'Configura el servidor para que envíe la cadena completa. Con certbot, usa `fullchain.pem` en vez de `cert.pem`. Si no, une tu certificado y el intermedio de tu autoridad en un solo archivo.',
    },
    renewedNotInstalled: {
      what: ({ path }) => `En el disco hay un certificado más nuevo (${path}), pero la web sigue enviando el anterior.`,
      fix: () => 'Recarga el servidor web para que lo use: `sudo systemctl reload nginx` (o `apache2`). Si hay un CDN o un balanceador delante, súbelo allí también.',
    },
    diskDiffers: {
      what: ({ path }) => `El certificado que envía la web no es el de ${path}, y el del disco no es más nuevo.`,
      fix: () => 'Puede que la web la sirva otra máquina, un CDN o un proxy con su propio certificado. Comprueba qué servidor responde por ese nombre.',
    },
    noAutoRenewal: {
      what: () => 'No encuentro renovación automática en esta máquina: ni el temporizador de certbot ni una tarea de cron con certbot o acme.sh.',
      fix: () => 'Con certbot: `sudo systemctl enable --now certbot.timer` y luego `sudo certbot renew --dry-run` para probarla. Si lo renueva otra herramienta (un panel, un contenedor), desde aquí no se ve.',
    },
  },
  notes: {
    apexWwwDiffer: {
      what: ({ a, b }) => `\`${a}\` y \`${b}\` usan certificados distintos.`,
      fix: () => 'Revisa los dos cada vez que renueves.',
    },
    over100: {
      what: () => 'Desde el 15 de marzo de 2027, los certificados durarán como mucho 100 días, y 47 desde 2029.',
      fix: () => 'Si lo renuevas a mano, pasarás a hacerlo al menos 4 veces al año, y unas 8 desde 2029. Automatízalo con ACME.',
    },
    ok100: { what: () => 'Ya cumple el límite de 100 días que llega en marzo de 2027.', fix: () => '' },
    ok47: { what: () => 'Ya cumple también el límite de 47 días de 2029.', fix: () => '' },
    // After March 2027 the next limit is 47 days; this is the case of a certificate that exceeds it.
    over47: {
      what: () => 'Desde el 15 de marzo de 2029, los certificados durarán como mucho 47 días.',
      fix: () => 'Si lo renuevas a mano, serán unas 8 veces al año. Automatízalo con ACME.',
    },
  },
  summary: (green, amber, red) => `${green} en verde, ${amber} en ámbar, ${red} en rojo.`,
  unhandled: (host, code) => `yogurtls: ${host}: error de certificado que esta herramienta no cubre: ${code}`,
  usage: {
    text: [
      'yogurtls: comprueba el certificado TLS de uno o varios dominios.',
      '',
      'Uso:',
      '  yogurtls <dominio> [<dominio> ...]',
      '  yogurtls --file dominios.txt',
      '',
      'Opciones:',
      '  --file <ruta>      lee los dominios de un archivo, uno por línea (# abre un comentario)',
      '  --warn-days <n>    ámbar si caduca en menos de n días (por defecto 14)',
      '  --es, --en         idioma de la salida (por defecto, el de tu sistema)',
      '  --servidor         ejecútalo en la máquina que sirve la web: compara el certificado del disco',
      '                     con el que envía la web y busca la renovación automática (Linux)',
      '  --cert <archivo>   con --servidor, el certificado a comparar (si no está en el sitio habitual)',
      '  --calendario <archivo>  guarda un calendario (.ics) con un aviso antes de que caduque cada certificado',
      '  -h, --help         muestra esta ayuda',
      '  -v, --version      muestra la versión',
      '',
      'Códigos de salida: 0 todo en verde, 1 algún ámbar, 2 algún rojo, 3 error de uso o interno.',
    ].join('\n'),
    noDomains: 'yogurtls: no has indicado ningún dominio. Prueba: yogurtls ejemplo.es',
    ask: '¿Qué dominio quieres comprobar? ',
    certNeedsServer: 'yogurtls: --cert solo funciona con --servidor.',
    certOneDomain: 'yogurtls: --cert compara un certificado, así que indica un solo dominio.',
    calendarSaved: (n, file) => `He guardado ${n === 1 ? '1 aviso' : `${n} avisos`} en ${file}. Impórtalo en tu calendario. Si renuevas, vuelve a generarlo.`,
    calendarUnwritable: (file) => `yogurtls: no se puede escribir el archivo "${file}".`,
    badDomain: (raw) => `yogurtls: "${raw}" no es un nombre de dominio válido.`,
    portNotSupported: (raw) => `yogurtls: "${raw}" lleva puerto. Solo se comprueba el 443.`,
    badWarnDays: (raw) => `yogurtls: --warn-days necesita un número entero, y has dado "${raw}".`,
    fileUnreadable: (path) => `yogurtls: no se puede leer el archivo "${path}".`,
    unknownOption: (message) => `yogurtls: ${message}`,
  },
};

export const messages = { en, es };
export const formatDateFor = formatDate;
