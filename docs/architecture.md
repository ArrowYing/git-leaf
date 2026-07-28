---
title: Git Leaf system architecture
domain: ai
type: architecture
owner: maintainer
last_updated: 2026-07-28
source: git-leaf
canonical: true
ai_snippet: "[Architecture] Git Leaf | human desktop interface for shared context repositories | local HTTP service | Git worktrees | Preview Source Live | CodeMirror 6 | guarded Git sync"
---

# Git Leaf system architecture

[Documentation index](README.md)

This document defines Git Leaf's system boundaries and long-lived behavioral contracts. It is not a
user guide or an MDX-lite syntax reference.

- Product capabilities and user entry points: [README](../README.md).
- MDX-lite syntax and rendering contracts: [MDX-lite reference](mdx-lite-guide.md).
- Community builds: [Build from source](build-from-source.md).
- Official publication: [Release process](release.md).
- Hosted link metadata: [Hosted link handoff](hosted-links.md).
- Usage analytics: [Usage analytics specification](app-usage-analytics-spec.md).

## Product and data model

Git Leaf is a local desktop interface for Git repositories used as durable shared context by teams and
AI agents. These repositories are primarily made of Markdown and MDX documents.

The Git repository selected by the user is the shared context system of record. It may contain a
knowledge base, but it can also contain agent instructions, decisions, plans, playbooks, and operational
context. Git Leaf does not import documents into a separate database, CMS, context engine, or cloud
store. Images, attachments, code, and other repository files remain ordinary files. Git Leaf provides
the human interface over that repository; AI agents, developers, and automation work with the same files
directly.

Git Leaf is optimized for three jobs:

- give people who do not work in Git or Markdown a familiar way to read, search, inspect, and make
  focused edits;
- preserve source paths, line ranges, revisions, branches, and worktrees for agents and automation;
- let people return to the app to inspect and continue changes made by external agents and tools.

Git Leaf is not an agent runtime, model host, account service, public documentation site, or general
code editor.

## Runtime model

Git Leaf consists of:

- a Node.js HTTP service bound to localhost;
- a browser-based workbench served by that process;
- an Electron desktop shell that owns repository selection, application state, deep links, settings,
  updates, and operating-system integration.

The desktop app is the normal user entry point. It stores the selected repositories and workbench state
in Electron `userData`, restores the previous repository on later launches, and asks the user to choose
again if a repository is missing or invalid.

The CLI and browser entry points are development surfaces:

```bash
npm start -- /path/to/repository/README.md
npm start -- /path/to/repository/README.md --no-open
```

The service binds to `127.0.0.1:4317` by default. If that port is occupied it may choose a later local
port. It must never expose repository reads, edits, local paths, or Git actions to the LAN. The browser
does not access the filesystem directly; all reads, writes, Git operations, and attachment creation go
through the local service.

One local service process serves one current worktree. A later CLI invocation reuses a compatible
existing process for the same repository. Long-running processes detect tool-source changes, flush
pending Source or Live writes when possible, and restart without treating a stale process as current.

## Repository and worktree model

Git Leaf can open any local Git repository. The Git Leaf source checkout does not need to be inside the
content repository.

A repository can be selected through the desktop UI, supplied with `--repo`, or discovered upward from
the CLI working directory. When no saved session or explicit document exists, the initial document
priority is `AGENTS.md`, `README.md`, then `CONTEXT.md`; if none exists, Git Leaf opens an empty
workbench.

Repository identity and worktree state follow these rules:

- the repository is the stable top-level identity;
- worktrees are working directories within that repository;
- the desktop repository list preserves first-open order and does not reorder on use;
- the worktree selector is hidden when only the primary worktree exists;
- available worktrees come from `git worktree list --porcelain -z`, with the tested line-oriented
  fallback used only when the installed Git explicitly rejects `-z`;
