# Git Leaf release process

This document defines the public release contract. Mango Future's host names, deployment directories, credentials, and private release profiles are maintained outside this repository.

## Release tracks and build identities

Every packaged app contains `git-leaf-build-info.json` with three independent fields:

```json
{
  "distribution": "source",
  "releaseTrack": "source",
  "usageAnalyticsDefault": false
}
```

Supported identities:

| Identity | Update channel | Analytics default | Purpose |
| --- | --- | --- | --- |
| `source + source` | none | `false` | Community or local source build |
| `official + public` | `stable` | `false` | Public Mango Future release |
| `official + internal` | `internal-stable` | `true` | Company-internal Mango Future release |

`distribution` identifies the publisher class. `releaseTrack` identifies which official release lane an installed app follows. The two official tracks use separate manifests and artifacts; a packaged app trusts its embedded track and cannot be moved to another track by an environment variable.

The safe default is always `source + source + false`. Build metadata is informational and can be changed by anyone compiling the source. Official identity is established by the Mango Future code signature, official download channel, SHA-256, release tag, and matching public commit.

The analytics default is used only when initializing a new local setting. Once `usageAnalyticsEnabled` exists in userData, an update must preserve it. Release-track selection and telemetry eligibility are separate contracts: an internal official build remains an official stable build even though its update channel is `internal-stable`.

Telemetry event fields, version capability boundaries, privacy requirements, storage, and retention rules are defined only by `docs/app-usage-analytics-spec.zh-CN.md`.

## Versioning across tracks

`package.json` is the user-visible app version. Versions and Git tags are global across both official tracks:

- never reuse one version for public and internal builds;
- every new public or internal release must be newer than all previously published releases;
- an internal `1.11.3` release means the next public release must be at least `1.11.4`;
- one tag identifies one track-specific set of signed artifacts.

Use:

- `MAJOR` for incompatible runtime, update, data, or configuration changes;
- `MINOR` for new user-visible capabilities without breaking existing workflows;
- `PATCH` for fixes, small UX improvements, packaging corrections, and release-process fixes.

## Local release profiles

Company release commands require an absolute JSON profile path. The public shape is illustrated by [release-profile.example.json](release-profile.example.json); authoritative public and internal profiles live in the private operations repository.

An official profile must explicitly declare a matching track:

```json
{
  "distribution": "official",
  "releaseTrack": "public",
  "legacyInternalMigrationConfirmed": true,
  "usageAnalyticsDefault": false,
  "updateChannel": "stable"
}
```

or:

```json
{
  "distribution": "official",
  "releaseTrack": "internal",
  "usageAnalyticsDefault": true,
  "updateChannel": "internal-stable"
}
```

A release profile may contain non-secret environment parameters, but it must never contain:

- Apple credentials or private keys;
- SSH private keys or tokens;
- server passwords;
- signing certificates in exportable form.

The public profile's `legacyInternalMigrationConfirmed` flag is a reviewed operations gate, not a build default. It must remain `false` until company devices have completed the `1.11.2` to internal-track migration. Public `prepare` fails unless the frozen profile records `true`, preventing a later public release from replacing the legacy bridge prematurely.

Normal `package:mac`, `package:win`, and `portable:win` commands work without a profile and produce source builds. A formal package, signature, publication, or release tag fails unless the frozen official profile and track are present.

## Human and automation Profiles

The installed formal app and a development build installed for human use are the same `Git Leaf.app`.
They use the same real Electron Profile so replacing one build with the other preserves repositories,
workbench sessions, favorites, language, and preferences. Development build metadata still disables
production updates; it does not select a `git-leaf-dev` directory.

Agent-driven automated UI verification, when run as a separate development task, is the only macOS flow
that selects another Profile. It creates a one-time snapshot of the real Profile, passes its temporary
path explicitly as both `userData` and `sessionData`, verifies the real Profile after the App exits, and
then deletes only the snapshot. This automated UI verification remains outside the formal release gates.

The historical persistent `git-leaf-dev` Profile can be merged once, with the App closed, using:

```bash
npm run migrate:mac:legacy-human-profile -- --apply
```

The migration validates the legacy manual marker, backs up both Profiles, merges repository and
workbench state with the human development state taking precedence, and preserves the old directory as
an additional recovery source.

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

`npm run test:ci:win` is a local preflight check only. It cannot replace the Windows GitHub Actions
release gate described below because the formal gate requires evidence from a real GitHub-hosted Windows
runner for the exact frozen release commit.

If `src/client/source-editor.mjs` changed, also run:

```bash
npm run build:client
```

