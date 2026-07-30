# Development Build to Internal Release Handoff

Date: 2026-07-30
Status: Approved for implementation planning

## Problem

`make install-dev-mac` replaces `/Applications/Git Leaf.app` with a human-facing development build. The
development and official Apps intentionally share the real Electron Profile so repositories, workbench
sessions, favorites, language, appearance, and other preferences survive replacement.

The installed development build currently cannot return to an official release through the App updater:

- it is packaged as `dev=true, distribution=source, releaseTrack=source`;
- update checks are disabled for every development build;
- it uses the Community macOS Bundle ID, `org.gitleaf.community`;
- the internal release uses `distribution=official, releaseTrack=internal`, the
  `internal-stable` channel, and the official Bundle ID, `com.mangofuture.gitleaf`;
- update discovery requires the manifest version to be newer, so a `1.16.0` development build treats the
  official internal `1.16.0` package as current;
- the macOS release-feed endpoint also returns no package when the manifest version is equal to the
  caller's version;
- the development build writes its packaged analytics default (`false`) into the shared Profile, and the
  internal build preserves that value instead of applying its packaged default (`true`).

The desired outcome is a one-way, user-initiated handoff from a human development install to the
verified internal official release. It must work when the versions are equal and must enable usage
analytics after the official internal build starts.

## Goals

- Keep exactly two official release tracks: public and internal.
- Keep exactly two macOS Bundle IDs:
  - `org.gitleaf.community` for Community and source builds;
  - `com.mangofuture.gitleaf` for both public and internal official builds.
- Allow only a packaged human development build (`dev=true`) to hand off to `official + internal`.
- Allow the target internal version to be equal to or newer than the development version.
- Never allow a downgrade.
- Preserve the App directory, real Profile, repositories, sessions, and unrelated preferences.
- Apply the target internal App's packaged `usageAnalyticsDefault` during the verified handoff, making
  analytics enabled for the current internal contract.
- Return to ordinary internal update behavior after the handoff.
- Verify the real packaged macOS transition, including the Bundle ID change and same-version case,
  without running Agent automation against the real Profile.

## Non-goals

- No development-to-public handoff.
- No Community-to-official handoff when `dev` is not `true`.
- No public-to-internal or internal-to-public track switch.
- No update-track selector or environment-variable override in the packaged App.
- No third official release track, distribution, Bundle ID, or public download surface.
- No telemetry from a development, Community, test, CLI, Web, or CI build.
- No change to official release version ordering or the rule that one version belongs to one official
  track.
- No Windows development-install workflow in this change. The cross-platform state helpers may remain
  portable, but the acceptance target is the existing macOS human development install.

## Identity model

Public and internal official packages continue to share `com.mangofuture.gitleaf`, Mango Future's
publisher identity, and the official signing contract. Their differences remain embedded release track,
update channel, public visibility, and analytics default.

Community packages continue to use `org.gitleaf.community`, `distribution=source`,
`releaseTrack=source`, and `dev=false`. They must not query or download from Mango Future's update
service.

The human development install remains a source build with the Community Bundle ID, but `dev=true`
distinguishes it from a distributable Community package. The `dev` marker grants one capability only:
discover and accept a verified internal official handoff. It does not make the development build
official, enable telemetry, or place it on an enduring official release track.

Build metadata is forgeable and is not an access-control credential. The handoff is a product-routing
contract. If internal artifacts ever require confidentiality, the update service must enforce that
separately; the `dev` marker must not be presented as authorization.

## Chosen approach

Keep the current Community and official identities and implement a narrowly bounded cross-identity
handoff. Do not package the development build with the official Bundle ID.

The alternatives were rejected:

1. Packaging `make install-dev-mac` with `com.mangofuture.gitleaf` would reduce the number of identity
   changes during installation, but an unsigned local source package would occupy the official
   operating-system namespace before it became an official release.
2. Giving every build one Bundle ID would let Community packages collide with or appear to replace the
   official App and would weaken the open-source distribution boundary.
3. Adding a third development release track would duplicate a local build mode in release operations,
   manifests, versioning, and documentation without adding a user-facing release.

## Eligibility and target resolution

The updater derives a development handoff only when all of these current-build conditions hold:

- the App is packaged;
- `buildInfo.dev === true`;
- `buildInfo.distribution === "source"`;
- `buildInfo.releaseTrack === "source"`;
- the platform is macOS.

For this state, the effective handoff target is fixed in code:

- distribution: `official`;
- release track: `internal`;
- channel: `internal-stable`.

