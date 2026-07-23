# Git Leaf release process

This document defines the public release contract. Mango Future's host names, deployment directories, credentials, and private release profiles are maintained outside this repository.

## Build identities

Every packaged app contains `git-leaf-build-info.json` with two independent fields:

```json
{
  "distribution": "source",
  "usageAnalyticsDefault": false
}
```

Supported values:

| Field | Value | Meaning |
| --- | --- | --- |
| `distribution` | `source` | Community or local source build; official updates are disabled |
| `distribution` | `official` | Mango Future release build; official updates can be enabled |
| `usageAnalyticsDefault` | `false` | New installations start with usage analytics disabled |
| `usageAnalyticsDefault` | `true` | Company-managed bootstrap package initializes analytics as enabled |

The safe default is always `source + false`. Build metadata is informational and can be changed by anyone compiling the source. Official identity is established by the Mango Future code signature, official download channel, SHA-256, release tag, and matching public commit.

The build default is used only when initializing a new local setting. Once `usageAnalyticsEnabled` exists in userData, an update must preserve it.

Telemetry event fields, version capability boundaries, privacy requirements, storage, and retention rules are defined only by `docs/app-usage-analytics-spec.md`.

## Local release profile

Company release commands read a JSON file selected by an absolute path:

```bash
export GIT_LEAF_RELEASE_PROFILE="/absolute/path/to/git-leaf-official-public.json"
```

The public shape is illustrated by [docs/release-profile.example.json](docs/release-profile.example.json). The real profile is not stored in this repository. It may contain non-secret environment parameters, but it must never contain:

- Apple credentials or private keys;
- SSH private keys or tokens;
- server passwords;
- signing certificates in exportable form.

Normal `package:mac`, `package:win`, and `portable:win` commands work without a profile and produce source builds. Signing, publication, stable update staging, and release tagging fail unless an official profile is supplied.

## Verification

Before preparing a release:

```bash
npm ci
npm test
npm run docs:check
npm run test:all
npm run test:ci:mac
npm run test:ci:win
```

If `src/client/source-editor.mjs` changed, also run:

```bash
npm run build:client
```

For Settings, About, Help, Preview, or Live UI changes on macOS, run the isolated smoke workflow:

```bash
make smoke-dev-mac
```

The smoke profile must be temporary and must not write to the production userData directory.

## Source packages

Community builds:

```bash
npm run package:mac
npm run package:win
```

Verify that packaged `git-leaf-build-info.json` contains:

```json
{
  "distribution": "source",
  "usageAnalyticsDefault": false
}
```

A source build must not query or download from Mango Future's stable update service and must not create telemetry state or send telemetry requests.

## Official packages

Mango Future maintainers use the frozen release worktree controller:

```bash
npm run release:prepare
eval "$(node scripts/release-worktree.mjs env)"
node "$RELEASE_WORKTREE/scripts/release-worktree.mjs" status --remote
```

All artifacts, manifests, checksums, and tags for one release must originate from the same frozen `RELEASE_COMMIT`. Candidate artifacts are inspected before stable publication. A version tag is created only after macOS and Windows stable artifacts have been verified and published.

The official public profile must produce:

```json
{
  "distribution": "official",
  "usageAnalyticsDefault": false
}
```

The internal bootstrap profile may produce `official + true`, but that artifact is not the public download. Its SHA-256 must be recorded separately. Later public stable updates must preserve the local enabled state of existing internal installations.

## Platform status

- macOS official releases use Mango Future's Developer ID signature and notarization.
- Windows is currently distributed as an unsigned Preview ZIP. Documentation and download surfaces must state this plainly until Authenticode signing is implemented.
- Official builds may use Mango Future's stable update service.
- Source builds never join the official stable update channel.

## Package inspection

Before publication:

1. Run a secret scanner over all tracked candidate files.
2. Search for private repository names, personal paths, private email addresses, internal IPs, host aliases, server directories, and release credentials.
3. Build macOS and Windows candidates.
4. Inspect the DMG, ZIP, and `app.asar` file lists and text content.
5. Confirm packages exclude `marketing/`, `test/`, `dist/`, `.git/`, release profiles, signing material, and internal operations documents.
6. Verify source, official public, and internal bootstrap behavior independently.
7. Confirm manifest, SHA-256, tag, and public commit correspondence.

## Versioning

`package.json` is the user-visible app version. Do not reuse an existing release version or tag for new artifacts.

- `MAJOR`: incompatible runtime, update, data, or configuration changes.
- `MINOR`: new user-visible capabilities without breaking existing workflows.
- `PATCH`: fixes, small UX improvements, packaging corrections, and release-process fixes.

The formal release controller is the only supported path for publishing Mango Future stable artifacts.
