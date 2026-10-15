# Security policy

## Supported versions

Only the latest published version of yogurtls receives fixes.

## Reporting a vulnerability

If you find a security problem in yogurtls, please do not open a public issue with the details.

Use the private report on GitHub: go to the Security tab of this repository and choose Report a vulnerability. If that option is not available, open an issue that only says you have a security report, without any details, and a private way to talk will be arranged.

You will get an answer as soon as possible. Once the problem is fixed, it will be mentioned in the release notes.

## What yogurtls does and does not do

It runs on your computer, connects only to the domains you ask for and sends nothing to anyone. With the server option it only reads certificate files and asks systemctl and crontab, without changing anything.
