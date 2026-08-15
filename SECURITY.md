# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability.

Report security issues to `security@mangofuture.com` with:

- the affected OpenGlance version or commit;
- the operating system and installation source;
- clear reproduction steps;
- the expected and observed security impact;
- any proof of concept that can be shared safely.

Mango Future will acknowledge a report as soon as practical, investigate it privately, and coordinate disclosure when a fix is available. Do not include credentials, private repository content, personal paths, or other sensitive data that is not necessary to reproduce the issue.

## Security boundaries

OpenGlance opens local Git repositories and runs a localhost-only editing service. It does not intentionally expose repository content to a LAN or the public internet. Markdown and MDX rendering does not execute arbitrary JSX, imports, scripts, or event handlers.

Official builds are identified by Mango Future's code signature, official download channel, published checksums, release tag, and source commit. A `distribution` value in build metadata is informational and is not a cryptographic proof.

Source builds do not connect to the official update service or send usage analytics. Official public builds can use the official update service, while usage analytics remain disabled by default.
