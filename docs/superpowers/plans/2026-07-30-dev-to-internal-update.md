# Development-to-Internal Update Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Let a packaged macOS `source` development build discover and install the latest `internal-stable` official build, including an equal-version build, while preserving the two existing Bundle IDs and enabling the installed internal build's packaged analytics default exactly once.

**Architecture:** Add one explicit `dev-to-internal` transition contract shared by discovery, direct artifact preparation, and persisted receipts. The ordinary public/internal Squirrel updater remains strictly newer-version-only. The dev client downloads the exact internal ZIP bound by `latest.json`, verifies its checksum, official signature, Bundle ID, and complete embedded build identity, then hands it to a detached nonprivileged `Contents` helper. After the dev process exits, an exact receipt match atomically removes the receipt and the dev build's explicit analytics value so even the already-published internal `1.16.0` package applies its embedded `usageAnalyticsDefault=true` on launch. Replacement or relaunch failure restores both the App and configuration transaction.

**Tech Stack:** Node.js ESM, Electron, macOS `ditto` and `codesign`, transactional `Contents` replacement, `node:test`.

> Execution correction, 2026-07-30: the initial Tasks 1–5 below record the first Squirrel-based
> hypothesis. Packaged execution proved that a source App whose patched Squirrel framework had not
> been re-signed is terminated by macOS code-signing enforcement, and Squirrel's current-signature
> requirement is not the correct cross-Bundle-ID boundary. The implemented path therefore supersedes
> the feed-query/server exception and dev-Squirrel steps: source packages are ad-hoc signed for local
> integrity, dev downloads and verifies the manifest ZIP directly, and a detached nonprivileged helper
> performs the receipt-gated transactional replacement. Native `ditto` preserves the signed App during
> extraction, concurrent retries share one preparation, and the helper excludes itself while waiting
> for the old App process tree. The update server remains unchanged.

---

### Task 1: Define the bounded handoff contract

**Files:**

- Create: `src/desktop/development-handoff.mjs`
- Create: `test/development-handoff.test.mjs`
- Modify: `src/desktop/app-updates.mjs`
- Test: `test/desktop-app-updates.test.mjs`

- [ ] **Step 1: Write failing contract tests**

Add tests proving that only a packaged macOS build with all three source markers is eligible:

```js
const sourceBuild = {
  version: "1.16.0",
  buildId: "abc123.20260730T010000Z.source",
  commit: "abc123",
  dev: true,
  distribution: "source",
  releaseTrack: "source",
};

assert.deepEqual(developmentHandoffTarget({
  buildInfo: sourceBuild,
  isPackaged: true,
  platform: "darwin",
  arch: "arm64",
}), {
  kind: "dev-to-internal",
  releaseTrack: "internal",
  channel: "internal-stable",
  platform: "darwin-universal",
});
```

Cover rejection of unpackaged, Windows, `dev: false`, non-source distribution, and non-source track builds. Add receipt tests for all required target fields (`version`, `buildId`, `commit`, `releaseTrack`, `channel`, `platform`) and exact matching against an official, non-dev internal build.

Extend the feed URL test to require an encoded handoff query:

```js
assert.equal(macAutoUpdaterFeedUrl({
  currentVersion: "1.16.0",
  handoff: receipt,
}), "https://updates.mangofuture.com/git-leaf/internal-stable/darwin-universal/releases/1.16.0"
  + "?transition=dev-to-internal&targetVersion=1.16.0&targetBuildId=...&targetCommit=...");
```

- [ ] **Step 2: Run the focused tests and verify the new imports/assertions fail**

Run:

```bash
node --test test/development-handoff.test.mjs test/desktop-app-updates.test.mjs
```

Expected: failure because the handoff module and URL option do not exist.

- [ ] **Step 3: Implement the pure transition helpers**

Export:

```js
export const DEVELOPMENT_HANDOFF_KIND = "dev-to-internal";
export const DEVELOPMENT_HANDOFF_RELEASE_TRACK = "internal";
export const DEVELOPMENT_HANDOFF_CHANNEL = "internal-stable";

export function developmentHandoffTarget(options) {}
export function developmentHandoffReceiptForManifest({ manifest }) {}
export function normalizeDevelopmentHandoffReceipt(value) {}
export function developmentHandoffReceiptMatchesBuild({ receipt, buildInfo }) {}
export function developmentHandoffVersionAvailable({ currentVersion, targetVersion }) {}
```

