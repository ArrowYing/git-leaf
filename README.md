---
last_updated: 2026-07-25
---

# Git Leaf

English | [简体中文](README.zh-CN.md)

A human-friendly workspace for Git-based company knowledge.

Git Leaf is a local desktop workspace for company knowledge stored in Git repositories. It lets people
read, search, edit, and sync Markdown and MDX without hiding the underlying file paths, line numbers,
branches, or worktrees that developers and AI agents rely on.

Git Leaf does not migrate documents into a database or hosted editor. The files in the repository you
open remain the source of truth.

## What Git Leaf does

- Opens any local Git repository and preserves a stable list of repositories and worktrees.
- Shows either content-focused files or the full repository tree without changing Git discovery or sync scope.
- Organizes the sidebar into All, Favorites, and Sync views: All is the regular repository tree, Favorites
  collects favorite folders and Markdown/MDX documents, and Sync shows local changes.
- Stores favorites per repository and shares them across its worktrees. Use the file-tree context menu for
  folders or Markdown/MDX documents, or the star beside the open document.
- Supports Preview, Source, and Live modes for Markdown and MDX.
- Previews images, PDFs, CSV, JSON, YAML, HTML, code, and other attachments according to file capability.
- Restores document tabs, scroll positions, and focus independently for each worktree, with separate folder
  expansion state for the All, Favorites, and Sync views.
- Preserves source line numbers in Preview and copies selections with repository-relative paths and line ranges.
- Collects selected lines from Preview, Source, or Live into portable Markdown context for any AI agent.
- Uses one CodeMirror source model for Source and Live, so Live never creates a second rich-text data model.
- Renders a restricted MDX-lite component set without executing arbitrary JSX, JavaScript, imports, or scripts.
- Keeps the repository-wide Sync action in the Sync view. It commits and pushes all current repository
  changes, stopping safely on divergence, conflicts, or an in-progress Git operation.
- Publishes versioned share links only after pushing and verifying the exact revision on `origin/main`.
- Keeps language, appearance, typography, repository-tree preferences, shortcuts, version details, and
  environment status in a full-screen Settings & Help view. The interface follows the operating-system
  language by default and can be fixed to English or Simplified Chinese.

## Install and run

Use the installed Git Leaf desktop app for normal work. On first launch, choose a local Git repository;
later launches restore your repositories, worktrees, and workspace state.

Official public builds are available from the
[Git Leaf open page](https://gitleaf.mangofuture.com/open). Company-internal builds use a separate
distribution channel and are not published there.

Official Mango Future macOS builds are signed with Developer ID and notarized. Windows is currently an
explicitly labeled unsigned Preview; verify the published SHA-256 checksum before running it. See the
[Windows Preview guide](docs/windows-portable-guide.md).

Running from source requires Node.js 22 or newer and Git:

```bash
npm ci
npm run desktop -- --repo /path/to/docs-repo
```

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
normative specification is available in
[Simplified Chinese](docs/app-usage-analytics-spec.zh-CN.md).

## Product boundaries

- Git Leaf is a local tool. It does not provide accounts, SSO, collaborative editing, or a public document site.
- Only Markdown and MDX are editable; other repository files remain read-only or open in a system application.
- File-tree display preferences never change Git discovery, status, commit, or sync scope.
- Normal branches are editable; the first write in a detached worktree creates a protective branch.
- Localhost binding, source-backed Live editing, the MDX-lite whitelist, share-revision checks, and Git
  history safety are not user-configurable.

## Documentation

The [documentation index](docs/README.md) records language availability and the localization convention.
English uses the unsuffixed file name; Simplified Chinese uses `.zh-CN`.

| Document | Purpose |
| --- | --- |
| [Documentation index](docs/README.md) | Documentation map, language availability, and naming rules |
| [Release process](docs/release.md) | Official builds, candidate/stable promotion, signing, notarization, and tags |
| [Windows Preview](docs/windows-portable-guide.md) | Installation, updates, security warnings, and removal |
| [Architecture](docs/architecture.zh-CN.md) | Current architecture and cross-module contracts (Simplified Chinese) |
| [MDX-lite reference](docs/mdx-lite-guide.zh-CN.md) | Syntax, component whitelist, and rendering contracts (Simplified Chinese) |
| [MDX-lite demo](docs/mdx-lite-components-demo.zh-CN.mdx) | Complete visual and development fixture (Simplified Chinese) |
| [Usage analytics specification](docs/app-usage-analytics-spec.zh-CN.md) | Normative privacy, event, and metric contract (Simplified Chinese) |
| [Marketing workspace](marketing/README.md) | Positioning, open-source promotion, and future agent-led promotion |
| [Contributing](CONTRIBUTING.md) | Contribution workflow and validation expectations |
| [Security](SECURITY.md) | Security boundaries and vulnerability reporting |
| [Agent instructions](AGENTS.md) | Repository routing, safety boundaries, validation gates, and delivery workflow |

## Development

```bash
npm test
npm run test:all
npm run test:ci:mac
npm run test:ci:win
```

After changing `src/client/source-editor.mjs`, also run `npm run build:client` and commit the generated
`public/source-editor.bundle.js`. UI-specific validation and userData isolation requirements are
documented in [AGENTS.md](AGENTS.md).

## License

Git Leaf is licensed under the [Apache License 2.0](LICENSE). The license does not grant permission to
represent a community build as an official Mango Future distribution. Official identity depends on the
company code signature, official download channel, checksum, release tag, and corresponding public commit.
