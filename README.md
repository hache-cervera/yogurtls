# yogurtls

![yogurTLS](https://raw.githubusercontent.com/hache-cervera/yogurtls/main/assets/banner.png)

Free and open source. Checks the TLS (SSL) certificate of one or more domains and tells you, in plain language, how it is doing, what changes in 2027 and how to fix what is wrong.

```
npx yogurtls yourdomain.com
```

You need Node.js 20 or newer. Run `npx yogurtls` with nothing else and it asks you for the domain. It answers in Spanish if your system is in Spanish, and in English otherwise.

## Usage

```
yogurtls <domain> [<domain> ...]
yogurtls --file domains.txt
```

| Option | What it does |
|---|---|
| `--file <path>` | Read domains from a file, one per line. Blank lines and lines starting with `#` are ignored. |
| `--warn-days <n>` | Amber when the certificate expires in fewer than `n` days. Default 14. |
| `--es`, `--en` | Language of the output. By default, the language of your system. |
| `--server` (or `--servidor`) | Run it on the machine that serves the site. See below. |
| `--cert <file>` | With `--server`, the certificate file to compare, if it is not where certbot or acme.sh keep it. One domain only. |
| `--calendar <file>` (or `--calendario`) | Save a calendar file (.ics) with a reminder before each certificate expires. |
| `--server` (or `--servidor`) | Run it on the machine that serves the site. See below. |
| `--cert <file>` | With `--server`, the certificate file to compare, when it is not where certbot or acme.sh keep it (Docker, a panel). One domain only. |
| `--calendar <file>` (or `--calendario`) | Save a calendar file (`.ics`) with an all-day reminder for each certificate, `--warn-days` before it expires. Import it into Google Calendar, Outlook or Apple Calendar. |

## From the inside: `--server`

From the outside you cannot tell how a certificate is renewed (see below). From the machine that serves the site, you can. Run it there, with `sudo` so it can read the certificates:

```
sudo npx yogurtls yourdomain.com --server
```

It adds two lines to each domain:

- **On disk**: it finds the certificate that certbot (`/etc/letsencrypt/live`) or acme.sh (`~/.acme.sh`) keeps for that name and compares it with the one the site sends. If the one on disk is newer, the renewal worked but the web server was never reloaded, and it tells you how to reload it.
- **Auto-renewal**: whether certbot's timer is enabled, or a cron job runs certbot or acme.sh. If neither is there, it says so and how to turn it on.

It only judges renewal when it finds the certificate where certbot or acme.sh keep it. If the certificate lives elsewhere (Nginx Proxy Manager, Caddy, Traefik, a hosting panel), point to it with `--cert` to compare it, and renewal is not judged, because those tools renew in their own way and that cannot be seen from here. Linux only.

## A reminder in your calendar: `--calendar`

If you renew by hand, this puts the appointment in your calendar:

```
npx yogurtls yourdomain.com --calendar renewals.ics
```

One reminder per certificate, on the day `--warn-days` (14 by default) before it expires, or today if that day has passed. If your certificate renews on its own, you don't need it. After you renew, run it again: the old reminder stays in your calendar.

If you give `yourdomain.com` or `www.yourdomain.com`, both are checked. Any other subdomain is checked alone.

Exit codes, so you can use it in a script or a scheduled job: `0` all green, `1` some amber, `2` some red, `3` usage or internal error.

Output has no colour when it is not a terminal or when `NO_COLOR` is set. The colour never carries the meaning alone: the status is always written as a word.

## On your own server: `--server`

From the outside you cannot tell whether a certificate renews on its own. From the inside you can. Run it on the machine that serves the site:

```
sudo npx yogurtls yourdomain.com --server
```

It compares the certificate on disk (where certbot or acme.sh keep it) with the one the site actually sends. If the one on disk is newer, the renewal worked but the web server was never reloaded, and it tells you how to fix that. It also looks for automatic renewal: certbot's systemd timer, or a cron job that runs certbot or acme.sh. Linux only. If the certificate lives elsewhere (Docker, a control panel), point to it with `--cert`; renewal is then not judged, because a container or a panel would not show up. It reads local files and nothing is sent anywhere. `sudo` is only needed to read the certificates.

## A reminder in your calendar: `--calendar`

```
npx yogurtls yourdomain.com --calendar renewals.ics
```

Saves one all-day reminder per certificate, `--warn-days` before it expires (14 by default), to import into Google Calendar, Outlook or Apple Calendar. Meant for certificates you renew by hand. It cannot tell whether yours renews on its own, so it says so in the reminder. After renewing, run it again.

## What it checks

For each host, one TLS connection on port 443:

- who issued the certificate, when it expires and how many days it lasts,
- whether the chain is complete (the server sends the intermediate certificate),
- whether the certificate covers the name,
- what the shorter validity limits of 2027 and 2029 mean for that certificate.

Red: no answer over HTTPS, expired, name does not match, self-signed or unrecognised authority. These are the cases where a browser shows an error page.
Amber: incomplete chain, or expiring soon. With `--server`, also: a newer certificate on disk than the one the site sends, a certificate on disk that is not the one the site sends, or no automatic renewal found.
Green: everything else.

## What it does not do

It does not renew or install anything. It does not say whether a certificate is renewed by hand or automatically, because that cannot be known reliably from the outside. We tried, with the public Certificate Transparency logs on crt.sh: on a sample of 150 .es sites whose authority renews automatically by design, it could only reach a conclusion for 9 % of them (big sites have many certificates at once, and wildcard or multi-domain certificates are often not found), and crt.sh did not answer 45 % of the time. So from the outside it only reports what it measures, and `--server` answers that question from the inside.

## Privacy

It runs on your computer, connects only to the domains you ask for, and sends nothing to anyone. With `--server` it also reads the certificate files on that machine and asks `systemctl` and `crontab`, without changing anything.

## Why it exists

It comes out of a study of the certificates of the 1,000 most visited `.es` websites. The study, in English: https://hache-cervera.github.io/research/certificates/

## Licence

MIT, Hache Cervera.

Por qué existe, en español: https://hache-cervera.github.io/research/es/certificados/