There is no configurable target and no environment-variable override in a packaged build. A source
build with `dev !== true` remains update-disabled.

After the internal package is installed, its embedded `dev=false, distribution=official,
releaseTrack=internal` identity takes over. All later checks use the ordinary `internal-stable` rules.

## Discovery and version rules

Normal official updates retain the strict rule:

```text
target version > current version
```

An eligible development handoff uses:

```text
target version >= current version
```

Equality is accepted only because the source and target identities differ. The manifest must match the
fixed `internal` track, `internal-stable` channel, current platform, and a valid target build ID and
commit. A lower target version remains rejected.

Update availability and persisted intent must be keyed by target identity, not version alone. The
minimum target identity is:

- transition kind: `dev-to-internal`;
- version;
- build ID;
- commit;
- release track;
- channel;
- platform.

This lets `1.16.0 source/dev` distinguish `1.16.0 official/internal` and prevents an existing
version-only preference from completing the wrong transition.

The update service's macOS feed must keep returning no package for ordinary equal-version requests. It
may return the equal-version internal package only for the explicit development-handoff request shape.
The client first validates `latest.json`; the feed response must remain bound to the same channel,
platform, version, and artifact. A feed race or identity mismatch fails before installation.

## User flow

The eligible development build participates in the normal metadata-check schedule. It may expose the
same Check for Updates entry as an official build, but the copy must describe an identity handoff when
the versions are equal, for example:

```text
Switch to the internal Git Leaf 1.16.0 release
```

Metadata discovery never starts a package download. The user must choose the update action, matching the
existing official update contract. After that choice:

1. Persist the complete target identity as the requested transition.
2. Download the exact internal package.
3. Preserve the request across an App restart or transient download failure.
4. When the package is ready, close the local service and windows through the normal update shutdown
   path.
5. Install by replacing the existing App's `Contents`, preserving the App directory inode.
6. Start the official internal build from the same App path and Profile.
7. Confirm the transition and apply its analytics semantics.

The development App remains update-disabled for every public, candidate, legacy, or environment-selected
channel.

## macOS installation and Bundle ID transition

The eligible development build must enable the existing direct-`Contents` installation policy before
starting the handoff. The updater must never request administrator credentials or start a privileged
ShipIt Helper.

The starting App has `org.gitleaf.community`. The installed signed package has
`com.mangofuture.gitleaf`. The handoff is successful only when the relaunched App proves:

- the App directory inode is unchanged;
- the embedded build identity exactly matches the requested internal target;
- the resulting Bundle ID is `com.mangofuture.gitleaf`;
- the result carries Mango Future's expected Developer ID identity;
- the packaged nonprivileged Squirrel policy is intact;
- no privileged ShipIt job was created;
- LaunchServices and `git-leaf://` resolve the resulting official App correctly.

Failure to replace or relaunch the target leaves the development installation retryable. Cleanup removes
only state owned by the attempted handoff.

## Transition receipt and analytics

`usageAnalyticsDefault` remains embedded in every package. Ordinary updates continue to treat it as an
initialization default and preserve an existing `usageAnalyticsEnabled` value.

The development-to-internal handoff is an explicit exception because it changes distribution identity.
Before installation, the development App persists a one-time transition receipt containing the complete
target identity. It does not change `usageAnalyticsEnabled` at that point and still cannot emit
telemetry.

On the first official App launch, before the telemetry client is initialized:

1. Read and validate the transition receipt.
2. Require the running build to be `dev=false, distribution=official, releaseTrack=internal`.
3. Require version, build ID, commit, channel, and platform to match the receipt.
4. Apply the running package's `usageAnalyticsDefault` to `usageAnalyticsEnabled`.
5. For the current internal contract, verify that the resulting value is `true`.
6. Remove the transition receipt atomically.
7. Initialize telemetry from the resulting enabled setting.

This handles Profiles in which the development build already persisted `false`. It also avoids changing
analytics when the download or installation has not completed.

Receipt handling must be idempotent. If the target App exits after applying the setting but before all
startup work completes, the next launch must still produce `usageAnalyticsEnabled=true` and a cleared
receipt. A missing, malformed, stale, or mismatched receipt never enables analytics and never changes
unrelated Profile data.

Ordinary `internal -> internal` updates do not create this receipt and continue to preserve the existing
analytics setting.

## Persistent state

The transition state belongs in the existing desktop configuration, not in a second Profile or a
standalone untracked marker. Its schema must:

- use bounded strings and an allowlisted transition kind;
- normalize or reject malformed objects;
- survive unrelated configuration mutations;
- be written atomically with the existing configuration writer;
- be removed only after a matching target applies the transition or an explicit bounded cleanup rule
  proves it can no longer match;
