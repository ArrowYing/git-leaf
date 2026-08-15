# Contributing to OpenGlance

Thank you for helping improve OpenGlance.

## Before opening a change

- Search existing issues before filing a duplicate.
- Keep changes focused on one observable behavior or bounded contract.
- Do not include private repository content, credentials, personal paths, production topology, or customer data.
- Preserve the localhost-only service boundary and the MDX-lite execution whitelist.

For substantial behavior or UX changes, start with an issue that explains the user problem and proposed outcome.

## Development

OpenGlance requires Node.js 22 or newer and Git.

```bash
npm ci
npm test
npm run docs:check
```

Run the full local suite before submitting a change that affects several modules:

```bash
npm run test:all
```

If you change `src/client/source-editor.mjs`, also run:

```bash
npm run build:client
```

Do not commit `node_modules/`, `dist/`, local release profiles, signing material, or one-off debug artifacts.

## Pull requests

Explain:

- the user-visible problem or contract being changed;
- the approach and important tradeoffs;
- the verification performed;
- any platform-specific behavior that was not verified locally.

Regression tests should exercise a real behavior seam. Avoid tests that only lock source text, CSS shape, or the absence of deleted implementation details.

By contributing, you agree that your contribution is licensed under the Apache License 2.0.