`developmentHandoffVersionAvailable` must use `compareAppVersions(targetVersion, currentVersion) >= 0`; receipt construction must fail closed when any identity field is absent. Extend `macAutoUpdaterFeedUrl` to append the transition query only for a normalized receipt.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test test/development-handoff.test.mjs test/desktop-app-updates.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/development-handoff.mjs src/desktop/app-updates.mjs test/development-handoff.test.mjs test/desktop-app-updates.test.mjs
git commit -m "feat: define development handoff contract"
```

### Task 2: Persist and prepare the analytics handoff atomically

**Files:**

- Modify: `src/desktop/config.mjs`
- Modify: `src/desktop/main.mjs`
- Test: `test/desktop-config.test.mjs`
- Test: `test/usage-analytics-setting.test.mjs`

- [ ] **Step 1: Write failing configuration tests**

Use temporary user-data directories to prove:

1. `saveDesktopDevelopmentHandoff` persists the normalized receipt without changing repository, session, appearance, or analytics fields.
2. `prepareDesktopDevelopmentHandoffInstallation` requires the exact version/build ID/commit/track/channel/platform receipt selected by the user.
3. A matching preparation removes both `usageAnalyticsEnabled` and the receipt in the same atomic config mutation, allowing the existing internal package to apply its embedded default.
4. Missing/mismatched receipts leave both analytics and the receipt unchanged and prevent installation.
5. Ordinary internal upgrades without a receipt preserve a user's existing analytics choice.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
node --test test/desktop-config.test.mjs test/usage-analytics-setting.test.mjs
```

Expected: failure because receipt persistence/completion exports are absent.

- [ ] **Step 3: Implement atomic persistence and install ordering**

Add top-level `developmentHandoff` normalization to desktop config without placing it in UI preferences. Export:

```js
export async function saveDesktopDevelopmentHandoff({
  userDataDir,
  handoff,
  repoRoot,
}) {}

export async function prepareDesktopDevelopmentHandoffInstallation({
  userDataDir,
  handoff,
  repoRoot,
}) {}
```

Both functions must reuse the existing atomic config mutation path. The final implementation invokes
preparation from the detached helper after the dev process exits and before transactional `Contents`
replacement; replacement failure restores the captured configuration state.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test test/desktop-config.test.mjs test/usage-analytics-setting.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/config.mjs src/desktop/main.mjs test/desktop-config.test.mjs test/usage-analytics-setting.test.mjs
git commit -m "feat: apply internal analytics handoff"
```

### Task 3: Enable opt-in discovery and download from packaged dev builds

**Files:**

- Modify: `src/desktop/updates.mjs`
- Modify: `src/desktop/main.mjs`
- Modify: `src/desktop/localization.mjs`
- Modify: `test/desktop-updates.test.mjs`
- Modify: `test/desktop-main.test.mjs`
- Modify: `test/desktop-localization.test.mjs`

- [ ] **Step 1: Replace the old development-disable tests with failing handoff tests**

Cover:

- A packaged source dev build always reads `internal-stable`, ignoring environment channel overrides.
- `1.16.0 dev` reports `1.16.0 internal` as available.
- An older internal target is reported as current and is never downloaded.
- Automatic checks fetch metadata only.
- The first user action saves the complete receipt before downloading and inspecting the manifest ZIP.
- A receipt write failure prevents the download.
- Restart restoration requires the complete matching receipt rather than version-only preferences.
- Community builds with `dev: false` remain disabled.
- Unpackaged dev mode remains disabled.
- Menus and Settings expose update actions for eligible packaged dev builds.

Use manifests that include:

```js
{
  version: "1.16.0",
  buildId: "2c3e9d8cfcfb.20260728T235326Z.internal",
  commit: "2c3e9d8cfcfb",
  releaseTrack: "internal",
  channel: "internal-stable",
  platform: "darwin-universal",
}
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
node --test test/desktop-updates.test.mjs test/desktop-main.test.mjs test/desktop-localization.test.mjs
```

Expected: old tests still disable dev builds and equal versions are treated as current.

- [ ] **Step 3: Wire the handoff into the updater**

Compute an optional `handoffTarget` once in `createDesktopUpdateController`. When present:

- derive release track/channel from the target;
- validate the internal manifest identity;
- accept `target >= current`;
- attach the normalized receipt to pending state;
- persist that receipt before any download call;
- prepare only the checksum-bound ZIP in the validated internal manifest;
- restore only from a matching persisted receipt;
- atomically prepare the matching receipt before the real install call;
- use explicit handoff copy such as “Switch to the internal build” for equal-version availability.

Keep all ordinary official builds on strict `target > current`. Add `getDevelopmentHandoff` and `saveDevelopmentHandoff` controller callbacks and wire them to config in `main.mjs`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test test/desktop-updates.test.mjs test/desktop-main.test.mjs test/desktop-localization.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/updates.mjs src/desktop/main.mjs src/desktop/localization.mjs test/desktop-updates.test.mjs test/desktop-main.test.mjs test/desktop-localization.test.mjs
git commit -m "feat: let dev builds switch to internal"
```