UI-specific acceptance for UI changes and user-reported UI bugs is governed by `AGENTS.md`. Complete that
acceptance in the development task before freezing the release commit. The formal release operator does
not repeat it.

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
  "releaseTrack": "source",
  "usageAnalyticsDefault": false
}
```

A source build must not query or download from Mango Future's update service and must not create telemetry state or send telemetry requests.

## Formal official release

### Authorization boundary

An explicit maintainer request to perform a formal release is standing authorization to execute the complete standard release workflow in this document without pausing for step-by-step confirmation. That authorization expressly includes:

- building and packaging the macOS and Windows artifacts;
- signing the macOS App and DMG, uploading the unreleased DMG to Apple's notary service, waiting for the result, and stapling the ticket;
- publishing candidate, stable, and documented migration-bridge artifacts to the configured update server;
- downloading and verifying published artifacts, and running any isolated update regression required by the release gate;
- retaining the verified final stable packages, manifests, and checksums in the source checkout's local release archive;
- creating and pushing the release tag, then finishing the release controller state.

**Do not ask the maintainer to confirm any of these standard steps again, including the upload to Apple for notarization.** Pause only when the requested target, version, or release profile is materially ambiguous; when an action falls outside this documented workflow; or when recovery would require destructive credential or user-data changes.

Mango Future maintainers use the frozen release worktree controller. Prepare from a clean `main` synchronized with `origin/main`:

```bash
npm run release:prepare -- \
  --track internal \
  --profile /absolute/path/to/official-internal.json \
  --require-update-regression "first internal track release and legacy migration"
```

`prepare` records the canonical profile path and SHA-256, clears ambient release overrides, freezes the track, commit, version, build ID, and timestamp, creates a detached release worktree, then runs `npm ci` and `test:all`. Every later command revalidates the frozen state.

Inspect status:

```bash
node scripts/release-worktree.mjs status --remote
```

Run the platform build pipelines from the controller:

```bash
node scripts/release-worktree.mjs run mac check-version
node scripts/release-worktree.mjs run mac check-prereqs
node scripts/release-worktree.mjs run mac test
node scripts/release-worktree.mjs run mac package
node scripts/release-worktree.mjs run mac sign
node scripts/release-worktree.mjs run mac dmg
node scripts/release-worktree.mjs run mac notarize
node scripts/release-worktree.mjs run mac staple
node scripts/release-worktree.mjs run mac zip
node scripts/release-worktree.mjs run mac verify
node scripts/release-worktree.mjs run mac stage-updates --channel candidate

