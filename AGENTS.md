---
last_updated: 2026-07-28
---

# AGENTS.md - Git Leaf

This is the standalone Git Leaf repository. It develops a local human interface for Git repositories
used as shared context by teams and AI agents. Git Leaf can open any local Git repository selected by
the user, whether it is a company repository or a third-party repository. Git Leaf source code, the
desktop shell, the web workspace, tests, and packaging configuration are all maintained here.

## Purpose of this file

- This file contains only the reading routes, safety boundaries, validation gates, and delivery workflow
  an agent must know when entering the repository.
- User-visible capabilities and usage belong in the English entry point `README.md`, with
  `README.zh-CN.md` as its Simplified Chinese counterpart. Cross-module design and long-lived behavioral
  contracts belong in `docs/architecture.md`. Specific regression scenarios, fixtures, and
  acceptance details belong in the corresponding tests or scripts.
- Do not maintain a feature-by-feature catalog, individual interaction specifications, one-off bug root
  causes, or design-discussion history in this file.

## What to read first

- Read this file before ordinary changes, then read the nearest relevant source files and tests for the
  area being changed.
- Product capabilities, usage, and boundaries: `README.md`.
- End-user workflows and the visual product tour: `docs/user-guide.md`, with
  `docs/user-guide.zh-CN.md` as its Simplified Chinese counterpart.
- Architecture, service boundaries, worktrees, local editing, and the desktop wrapper:
  `docs/architecture.md`.
- MDX-lite implementation and component boundaries: `docs/mdx-lite-guide.md`. The complete
  development and visual-regression fixture is `docs/mdx-lite-components-demo.mdx`.
- Community Build prerequisites and commands: `docs/build-from-source.md`.
- Hosted `/open` and `/share` metadata and privacy boundary: `docs/hosted-links.md`.
- Windows unsigned Preview installation and launch guidance: `docs/windows-portable-guide.md`.
- The sole source of truth for official desktop usage-analytics event semantics, fields, relationships,
  metric formulas, privacy boundaries, JSONL storage, and prohibited inferences is
  `docs/app-usage-analytics-spec.md`.
- The release process is in `docs/release.md`. The repository-owned Agent entry point is
  `.agents/skills/git-leaf-release/SKILL.md`; it routes to the document and controller without
  duplicating the full release procedure.

## Repository layout

- `src/`: runtime source. Only cross-runtime primitives and the CLI entry point stay directly under it.
- `src/server/`: flat local Node service and repository layer shared by the CLI and Electron host.
- `src/content/`: browser-safe Markdown/MDX rendering shared by the local service and editor bundle.
- `src/client/`: CodeMirror Source and Live editor source.
- `public/`: browser workspace assets. `public/source-editor.bundle.js` is generated from
  `src/client/source-editor.mjs`.
- `src/desktop/`: Electron main-process entry point and desktop-only modules. Desktop configuration,
  environment checks, updates, analytics, home, and navigation live there.
- `assets/`: packaging assets such as application icons. The macOS icon source is
  `assets/icons/git-leaf.*`.
- `docs/`: architecture, release instructions, platform guides, renderer references, and specifications.
  Maintainer-facing technical documents are English-only. End-user documents may add Simplified Chinese
  with `.zh-CN`.
- `test/`: Node test runner tests.
- `dist/`: local build artifacts; never commit this directory.

## Development commands

```bash
npm test
npm run test:all
npm run test:ci:mac
npm run test:ci:win
npm run release:prepare
npm run release:status
npm run build:client
npm run docs:check
npm run telemetry:summary -- /path/to/gitleaf-telemetry/events --format markdown
npm run desktop -- --repo /path/to/docs-repo
node src/cli.mjs --no-open
node src/cli.mjs <repo-relative-path.md-or-mdx> --no-open
make smoke-dev-mac
make install-dev-mac
make package-mac
make package-win
```

Run `npm test` by default after changing Git Leaf core code. It runs only the cross-platform core suite.
Run the complete local regression suite with `npm run test:all` before a release.

After changing `src/client/source-editor.mjs`, also run `npm run build:client` and commit the generated
`public/source-editor.bundle.js`.