- a stable 16-character worktree ID is derived from the canonical local worktree path;
- the ID is local-machine metadata, not a branch name and not a portable repository identifier;
- each worktree restores its own tabs, navigation history, scroll, focus, and separate All/Favorites tree
  expansion state; entering Sync starts with every changed-file directory ancestry expanded;
- favorites are scoped to the canonical primary repository and shared by that repository's worktrees.

Normal branches are editable. A detached worktree can be read and can enter an editing mode, but the
first actual write must create a protective local branch named like
`git-leaf/detached-<commit>-<timestamp>`. If branch creation fails, the write fails without modifying the
document. No write path may bypass this boundary.

### External command contract

Git, GitHub CLI, and operating-system helpers are runtime dependencies. Command callers classify both
process execution and output:

| State | Meaning | Required response |
| --- | --- | --- |
| `ok` | The command succeeded and its output satisfies the caller's contract | Continue |
| `unavailable` | The executable is missing or absent from the desktop PATH | Stop the dependent action and explain the environment requirement |
| `permission_denied` | Execution or repository access was denied | Stop without modifying repository state |
| `unsupported` | The installed command explicitly rejects a required capability | Use a tested compatibility path or stop |
| `invalid_context` | The working directory is not a usable Git worktree | Report the repository-selection problem |
| `authentication_required` | Remote credentials are missing or rejected | Keep local features available and stop the remote action |
| `network_unavailable` | DNS, proxy, connection, or TLS failed | Preserve local state and allow retry |
| `interrupted` | The process was signalled, cancelled, or timed out | Do not treat partial output as success |
| `invalid_output` | Exit status was successful but required output was absent or malformed | Stop before parsing or mutating state |
| `failed` | Any other command or repository failure | Preserve concise technical context and hand off recovery |

Nonzero exit codes are normal only when a specific command contract declares them so, such as
`merge-base --is-ancestor` returning 1 for “not an ancestor.” Optional information may degrade only at
an explicit call site; for example, a failed share-title preview can fall back to the filename.

## Workbench state and navigation

The front end has four stable areas:

- a top bar with repository identity, document tabs, modes, and document actions;
- a left sidebar with worktree selection, All/Favorites/Sync views, search, frontmatter filtering, and
  the Agent Context entry;
- an optional document outline synchronized with the content scroll position;
- the main content area for Preview, Source, Live, and read-only file viewers.

Sidebar, outline, and content have independent scrolling. Transient feedback uses a fixed toast below
the title bar. Opening a tab must not expand or scroll the file tree or steal its focus. “Reveal in
Sidebar” is the explicit action that expands ancestors and performs the smallest necessary scroll.

Each tab has a stable identity, a current document location, and an independent Back/Forward history.
Normal file-tree and internal-document navigation replace the current tab location. Command/Ctrl-click
opens another tab. Browser URL state is a projection of the active location, not the application's
navigation history.

Favorites are user preferences, not repository content. Desktop builds persist them in `userData`; the
browser development entry uses repository-scoped `localStorage` as a best-effort fallback. Missing
favorite paths remain removable placeholders and are not deleted merely because another branch lacks
them.

Agent Context is session-scoped and isolated by repository and worktree. It stores repository-relative
paths, source line ranges, captured Markdown, branch, and revision for the current window session. It
does not create a long-term content database. Copied context is generic Markdown and is not tied to one
agent provider.

## File capabilities

The server discovers Git-tracked files and unignored local files. File-tree preferences change only
presentation:

- Content Files shows Markdown, MDX, HTML, images, and PDF by default;
- All Repository Files shows the complete discovered tree;
- search, the current document, favorites, and Sync may reveal otherwise hidden paths;
- Git Leaf-created empty folders contain a zero-byte `.gitkeep`; All and Content Files preserve the
  folder while hiding the placeholder, and Sync exposes the placeholder whenever Git reports its change;
