---
last_updated: 2026-07-28
---

# Git Leaf

English | [简体中文](README.zh-CN.md)

A desktop app for Git-based knowledge bases.

Open and maintain your knowledge base without working directly in Git or Markdown.

Anyone can use Git Leaf, while AI agents work with the same files directly in Git.

[**Download for macOS**](https://gitleaf.mangofuture.com/download#macos) ·
[Windows Preview](https://gitleaf.mangofuture.com/download#windows) ·
[Build from source](docs/build-from-source.md)

![Git Leaf showing a Git-based knowledge base, local changes, and Agent Context](marketing/assets/git-leaf-product.png)

[![CI](https://github.com/MangoFuture1210/git-leaf/actions/workflows/ci.yml/badge.svg)](https://github.com/MangoFuture1210/git-leaf/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

[Open the public example knowledge base](https://gitleaf.mangofuture.com/open?repo=mangofuture1210%2Fgit-leaf-example-knowledge-base&path=README.md)
after installing Git Leaf, or clone it for a completely local first run.

## Core workflow

- **Open the knowledge base you already have.** Git Leaf works with any local Git repository without
  importing its content into another system. The repository remains the source of truth.
- **Find, read, and edit through a familiar file tree.** Browse the knowledge base in its existing
  folder structure or search directly. Open a document in Preview, Source, or Live; every edit goes
  back to the original file.
- **Let people and AI agents work on the same files.** Collect exact lines as portable Agent Context,
  let an agent read or modify the repository directly, then return to Git Leaf to review the changes.
- **Bring in remote changes without losing unfinished work.** Git Leaf checks the remote when a
  repository opens and every 10 minutes, fast-forwards a clean worktree, and can merge remote changes
  while keeping local edits uncommitted.
- **Review before publishing.** Sync shows unpublished work and remote status. **Sync and publish**
  commits and pushes intentionally and stops safely when Git needs attention; **Copy share link** returns
  a versioned link only after verifying the published revision.

## More built in

- All, Favorites, and Sync views, with a content-focused tree or the complete repository tree.
- Repository and worktree switching with restored tabs, navigation history, scroll positions, and focus.
- Read-only previews for images, PDFs, CSV, JSON, YAML, HTML, code, and other repository attachments.
- Source line references that preserve where selected text came from.

## More than text

Knowledge-base documents can also present data tables, timelines, key metrics, decisions, flow diagrams,
and charts. The content stays as readable text in Git, so people and AI agents can continue to read and
update the same files.

Git Leaf presents this content through safe built-in components; documents cannot run their own code or scripts.

![Git Leaf rendering a bar-and-line chart in a knowledge-base document](marketing/assets/git-leaf-mdx-chart.png)

## Download

Use the installed Git Leaf desktop app for normal work. On first launch, choose a local Git repository;
later launches restore your repositories, worktrees, and workspace state.

Official public builds are available from the
[Git Leaf download page](https://gitleaf.mangofuture.com/download). Company-internal builds use a separate
distribution channel and are not published there.

Official Mango Future macOS builds are signed with Developer ID and notarized. Windows is currently an
explicitly labeled unsigned Preview; verify the published SHA-256 checksum before running it. See the
[Windows Preview guide](docs/windows-portable-guide.md).

### Run from source

Running from source requires Node.js 22 or newer and Git:

```bash
npm ci
npm run desktop -- --repo /path/to/docs-repo
```

The complete [build-from-source guide](docs/build-from-source.md) explains source packaging, Community
Build identity, and the difference from an official Mango Future distribution. The
[public example knowledge base](https://github.com/MangoFuture1210/git-leaf-example-knowledge-base)
provides a ready-to-open repository with Markdown and MDX content.

The CLI and browser workspace are primarily for local development:

```bash
npm start -- /path/to/docs-repo/README.md
npm start -- /path/to/docs-repo/README.md --no-open
```

The desktop app and CLI/browser service listen on localhost only. Development installs and automated
smoke tests use isolated application data; see [AGENTS.md](AGENTS.md) for the repository's development
and safety requirements.

## Build identity and privacy

| Build | Update channel | Usage analytics default |
| --- | --- | --- |
| Community or local source build | Disabled | Disabled |
| Official Mango Future public build | `stable` | Disabled |
| Official Mango Future internal build | `internal-stable` | Enabled |

Settings identifies source, official public, official internal, and development builds and shows the
effective usage-analytics state. A build default is used only for first-time initialization; updates
preserve an existing `usageAnalyticsEnabled` value in user data.

Usage analytics run only in company-managed official builds when enabled locally. They do not send
repository names, paths, file names, search terms, document content, or Git identity. The current
normative contract is the [usage analytics specification](docs/app-usage-analytics-spec.md).

## Product boundaries

- Git Leaf is a local tool. It does not provide accounts, SSO, collaborative editing, or a public document site.
- Only Markdown and MDX are editable; other repository files remain read-only or open in a system application.
- File-tree display preferences never change Git discovery, status, commit, or sync scope.
- Normal branches are editable; the first write in a detached worktree creates a protective branch.
- Localhost binding, source-backed Live editing, the MDX-lite whitelist, share-revision checks, and Git
  history safety are not user-configurable.
- The public `/open` and `/share` pages are Mango Future-hosted handoff services. They receive repository
  identifiers and document metadata, but never Git credentials or document content. See
  [Hosted link metadata and privacy](docs/hosted-links.md).

## Development

```bash
npm test
npm run test:all
npm run test:ci:mac
npm run test:ci:win
```

After changing `src/client/source-editor.mjs`, also run `npm run build:client` and commit the generated
`public/source-editor.bundle.js`. See [Contributing](CONTRIBUTING.md) for the contribution workflow,
the [documentation index](docs/README.md) for technical references, and [AGENTS.md](AGENTS.md) for
UI-specific validation and userData isolation requirements.

## License

Git Leaf is licensed under the [Apache License 2.0](LICENSE). The license does not grant permission to
represent a community build as an official Mango Future distribution. Official identity depends on the
company code signature, official download channel, checksum, release tag, and corresponding public commit.
