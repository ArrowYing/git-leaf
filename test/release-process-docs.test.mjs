import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release documentation exposes the dual-track build and publication boundaries", async () => {
  const releaseDoc = await readFile("release.md", "utf8");
  const exampleProfile = JSON.parse(
    await readFile("docs/release-profile.example.json", "utf8"),
  );

  assert.match(releaseDoc, /safe default is always `source \+ source \+ false`/);
  assert.match(releaseDoc, /source build must not query or download from Mango Future's update service/);
  assert.match(releaseDoc, /`official \+ public` \| `stable` \| `false`/);
  assert.match(releaseDoc, /`official \+ internal` \| `internal-stable` \| `true`/);
  assert.match(releaseDoc, /Versions and Git tags are global across both official tracks/);
  assert.match(releaseDoc, /never reuse one version for public and internal builds/);
  assert.match(
    releaseDoc,
    /a packaged app trusts its embedded track and cannot be moved to another track by an environment variable/,
  );
  assert.match(releaseDoc, /must preserve it/);
  assert.match(releaseDoc, /frozen release worktree controller/);
  assert.match(releaseDoc, /same frozen `RELEASE_COMMIT`/);
  assert.match(releaseDoc, /--track internal/);
  assert.match(releaseDoc, /internal-candidate/);
  assert.match(releaseDoc, /internal-stable/);
  assert.match(releaseDoc, /Internal 1\.11\.3 migration bridge/);
  assert.match(releaseDoc, /mark-public-download-isolation-verified/);
  assert.match(releaseDoc, /exact same signed internal artifacts to legacy `stable`/);
  assert.match(releaseDoc, /public `\/open` download page must ignore internal manifests/);
  assert.match(releaseDoc, /legacyInternalMigrationConfirmed/);
  assert.match(releaseDoc, /Windows is currently distributed as an unsigned Preview ZIP/);
  assert.match(releaseDoc, /secret scanner/);
  assert.match(releaseDoc, /packages exclude `marketing\/`, `test\/`, `dist\/`, `\.git\/`/);
  assert.match(releaseDoc, /must never contain:[\s\S]*Apple credentials or private keys/);
  assert.doesNotMatch(
    releaseDoc,
    /unlock-keychain -p|UPDATE_REMOTE_HOST="/,
  );

  assert.equal(exampleProfile.distribution, "official");
  assert.equal(exampleProfile.releaseTrack, "public");
  assert.equal(exampleProfile.legacyInternalMigrationConfirmed, true);
  assert.equal(exampleProfile.usageAnalyticsDefault, false);
  assert.equal(exampleProfile.updateChannel, "stable");
  assert.match(exampleProfile.updateRemoteRoot, /^\/srv\//);
});