- text search combines whitespace-separated terms with AND, matches each folder or file on its own
  searchable fields, and initially keeps only matches plus the ancestor folders needed to reach them;
  when a file needs `ai_snippet` to satisfy the query, its tree row shows a highlighted matching excerpt
  so every automatically revealed result has visible evidence; truncated matching file names expand to
  their full highlighted name, while an `ai_snippet` result uses that same whole-row expansion timing
  and file-name-aligned origin to show the full highlighted snippet;
  search has transient directory expansion state independent from the saved file tree, so explicitly
  expanding a matching folder may reveal its descendants without changing the tree restored afterward;
- frontmatter filtering narrows Markdown and MDX documents only.

All, Favorites, Sync, and file-tree preferences must never alter Git discovery, status, staging, commit,
or sync scope.

| File class | Capability |
| --- | --- |
| Markdown and MDX | Preview, Source, and Live; editable |
| Images, PDF, CSV, JSON, YAML, HTML, and plain text | Read-only preview where supported |
| Recognized UTF-8 code and configuration | Read-only code preview |
| Unknown text | Detected on open and shown read-only |
| Other binary files, symlinks, and submodules | Visible with an unsupported-preview state and an Open in System App action |

Ordinary deep links, shared links, and source-line locations remain limited to Markdown and MDX even
though the file tree can display other types.

`git ls-files` is authoritative. Filesystem fallback is allowed only when a path is genuinely outside a
Git repository. A missing Git executable, corrupt index, or repository error must fail visibly instead
of exposing a second file set that includes ignored content.

## Document modes

Git Leaf has exactly three document modes; their UI names remain `Preview`, `Source`, and `Live`.

### Preview

Preview renders Markdown and allowlisted MDX-lite, refreshes external changes, preserves source line
numbers, supports source-based selection, and understands GitHub-style `#L34-L42` locations. It is the
most stable reading contract and must not regress as editing features evolve.

### Source

Source edits the Markdown or MDX text with CodeMirror 6. It shares the same read, write, line, and
location model as Preview and writes through to disk after a short debounce. There is no separate Save
button or durable draft store.

### Live

Live is a reading-oriented visual layer over the same CodeMirror text model. The active line or block
remains source-editable; inactive Markdown syntax and allowlisted blocks may show previews or small
editing controls. Every change still writes the original Markdown or MDX file. Live must never introduce
a second rich-text data model.

Source and Live reload external changes made by Git, editors, or AI agents. Git conflict markers remain
ordinary source text; Git Leaf does not own conflict resolution.

## Rendering and MDX-lite

Markdown uses `markdown-it`. MDX-lite is parsed by Git Leaf before rendering and produces static HTML or
SVG. It is not a general MDX runtime and cannot execute imports, exports, arbitrary JSX, scripts,
expressions, or event handlers.

Rendered blocks preserve source line ranges. Preview, Source, and Live use the same source-based
selection and Agent Context semantics. Copying a reference includes the repository-relative path, line
range, and original Markdown.

The component allowlist, attributes, input data formats, and rendering contracts live only in
[MDX-lite reference](mdx-lite-guide.md).

## Editing and write boundaries

Source and Live write the current file after a short debounce. Watcher events caused by Git Leaf's own
write are ignored by content state to avoid reload loops. External changes reload from disk. A narrow
race may lose not-yet-flushed keystrokes rather than creating an independent hidden draft model.

Document creation is limited to Markdown and MDX. The service adds a safe extension when needed,
rejects paths outside the repository, refuses overwrite, and opens the new document in a foreground tab.

File-tree mutations are deliberately narrower than a general file manager:

- a context menu creates one folder with a zero-byte `.gitkeep`; creation is refused when Git ignores
  that marker;
- when a document is then created in that folder during the same server session, Git Leaf removes only
  the marker it created, and only while it is still zero-byte and untracked;
- F2 or the context menu renames one regular file within its existing directory and refuses overwrite,
  symlinks, and submodules;
