# yogurtls

![yogurTLS](https://raw.githubusercontent.com/hache-cervera/yogurtls/main/assets/banner.png)

Free and open source. Checks the TLS (SSL) certificate of one or more domains and tells you, in plain language, how it is doing, whether it renews on its own, and how to fix what is wrong.

```
npx yogurtls yourdomain.com
```

You need Node.js 20 or newer. Run `npx yogurtls` with nothing else and it asks you for the domain. It answers in Spanish if your system is in Spanish, and in English otherwise.

## What it tells you that a certificate checker does not

Most checkers read the certificate your server sends: who issued it and when it expires. yogurTLS also reads its history in the public Certificate Transparency logs, where every trusted certificate is recorded, and tells you:

- **how it is renewed**: automatically (every 60 days or so) or, by the look of it, by hand (once or twice a year). With certificates limited to 100 days from March 2027 and 47 from 2029, renewing by hand stops being an option;
- **when the automatic renewal has stopped**: it used to renew every 60 days, the current certificate is older than that, and no newer one exists. This is the failure nobody notices until the site goes down, and since June 2025 Let's Encrypt no longer emails you before expiry;
- **when a new certificate was issued but not installed**: the renewal worked, but the web server still sends the old one because nobody reloaded it.

It also checks the domain with and without `www` in one go, and spots an incomplete chain, which Chrome hides but breaks apps, integrations and `curl`.

## Usage

```
yogurtls <domain> [<domain> ...]
yogurtls --file domains.txt
```

| Option | What it does |
|---|---|
| `--file <path>` | Read domains from a file, one per line. Blank lines and lines starting with `#` are ignored. |
| `--warn-days <n>` | Amber when the certificate expires in fewer than `n` days. Default 14. |
| `--offline` | Skip the renewal history. Nothing is sent to crt.sh. |
| `--es`, `--en` | Language of the output. By default, the language of your system. |

If you give `yourdomain.com` or `www.yourdomain.com`, both are checked. Any other subdomain is checked alone.

Exit codes, so you can use it in a script or a scheduled job: `0` all green, `1` some amber, `2` some red, `3` usage or internal error.

Output has no colour when it is not a terminal or when `NO_COLOR` is set. The colour never carries the meaning alone: the status is always written as a word.

## What it checks

For each host, one TLS connection on port 443:

- who issued the certificate, when it expires and how many days it lasts,
- whether the chain is complete (the server sends the intermediate certificate),
- whether the certificate covers the name,
- what the shorter validity limits of 2027 and 2029 mean for that certificate,
- how it has been renewed, from its history in crt.sh, and whether the last renewal failed or was not installed.

Red: no answer over HTTPS, expired, name does not match, self-signed or unrecognised authority. These are the cases where a browser shows an error page.
Amber: incomplete chain, expiring soon, a renewal that has stopped, or a new certificate not installed.
Green: everything else.

## What it does not do

It does not renew or install anything. How a certificate is renewed is inferred from the dates in the public logs, so it says "looks" when it is an inference: a tool that asks for long certificates automatically would look manual. If a name is served by several servers, a newer certificate may belong to another of them.

## Privacy

It runs on your computer and connects to the domains you ask for. To read the renewal history it asks crt.sh, a free public service run by Sectigo, for the names of those domains, which are public in those logs anyway. Nothing else is sent. With `--offline` it does not contact crt.sh at all.

crt.sh is sometimes slow or busy. When it does not answer, yogurTLS says so and the rest of the report is the same. For long lists, names are asked one at a time and, if crt.sh starts limiting requests, the rest are left unchecked.

## Why it exists

It comes out of a study of the certificates of the 1,000 most visited `.es` websites. The study, in English: https://hache-cervera.github.io/research/certificates/

## Licence

MIT, Hache Cervera.

Por qué existe, en español: https://hache-cervera.github.io/research/es/certificados/