When changing real UI behavior in Preview or Live Editor, MDX-lite components, the frontmatter dialog,
line numbers, or keyboard focus, run the Node tests and use `make smoke-dev-mac` on macOS to open a real
document with isolated configuration. Cover at least Preview and Live, and confirm that the target
interaction is clickable, visible, scrollable, or editable in the real DOM.

After changing macOS packaging, signing, notarization, local installation, or icons, run at least
`npm run test:ci:mac`. Run `make install-dev-mac` only when a local application update must be verified.

`make install-dev-mac` installs or replaces the same human-facing `Git Leaf.app` and therefore uses the
same real, persistent configuration as the formal app. The interface identifies the embedded development
build as `Git Leaf dev`, and that build does not check for production updates, but build identity must not
select a different Profile. Replacing the app must preserve the repositories, sessions, appearance,
typography, language, favorites, and sidebar state the user already uses.

Agent-driven automated verification is a different launch intent. It must use the explicit, one-time
snapshot created by `make smoke-dev-mac`; the snapshot is derived read-only from the real Profile, writes
both `userData` and `sessionData` only inside its temporary directory, verifies the real Profile
fingerprint after the run, and then removes only that temporary directory.

`make release-mac` and `make release-win` are component commands, not formal release entry points.
Release packages must exclude development directories such as `test/`, `dist/`, and `.git/`. After
changing Windows packaging, the portable ZIP, or release gates, run `npm run test:ci:win`.

## UI regression diagnosis and completion gates

- When a user reports a real UI bug through a video, screenshot, or installed application, treat the
  description only as a lead. Before changing code, reproduce the same observable symptom in an isolated
  development build and collect your own evidence using Computer Use, real DOM state, or targeted event
  logging. Do not infer the event source from the description alone.
- Establish a fast, deterministic feedback loop before editing code. Prefer recording target-component
  visibility, whether the relevant DOM is replaced, and the event and call sources across renderer,
  desktop, and server boundaries. Full tests, packaging, and a human development install are regression
  steps after the root cause is known; they do not replace diagnosis.
- Feedback loops for periodic UI issues must cover multiple complete cycles. Observe stationary hover,
  focus, or scrolling problems continuously for at least 10 seconds by default. If the user reports that
  the problem still exists, the current diagnosis is falsified: expand the call chain and module scope
  instead of adding another cooldown, delay, or adjacent patch to the same hypothesis.
- Claim a fix only after an isolated smoke built from the current code passes the original reproduction
  scenario. Green Node tests, source-code regular-expression assertions, a single screenshot, or proof
  that a package contains the code are not sufficient on their own.
- Keep issue-specific smoke commands, fixtures, and acceptance language in `Makefile`, `scripts/`, and
  `test/`; do not accumulate feature-level details in this file.

## Regression test admission

- A new regression test must protect an explainable user-observable behavior, security boundary, or
  finite contract and trigger from a real call seam. Test names and assertions must state the behavioral
  result, not merely prove that implementation code, CSS, HTML, or copy retains a particular shape.
- Use negative assertions only for bounded input spaces such as protocols, paths, permissions,
  allowlists, privacy fields, and security states. Do not add tombstone tests that merely say an old
  file, function, phrase, or style must never reappear. Delete obsolete implementations and rely on code
  review and version history for that cleanup.
- Documentation links, formatting, and structural consistency are lint concerns. Executable
  configuration such as release manifests, installation scripts, CSP, and IPC allowlists is itself a
  product contract and may have static gates, but those gates must assert finite safety or delivery
  outcomes rather than freeze explanatory copy line by line.
- When a UI bug has no correct automated seam, improve the seam or reproduce and accept it through
  isolated smoke. Do not substitute source-reading regular-expression assertions for real DOM, event
  chain, or runtime verification.

## Development configuration safety boundaries

Production userData (`~/Library/Application Support/git-leaf` by default on macOS) is user data, not a
test fixture.

- Agent-driven automation, UI smoke, screenshots, and scripted clicks must never use production
  userData. On macOS, always run `make smoke-dev-mac`. Do not substitute an unisolated
  `npm run desktop`, `open /Applications/Git\ Leaf.app`, or `make install-dev-mac` for smoke.
- Isolated launch logs must show the temporary userData path for that run. Without this evidence, stop
  the smoke; do not try the production application as a fallback.