- renaming a Markdown, MDX, or image target updates recognized incoming Markdown destinations and
  quoted HTML `href` or `src` attributes, but never treats code examples as references;
- deletion requires an explicit dialog, reports incoming references without rewriting them, and warns
  more strongly when the exact current file contents are not recoverable from Git;
- directory deletion accepts only an empty directory or one containing only an unchanged zero-byte
  `.gitkeep`; recursive deletion and moving are not provided.

Mutation previews include a content and reference fingerprint. The service recomputes the plan after
confirmation and fails on drift instead of applying stale link rewrites or deletion assumptions. Every
mutation still passes through detached-worktree branch protection. The resulting tree row receives
transient feedback without taking focus from the current editing surface.

Editor assistance must remain explainable from source:

- slash commands insert readable Markdown or allowlisted MDX-lite templates;
- inserting MDX-lite into `.md` requires explicit confirmation before renaming to `.mdx`;
- pasted PNG, JPEG, GIF, WebP, or AVIF files go into a nearby `_assets/` directory;
- controlled image markup preserves only safe attributes;
- dialogs use application UI instead of native browser `prompt` or `confirm`.

## Git synchronization

Sync is a repository-level helper, not a fourth document mode. The Sync view presents two independent
facts: the last checked remote state and the unpublished local changes. It processes every Git status
change, including attachments, code, renames, and deletions. Each time the user enters Sync, every
directory chain leading to a changed file starts expanded; a manual collapse affects only that visit.

Remote checking starts after the repository opens and repeats every ten minutes. Returning to a visible
window after a missed interval also triggers a check. Fetching only updates the remote-tracking ref:

- when the current branch is behind and the worktree is clean, Git Leaf applies a safe fast-forward
  automatically and refreshes the open document without changing its tab or mode;
- when the worktree has local changes, Git Leaf reports the incoming paths but does not mutate the
  worktree in the background;
- **Merge remote changes** is an explicit down-only action. It advances the local branch to the fetched
  remote commit while preserving the user's complete local workspace as uncommitted changes. It neither
  commits nor pushes;
- **Sync and publish** remains the explicit up action. It includes any required remote integration, then
  commits and pushes all local changes.

For a dirty down-only merge, Git Leaf freezes the complete click-time workspace with an alternate Git
index and an immutable snapshot commit. It merges that snapshot with the fetched remote commit in Git's
object layer. Only a conflict-free result may be applied to the real files, and a final tree comparison
must match the verified object-layer result. The branch ref advances with a compare-and-swap update, the
real index resets to the remote commit, and the combined workspace therefore remains uncommitted. A
short-lived recovery ref protects the frozen snapshot during application. Workspace drift stops before
mutation; an object-layer conflict leaves the real branch, index, and files unchanged.

The guarded publish strategy:

1. Fetch and compare local and upstream history when an upstream exists.
2. Stop before staging if local and remote both have unique commits.
3. Record the initial HEAD and content fingerprint for all changes.
4. Recheck before staging; prepare once again if the worktree changed, then stop if it keeps changing.
5. Stage all changes and create the commit from the index.
6. If the remote is not ahead, push the frozen commit even if new post-commit changes appear.
7. Never automatically rebase a dirty worktree; rebase only a frozen commit when the worktree remains
   safe and the local branch is merely behind.
8. Push the verified commit OID, fetch again, and prove the remote branch contains it before reporting
   success.

Neither action starts during merge, rebase, cherry-pick, revert, or an existing conflict. A failed
publish rebase attempts `rebase --abort`. Divergence, conflicts, repeated workspace drift, and
unexpected Git state stop safely. A copyable prompt for the user's chosen AI agent is the final fallback,
and the down-only prompt explicitly requires an uncommitted, unpushed result.

## Deep links and hosted handoff

The desktop app registers `git-leaf://`:

```text
git-leaf://open
git-leaf://open?repo=<absolute-local-path>&path=<repository-relative.md>
git-leaf://open?repo=<github-owner/repository>&path=<repository-relative.md>
git-leaf://open-worktree?repo=<github-owner/repository>&path=<relative.md>&worktree=<local-id>
```

An empty link only launches or focuses the app. Shareable links use a lowercase GitHub
`owner/repository` identity and do not expose the sender's absolute path. Git Leaf matches that identity
against repositories already opened locally; if no match exists, it asks the user to select a local
repository and verifies its origin before continuing.

`path` must be a safe repository-relative Markdown or MDX path. Traversal, absolute paths, and other file
types are rejected. A worktree-specific link uses `open-worktree`, fails if the exact local ID is
missing, and never silently falls back to another worktree.

The HTTPS `/open` and `/share` endpoints are Mango Future hosted handoff services. They convert safe URL
metadata into a local protocol launch and maintain a random, in-memory handoff state for up to ten
minutes. They do not fetch a Git repository or document body. The exact transmitted metadata and normal
HTTP exposure are documented in [Hosted link handoff](hosted-links.md).

The separate `/download` page never launches `git-leaf://`. It shows only manifests explicitly marked
`releaseTrack=public` whose channel, platform, HTTPS URL, SHA-256, size, and on-disk artifact agree.
Internal, legacy, or missing-track manifests must never appear there.

### Shared documents

Shared document links are versioned:

```text
https://gitleaf.mangofuture.com/share?v=1&repo=<owner/repo>&path=<relative.md>&rev=<full-commit>&title=<title>
git-leaf://open-shared?v=1&repo=<owner/repo>&path=<relative.md>&rev=<full-commit>&handoff=<id>
```

Version 1 shares only a document from the primary checkout's `main`. `rev` is the full commit that last
changed the document and must already be reachable from `origin/main`. The receiving app opens a newer
main that contains the revision; it does not detach at that commit.

The HTTPS URL can include a document title of at most 100 characters for link previews. New links do not
include `ai_snippet` or document body content. The hosted page accepts the legacy bounded `snippet`
parameter for compatibility but Git Leaf no longer generates it.

Before copying a link, the sender publishes local changes if the user confirms, fetches the remote, and
proves the revision is on `origin/main`. A local commit or successful push process exit is not enough.
The receiver always resolves the primary checkout, fetches `origin/main`, retries one transient network
failure, and applies only a safe fast-forward or the same guarded sync flow. Ahead, diverged, conflicting,
missing-revision, or continuously changing states stop without silent Git mutation.

A shared URL grants no GitHub permission. The receiving Git Leaf installation uses that repository's
existing local Git credentials.

## Desktop Profile and preferences

Human use of installed official, development, and locally run builds shares the same real Electron
Profile so replacing an app preserves repositories, sessions, appearance, language, favorites, and
sidebar state. Build identity controls labeling, updater eligibility, and analytics eligibility; it
must not select another `userData` directory by itself.

Agent automation is a separate launch intent. `make smoke-dev-mac` creates a one-time read-only-derived
snapshot, passes explicit isolated `userData` and `sessionData`, verifies the production Profile
fingerprint after the run, and deletes only the temporary snapshot. Failure to create or verify the
snapshot must stop automation; it may not fall back to the real Profile.

Five settings are user configurable: `language`, `colorMode`, `documentFont`, `documentFontSize`, and
`fileTreeMode`. Tabs, tree expansion, scroll, focus, sidebar state, outline state, and split ratios are
restored workbench state, not settings. Frontmatter rules are repository-owned data. Version and
environment information are read-only status.

Preference propagation is directional:

- a workbench renderer that saves a preference updates persistent state and the server snapshot but
  does not receive an echo;
- Settings or Desktop Home may broadcast a persisted normalized result to the workbench;
- color, font, and size changes must not rebuild the file tree;
- a real `fileTreeMode` change may rebuild it once;
- a language change flushes editing and workbench state before a safe reload;
- restoring focus or viewport after rendering must not save unchanged state again.