### Task 4: Superseded identity-bound equal-version macOS feed

Packaged diagnosis made this server change unnecessary. It was removed: ordinary Squirrel feeds remain
strictly newer-version-only, and the handoff prepares the exact artifact from `latest.json` directly.

**Files:**

- Modify: `scripts/gitleaf-update-server.py`
- Modify: `test/gitleaf-update-server.test.mjs`

- [ ] **Step 1: Add failing server route tests**

For an `internal-stable` `1.16.0` manifest, prove:

- ordinary `/releases/1.16.0` returns `204`;
- a complete matching `dev-to-internal` query returns `200`;
- wrong kind/version/build ID/commit returns `204`;
- a handoff query against `stable`, another platform, or a non-internal manifest returns `204`;
- an older target always returns `204`;
- normal newer-version behavior remains `200`.

- [ ] **Step 2: Run the focused server tests and verify failure**

Run:

```bash
node --test test/gitleaf-update-server.test.mjs
```

Expected: equal-version requests still return `204`.

- [ ] **Step 3: Implement the narrow server exception**

Parse the feed URL query and permit equality only when all of these match the loaded manifest:

```py
transition == "dev-to-internal"
channel == "internal-stable"
platform_key == "darwin-universal"
manifest["releaseTrack"] == "internal"
manifest["channel"] == channel
manifest["platform"] == platform_key
targetVersion == manifest["version"]
targetBuildId == manifest["buildId"]
targetCommit == manifest["commit"]
```

Never permit `manifest.version < current_version`.

- [ ] **Step 4: Run the server tests**

Run:

```bash
node --test test/gitleaf-update-server.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/gitleaf-update-server.py test/gitleaf-update-server.test.mjs
git commit -m "feat: serve identity-bound dev handoffs"
```

### Task 5: Add the nonprivileged bridge and real packaged regression

**Files:**

- Modify: `src/desktop/mac-update-installation.mjs`
- Modify: `test/mac-update-installation.test.mjs`
- Create: `scripts/mac-development-handoff-regression.mjs`
- Create: `test/mac-development-handoff-regression.test.mjs`
- Modify: `package.json`
- Modify: `Makefile`

- [ ] **Step 1: Write failing policy and harness tests**

Change the Squirrel policy expectation so an eligible packaged source dev build enables direct `Contents` replacement, while unpackaged, non-mac, and non-eligible source builds remain disabled.

Add pure harness tests for:

- validating a local dev app as `org.gitleaf.community`, `dev: true`, `source`;
- validating the target as `com.mangofuture.gitleaf`, non-dev, official/internal;
- requiring equal versions and exact receipt identity;
- requiring the expected Developer ID signature, preserved app-directory inode, no privileged ShipIt job, analytics enabled after first target launch, consumed receipt, official `git-leaf://` resolution, unchanged real Profile/cache, and isolated cleanup.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
node --test test/mac-update-installation.test.mjs test/mac-development-handoff-regression.test.mjs
```

Expected: the dev bridge path and harness do not exist.

- [ ] **Step 3: Implement the isolated regression harness**

Add `npm run verify:dev-handoff:mac` / `make verify-dev-handoff-mac`. The harness must:

1. Refuse to run if the production app or either ShipIt job is active.
2. Fingerprint the real Profile and real ShipIt cache.
3. Package the current source dev build into an isolated installation.
4. Download and validate the current `internal-stable` signed ZIP.
5. Rewrite that manifest into a temporary local update root served by the repository Python server.
6. Launch the ad-hoc-signed dev app with isolated `HOME`, `TMPDIR`, and `userData`.
7. Drive the real Settings update action through the renderer.
8. Confirm install preparation consumes the receipt and explicit dev analytics value, then the installed app switches Bundle ID, retains the directory inode, applies its packaged analytics default, and initializes telemetry.
9. Remove only temporary state and prove the real Profile/cache fingerprints are unchanged.

The harness output must be a JSON evidence file created with `wx`, not a committed artifact.

- [ ] **Step 4: Run the packaged regression**

Run:

```bash
evidence_dir="$(mktemp -d /tmp/git-leaf-dev-handoff.XXXXXX)"
npm run verify:dev-handoff:mac -- \
  --output "$evidence_dir/evidence.json" \
  --allow-visible-app
```

Expected: real packaged equal-version handoff passes with isolated state. The explicit flag acknowledges
that the isolated temporary App is still visible on the current desktop; the harness clicks each
transition action only once and must never automate a restart loop.

- [ ] **Step 5: Commit**

```bash
git add src/desktop/mac-update-installation.mjs test/mac-update-installation.test.mjs scripts/mac-development-handoff-regression.mjs test/mac-development-handoff-regression.test.mjs package.json Makefile
git commit -m "test: verify packaged dev handoff"
```

### Task 6: Update product and release documentation

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/architecture.md`
- Modify: `docs/release.md`
- Modify: `docs/build-from-source.md`

- [ ] **Step 1: Update user-visible boundaries**

Document that:

- there are still two official release tracks and two Bundle IDs, not a third release;
- Community builds do not receive official updates;
- only locally packaged `Git Leaf dev` builds may opt into the internal official build;
- equal-version switching is intentional;
- the switch adopts the internal package's analytics default;
- ordinary future internal upgrades preserve the user's analytics choice.

- [ ] **Step 2: Update release and architecture contracts**

Document the identity-bound receipt, direct artifact verification, helper install ordering,
target-default initialization, non-downgrade rule, and mandatory packaged regression. Keep
`docs/release.md` as the release-policy source and do not duplicate the controller stages.

- [ ] **Step 3: Run documentation checks**

Run:

```bash
npm run docs:check
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add README.md README.zh-CN.md docs/architecture.md docs/release.md docs/build-from-source.md
git commit -m "docs: explain development handoff"
```

### Task 7: Full verification, delivery, and development installation

**Files:**

- Verify all modified files.
- Do not modify the formal release ledger, stable manifests, tags, or production update host.

- [ ] **Step 1: Run the core and complete macOS gates**

Run:

```bash
npm test
npm run test:all
npm run test:ci:mac
npm run docs:check
```

Expected: all pass.

- [ ] **Step 2: Review the final diff and repository state**

Run:

```bash
git diff --check
git status --short
git log --oneline --decorate -8
```

Expected: no uncommitted changes and only intentional commits ahead of `origin/main`.

- [ ] **Step 3: Push `main`**

Run:

```bash
git push origin main
```

Expected: remote `main` advances to the verified implementation commit.

- [ ] **Step 4: Install the requested local development build**

Run:

```bash
make install-dev-mac
```

Expected: `/Applications/Git Leaf.app` is replaced by a packaged `1.16.0` source/dev build with Bundle ID `org.gitleaf.community`, using the existing real human Profile.

- [ ] **Step 5: Verify the installed development identity without automating the real Profile**

Run:

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' '/Applications/Git Leaf.app/Contents/Info.plist'
node -e 'const fs=require("fs"); console.log(JSON.parse(fs.readFileSync("/Applications/Git Leaf.app/Contents/Resources/app/git-leaf-build-info.json","utf8")))'
```

Expected: community Bundle ID, `dev: true`, `distribution: "source"`, `releaseTrack: "source"`. Do not script UI interaction against the installed app.
