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

If you give `yourdomain.com` or `www.yourdomain.com`, both are checked. Any other subdomain is checked alone.

Exit codes, so you can use it in a script or a scheduled job: `0` all green, `1` some amber, `2` some red, `3` usage or internal error.

Output has no colour when it is not a terminal or when `NO_COLOR` is set. The colour never carries the meaning alone: the status is always written as a word.

## What it checks

For each host, one TLS connection on port 443:

- who issued the certificate, when it expires and how many days it lasts,
- whether the chain is complete (the server sends the intermediate certificate),
- whether the certificate covers the name,
- what the shorter validity limits of 2027 and 2029 mean for that certificate.

Red: no answer over HTTPS, expired, name does not match, self-signed or unrecognised authority. These are the cases where a browser shows an error page.
Amber: incomplete chain, or expiring soon.
Green: everything else.

## What it does not do

It does not renew or install anything. It does not say whether a certificate is renewed by hand or automatically, because that cannot be known reliably from the outside. We tried, with the public Certificate Transparency logs on crt.sh: on a sample of 150 .es sites whose authority renews automatically by design, it could only reach a conclusion for 9 % of them (big sites have many certificates at once, and wildcard or multi-domain certificates are often not found), and crt.sh did not answer 45 % of the time. So it only reports what it measures.

## Privacy

It runs on your computer, connects only to the domains you ask for, and sends nothing to anyone.

## Why it exists

It comes out of a study of the certificates of the 1,000 most visited `.es` websites. The study, in English: https://hache-cervera.github.io/research/certificates/

## Licence

MIT, Hache Cervera.

Por qué existe, en español: https://hache-cervera.github.io/research/es/certificados/