No path may form a render → save session → save preference → broadcast → render feedback loop.

## Build identity and updates

Every packaged app embeds build metadata. Community builds use the technical
`distribution=source, releaseTrack=source` identity, display `Community build`, use the macOS bundle ID
`org.gitleaf.community`, and use `Git Leaf Community` publisher metadata on Windows. They do not check
Mango Future update feeds or send usage analytics.

Official builds require a reviewed release profile, use `distribution=official`, and select either the
public or internal release track. Only official builds use Mango Future's macOS bundle ID, Windows
CompanyName, code signature, and update services. See [Release process](release.md).

Official update checks read metadata only on launch, hourly, after reactivation, and after sleep. A
package download starts only after the user chooses Update or a previously persisted update intent is
resumed. The app saves state and shuts down its local service and windows before launching the platform
installer. Failed preparation remains retryable and must not masquerade as an active download.

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `desktop/main.mjs` | Electron lifecycle, windows, menus, repository selection, settings, deep links |
| `desktop/settings-center.mjs`, `desktop/settings/` | Full-screen settings/help and restricted IPC |
| `desktop/preference-sync.mjs` | Persistence, server snapshots, and renderer preference propagation |
| `src/desktop-config.mjs` | Atomic desktop configuration with last-known-good backup |
| `src/desktop-user-data.mjs` | Shared human Profile and explicit smoke isolation |
| `src/desktop-server.mjs` | Local service launch and port fallback |
| `src/cli.mjs` | CLI discovery, service reuse, and launch |
| `src/server.mjs` | Local HTTP API, document IO, rendering, Git actions |
| `src/repositories.mjs`, `src/git-worktrees.mjs` | Repository identity, worktree discovery, stable IDs |
| `src/external-command.mjs` | Command execution and failure classification |
| `src/git-leaf-open-link.mjs`, `src/desktop-deep-link.mjs` | HTTPS and local protocol generation/parsing |
| `src/git-share-publish.mjs`, `src/git-share-open.mjs` | Sender publication and receiver safety |
| `src/markdown.mjs`, `src/mdx-lite.mjs` | Markdown and allowlisted MDX-lite rendering |
| `src/client/source-editor.mjs` | Shared CodeMirror Source/Live editing model |
| `src/git-sync.mjs` | Guarded repository-wide sync |
| `src/git-remote-sync.mjs` | Periodic remote status and down-only merge transaction |
| `src/git-immutable-snapshot.mjs` | Alternate-index workspace snapshots and object-layer merge |
| `src/telemetry.mjs` | Official-build analytics state and event contract |

Rendering, editing, repository safety, the desktop shell, and Git synchronization must not absorb one
another's responsibilities.

## Non-goals

Git Leaf does not currently provide:

- real-time multi-user editing;
- cloud accounts, SSO, permissions, or a hosted repository or context service;
- arbitrary MDX, JSX, document scripts, or event handlers;
- a full BI, mapping, graph, or dashboard system;
- the Obsidian plugin ecosystem;
- an embedded AI chat or agent runtime;
- a context retrieval engine, semantic index, vector database, or MCP service;
- attribution or a formal diff-approval workflow for agent changes;
- a replacement for Git branching, code review, or conflict resolution.

## Architecture invariants

- The selected Git repository remains the shared context source of truth.
- The local editing service remains bound to localhost.
- Live never introduces a second rich-text storage model.
- MDX-lite remains allowlisted and non-executable.
- Display preferences never change Git scope.
- No write bypasses detached-worktree branch protection.
- Shared links never grant permissions or carry local absolute paths.
- Community builds never impersonate Mango Future official identity or use official update/analytics
  services.
- Tables, images, links, and MDX-lite controls remain explainable from source text.

Repository reading order, test commands, Profile safety, and delivery workflow live only in
[AGENTS.md](../AGENTS.md).
