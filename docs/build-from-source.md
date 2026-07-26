# Build Git Leaf from source

[Documentation index](README.md)

This guide is for contributors and people who want a local Community Build. It does not require Mango
Future release profiles, signing credentials, update infrastructure, or the official
[release process](release.md).

## Requirements

- macOS, Windows, or Linux for the local browser workbench;
- macOS or Windows for the packaged desktop app;
- Git;
- Node.js 22 or newer;
- npm as supplied with Node.js.

## Run the desktop app

```bash
git clone https://github.com/MangoFuture1210/git-leaf.git
cd git-leaf
npm ci
npm run desktop
```

Choose any local Git repository in the app, or select one at launch:

```bash
npm run desktop -- --repo /path/to/knowledge-repository
```

To try Git Leaf with prepared public content:

```bash
git clone https://github.com/MangoFuture1210/git-leaf-example-knowledge-base.git
npm run desktop -- --repo ../git-leaf-example-knowledge-base
```

## Run the browser workbench

From the Git Leaf checkout:

```bash
npm start -- /path/to/knowledge-repository/README.md
npm start -- /path/to/knowledge-repository/README.md --no-open
```

The service binds to localhost. The browser entry is intended for local development and does not expose
the repository to the LAN.

## Package a Community Build

Install exact dependencies first:

```bash
npm ci
```

On macOS:

```bash
npm run package:mac
```

On Windows:

```powershell
npm run portable:win
```

Output is written under `dist/` and is intentionally untracked.

Community packages have an explicit non-official identity:

| Field | Community value |
| --- | --- |
| App status | `Community build` |
| Embedded distribution | `source` |
| Release track | `source` |
| macOS Bundle ID | `org.gitleaf.community` |
| Windows CompanyName | `Git Leaf Community` |
| Official updates | Disabled |
| Usage analytics | Disabled |

They are not signed or notarized by Mango Future and must not be redistributed as an official Git Leaf
release. The official identity depends on the Mango Future signature, official package metadata,
download channel, checksum, tag, and matching public commit.

## Validate a change

Run the cross-platform core suite:

```bash
npm test
```

Before contributing a broad change:

```bash
npm run docs:check
npm run test:all
```

Platform and UI changes have additional gates in [AGENTS.md](../AGENTS.md).

## Common problems

- **Node version:** `node --version` must report 22 or newer.
- **Git is not found:** make sure `git --version` works in the same terminal.
- **Electron download fails:** retry on a stable network or configure the standard Electron mirror used
  by your environment.
- **macOS blocks an unsigned package:** run the unpackaged app with `npm run desktop`, or build/sign it
  with your own identity. Do not present a locally signed package as a Mango Future release.
- **Windows SmartScreen:** Community Builds and the current official Windows Preview are not
  Authenticode-signed. Only run code you built from a verified checkout.