- never contain credentials, artifact bytes, local paths, repository data, or update-service secrets.

All repository lists, sessions, favorites, appearance, typography, language, sidebar state, and
unrelated configuration fields remain unchanged.

## Failure behavior

- Manifest, track, channel, platform, version, build ID, or commit mismatch: reject the handoff before
  download.
- Target version lower than the development version: report current or incompatible; never downgrade.
- Equal-version ordinary update without the development transition: return current.
- Network or download failure: retain a retryable identity-bound request without changing analytics.
- App shutdown failure: do not launch installation.
- Installation or relaunch failure: preserve the development App or its updater rollback behavior and
  retain enough bounded state to retry or diagnose.
- Receipt missing or malformed in the official App: do not change analytics.
- Receipt target does not match the running official build: do not change analytics.
- Analytics-setting write failure: fail closed for telemetry, preserve unrelated Profile state, and
  keep the transition recoverable.
- Cleanup failure: report it and preserve diagnostic state; never clean the real Profile broadly.

## Verification

### Contract tests

Add behavior-level tests that prove:

- Community packages remain unable to query official update channels.
- A packaged source development build resolves only `internal-stable`.
- Environment values cannot move the development target.
- Development discovery accepts a matching higher or equal internal version and rejects lower, public,
  candidate, legacy, wrong-platform, or malformed targets.
- Ordinary official discovery still requires a strictly newer version.
- Requested update state distinguishes equal versions by build ID and transition identity.
- Restored state cannot bypass development eligibility or manifest validation.
- The server returns an equal-version package only for the bounded internal development handoff.
- Direct-`Contents` installation is enabled only for official packages and the eligible development
  handoff.
- A matching receipt applies the packaged internal analytics default and is removed.
- Missing, malformed, stale, or mismatched receipts do not change analytics.
- Development builds remain telemetry-ineligible before installation.
- Ordinary internal updates continue to preserve an existing analytics value.
- Every configuration mutation preserves unrelated user state.

### Packaged macOS acceptance

Add a deterministic isolated packaged-App regression that starts from a development build produced from
the same version and commit as the internal target. It must use temporary HOME, userData, sessionData,
App location, update cache, and launch state. It must not automate the installed human App or write the
real Profile.

The production development build remains fixed to `internal-stable`. Before stable publication, the
regression may serve the exact verified candidate bytes through an isolated test feed that has the
production `internal-stable` request shape. This is test-harness dependency injection, not a packaged
channel override, and it must not add candidate-channel eligibility to the development App.

The regression must prove:

- starting identity: `dev=true, source, source`, `org.gitleaf.community`, telemetry off;
- target identity: `dev=false, official, internal`, `com.mangofuture.gitleaf`;
- source and target versions are equal;
- the exact published internal candidate artifact is used;
- the App directory inode is preserved;
- no administrator prompt or privileged ShipIt job appears;
- the official App relaunches from the same path;
- only the expected transition and analytics fields change in the isolated Profile;
- the receipt is removed and `usageAnalyticsEnabled` is true before telemetry initialization;
- repositories, workbench sessions, favorites, appearance, typography, language, and sidebar state are
  unchanged;
- LaunchServices, the App display identity, and `git-leaf://` resolve the official App;
- all temporary state is removed without touching the real Profile or real ShipIt cache.

Because this feature changes update, installation, package identity, and configuration behavior, the
next formal release containing it must require and pass the controller-backed macOS update regression.
The exact frozen commit must also pass the mandatory Windows Release Smoke even though this feature's
packaged handoff acceptance is macOS-specific.

### Repository checks

Implementation completion requires, at minimum:

```bash
npm test
npm run docs:check
npm run test:all
npm run test:ci:mac
```

Run the new isolated packaged transition regression after the internal candidate is published. Any
source-editor bundle or unrelated UI smoke is required only if those areas are changed.

## Documentation impact

Update the authoritative release and architecture documents to state:

- Community and human development builds are distinct even though both start from source identity;
- Community builds never use official updates;
- an installed human development build may hand off only to internal official;
- equal-version handoff is an identity transition, not an ordinary version update;
- the verified transition reapplies the internal package's analytics default once;
- public and internal official packages continue to share the official Bundle ID.

Update the user-facing build/privacy summary in both README languages if the resulting behavior is
stable and exposed in Settings. No example-knowledge-base content is needed because this is a desktop
installation and release-boundary change, not a repository workflow.
