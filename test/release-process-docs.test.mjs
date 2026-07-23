import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release documentation exposes the public build and publication boundaries", async () => {
  const releaseDoc = await readFile("release.md", "utf8");
  const exampleProfile = JSON.parse(
    await readFile("docs/release-profile.example.json", "utf8"),
  );

  assert.match(releaseDoc, /safe default is always `source \+ false`/);
  assert.match(releaseDoc, /source build must not query or download from Mango Future's stable update service/);
  assert.match(
    releaseDoc,
    /`usageAnalyticsDefault` \| `false` \| New installations start with usage analytics disabled/,
  );
  assert.match(releaseDoc, /must preserve it/);
  assert.match(releaseDoc, /frozen release worktree controller/);
  assert.match(releaseDoc, /same frozen `RELEASE_COMMIT`/);
  assert.match(releaseDoc, /Windows is currently distributed as an unsigned Preview ZIP/);
  assert.match(releaseDoc, /secret scanner/);
  assert.match(releaseDoc, /packages exclude `marketing\/`, `test\/`, `dist\/`, `\.git\/`/);
  assert.match(releaseDoc, /must never contain:[\s\S]*Apple credentials or private keys/);
  assert.doesNotMatch(
    releaseDoc,
    /unlock-keychain -p|UPDATE_REMOTE_HOST="/,
  );

  assert.equal(exampleProfile.distribution, "official");
  assert.equal(exampleProfile.usageAnalyticsDefault, false);
  assert.match(exampleProfile.updateRemoteRoot, /^\/srv\//);
});