node scripts/release-worktree.mjs run windows check-version
node scripts/release-worktree.mjs run windows test
node scripts/release-worktree.mjs run windows package
node scripts/release-worktree.mjs run windows zip
node scripts/release-worktree.mjs run windows verify
node scripts/release-worktree.mjs run windows stage-updates --channel candidate
```

For a public release, logical `candidate` and `stable` map to the physical `candidate` and `stable` channels. For an internal release they map to `internal-candidate` and `internal-stable`. Operators always pass the logical channel to the controller.

Publish both candidate platforms:

```bash
node scripts/release-worktree.mjs run mac publish-updates --channel candidate
node scripts/release-worktree.mjs run windows publish-updates --channel candidate
```

Verify candidate publication end to end before recording candidate verification:

- each online candidate manifest must match its local staged manifest exactly;
- every artifact must be read in full through its official HTTPS URL while streaming all bytes into a
  SHA-256 digest and byte count;
- that streaming check may run on a trusted Gateway C close to the update service and does not require
  copying the large artifact back to the release workstation;
- each resulting SHA-256 and size must match the online manifest, the local build artifact, and the exact
  file stored on Gateway C.

For macOS, verify embedded build identity, `codesign`, `stapler`, and Gatekeeper against the locally
retained immutable ZIP and DMG whose SHA-256 matches the bytes read through the official HTTPS URL.
Hash equality binds those local platform checks to the published artifact without a second large-file
transfer. These worktree-local files remain the source for the final local archive; `finish` must not
download another copy from the network.

Then record candidate verification:

```bash
node scripts/release-worktree.mjs mark-candidate-verified
```

### Windows GitHub Actions release gate

Every formal stable release requires a successful Windows GitHub Actions smoke run. This gate applies to
every macOS and Windows official stable publication; it is not risk-based, optional, or limited to
Windows-only changes.

The frozen `RELEASE_COMMIT` must have a `Windows Release Smoke` workflow run with all of the following
properties:

- the run has reached `completed` status with a `success` conclusion;
- the run belongs to the `MangoFuture1210/git-leaf` repository;
- the run uses `.github/workflows/windows-release-smoke.yml`;
- the run's head SHA exactly equals the frozen `RELEASE_COMMIT`;
- the run exposes a non-expired, non-empty smoke artifact whose name ends with that exact frozen commit.

Before publishing either platform to stable, record and verify the workflow evidence through the frozen
release controller:

```bash
node scripts/release-worktree.mjs verify-windows-release-smoke --run-id <RUN_ID>
```

The controller rejects stable publication when this evidence is missing, expired, empty, associated with
the wrong repository or workflow, or built from a different commit. A local `npm run test:ci:win` result
does not satisfy this gate.

Separately, update-sensitive changes can make the isolated real packaged-App update regression mandatory.
When `prepare` marks that regression as required, complete it before stable publication and record it:

```bash
node scripts/release-worktree.mjs mark-update-regression-verified
```

This regression verifies the installed App's upgrade mechanism with isolated userData. It is not a
general UI acceptance pass and remains an independent risk gate for the update mechanism.

Publish both stable platforms:

```bash
node scripts/release-worktree.mjs run mac publish-updates --channel stable
node scripts/release-worktree.mjs run windows publish-updates --channel stable
```

After online stable verification and any required migration bridge, create and push the tag and close the release:

```bash
node scripts/release-worktree.mjs tag
node scripts/release-worktree.mjs push-tag
node scripts/release-worktree.mjs finish
```

All artifacts, manifests, checksums, and tags for one release must originate from the same frozen `RELEASE_COMMIT`. Candidate artifacts are inspected before stable publication. A version tag is created only after macOS and Windows stable artifacts have been verified and published.

`finish` is also the local artifact-retention gate. Before removing the frozen worktree or release lock,
it must copy the exact final physical stable set to:

```text
dist/releases/v<version>/
```

The retained set contains the macOS universal DMG and ZIP, the Windows x64 ZIP, the stable
`latest.json` manifests and checksum files, and the macOS `releases.json` plus ARM migration manifests.
For a public release the physical stable channel is `stable`; for an internal release it is
`internal-stable`. Candidate files, the internal `1.11.3` legacy bridge, unpacked applications, and
temporary packaging directories are not part of this archive.

The controller revalidates manifest track, channel, platform, version, build ID, commit, stable artifact
URL coordinates, and the auto-updater ZIP URL, then reads every package in full and compares its SHA-256
and size with the stable manifest and checksum file. It verifies the copied bytes again and records
repository-relative paths, sizes, SHA-256 values, and official URLs in the release receipt. A missing or
mismatched file makes `finish` fail without deleting the release worktree or lock. A complete existing
archive may be reused only when every archived byte still matches; conflicting files are never
overwritten.

`dist/` remains Git-ignored and local-only. The archive is an operational handoff and recovery copy, not
source material to commit.

## Internal 1.11.3 migration bridge

The installed official `1.11.2` build predates release tracks and reads only the legacy public `stable` channel. The first internal-track release therefore uses a one-time bridge:

1. Publish and verify both platforms on `internal-candidate`.
2. Complete the real packaged-App update regression.
3. Publish and verify both platforms on `internal-stable`.
4. Deploy and verify the update server version that excludes internal manifests from `/open`, then record the live isolation check:

```bash
node scripts/release-worktree.mjs mark-public-download-isolation-verified
```

5. Publish the exact same signed internal artifacts to legacy `stable`:

```bash
node scripts/release-worktree.mjs run mac publish-updates --channel legacy-stable
node scripts/release-worktree.mjs run windows publish-updates --channel legacy-stable
```

The controller permits `legacy-stable` only for the internal `1.11.3` migration release, only for `publish-updates`, and only after both internal stable platforms, candidate gates, and the public-download isolation check have completed. It also refuses to tag or finish `1.11.3` until both legacy platform publishes are recorded.

The public `/open` download page must ignore internal manifests even while the bridge occupies `stable`. Do not publish a newer public build to legacy `stable` until the company migration is confirmed; lagging `1.11.2` installations would otherwise miss the bridge. After upgrading, the embedded `internal` track reads only `internal-stable`.

## Platform status

- macOS official releases use Mango Future's Developer ID signature and notarization.
- Windows is currently distributed as an unsigned Preview ZIP. Documentation and download surfaces must state this plainly until Authenticode signing is implemented.
- Public and internal official builds share the existing application identity and userData location so updates preserve repositories, sessions, and preferences.
- Human-installed development builds share that userData location too; only explicit Agent smoke uses a temporary Profile.
- Source builds never join an official update channel.

## Package inspection

Before publication:

1. Run a secret scanner over all tracked candidate files.
2. Search for private repository names, personal paths, private email addresses, internal IPs, host aliases, server directories, and release credentials.
3. Build macOS and Windows candidates.
4. Inspect the DMG, ZIP, and `app.asar` file lists and text content.
5. Confirm packages exclude `marketing/`, `test/`, `dist/`, `.git/`, release profiles, signing material, and internal operations documents.
6. Verify source, official public, and official internal behavior independently.
7. Confirm track, channel, manifest, SHA-256, tag, and public commit correspondence.

The formal release controller is the only supported path for publishing Mango Future official artifacts.