- Human use of either the formal or development build reads and writes the same real Profile. Do not
  append a development suffix or pass an isolated user-data argument merely because a build is marked
  `dev`.
- Treat the real Profile as read-only during Agent automation. Do not write to it, copy smoke changes
  back to it, or clean it unless the user explicitly asks to repair or migrate real configuration.
- Never "restore" configuration from defaults, the current normalized result, or memory. After isolated
  smoke, delete only the temporary configuration. If production configuration is touched accidentally,
  stop the relevant processes and preserve the evidence. Report the affected files and fields before
  taking further action, and repair them only with explicit user authorization and a reliable source for
  the correct values.
- Configuration schema migrations must be idempotent and preserve existing repository lists, workspace
  sessions, appearance, and unrelated values. A parse failure must not continue by writing an empty
  configuration. Migration tests must use temporary userData and cover both legacy fixtures and a fresh
  installation.
- Verify migration logic with temporary fixtures first. A real legacy Profile migration additionally
  requires an explicit user request, a stopped App, validated source and target markers, and rollback
  backups before any in-place change.

## Documentation links in responses

- When a response needs to link to a Markdown or MDX document in a Git repository, provide a clickable
  Git Leaf HTTPS link by default. Do not provide only an absolute local path, a `file://` URL, or a GitHub
  blob link.
- Always generate the link with `scripts/generate-open-link.mjs`; do not assemble repository, path, or
  worktree parameters manually:

```bash
node <git-leaf-repo>/scripts/generate-open-link.mjs \
  --repo-root "$(git rev-parse --show-toplevel)" \
  --file "<repo-relative.md-or-mdx>"
```

- Links generated from the primary worktree can be shared with colleagues. Linked-worktree links are
  local to the machine that created them.
- Use the response copy `Open in Git Leaf: <document title>`. Use a GitHub source link only when the user
  explicitly requests one or a Git Leaf link cannot be generated, and explain the fallback.
- Do not launch Git Leaf or switch the user's current repository merely because a link was generated,
  unless the user explicitly asks.

## Git workflow

- Routine Git Leaf development does not use feature pull requests. Work directly in the primary checkout
  or use an additional worktree when isolation, parallelism, or the task calls for it.
- After changes in a worktree pass their checks, merge them directly into the primary checkout's `main`
  and push `main`; do not make a pull request part of delivery.
- If `origin/main` has advanced, synchronize safely and resolve conflicts before finishing checks,
  merging, and pushing. Do not stop with only a local commit or wait for another confirmation to push.
- Create a pull request only when the user explicitly requests the PR workflow.

## Non-bypassable boundaries

- User-visible capabilities use the English `README.md` and Simplified Chinese `README.zh-CN.md` as entry
  points. Cross-module behavior and boundaries are defined by `docs/architecture.md`. Do not copy
  feature lists or one-off implementation details into this file.
- Desktop and CLI/web entry points bind to localhost only. No change may expose repository content,
  editing endpoints, or local paths to the LAN or public internet.
- File-tree display preferences must not change Git file discovery, status, or sync scope. Ordinary deep
  links and share links must not expand beyond Markdown and MDX.
- Git Leaf does not rewrite diverged history automatically, bypass conflicts or in-progress Git
  operations, or permit any write path to bypass protective branch creation for a detached worktree.
- Sharing, updates, telemetry, and development configuration are security boundaries. Read the
  corresponding architecture or specification before changing them and add contract tests.

## Code constraints

- Preserve the existing Node, Electron, CodeMirror, and markdown-it architecture where possible. Do not
  introduce a new framework for a small feature.
- MDX supports only allowlisted MDX-lite components. It must not execute arbitrary JSX, imports, scripts,
  or event-handler code.
- Do not copy facts from a target content repository into this repository. Read the source files in the
  repository selected by the user when content verification is required.
- Do not commit `node_modules/`, `dist/`, local absolute paths, or one-off debugging artifacts.
- Do not write files on a detached HEAD. Every write entry point must first pass through the protective
  branch-creation boundary.
- Changes to desktop repository selection, desktop home, navigation interception, or environment checks
  require corresponding `desktop-*` or `git-environment` regression tests.
- Changes to worktrees, local editing, repository switching, Git synchronization, or Source/Live
  writeback require regression tests.
