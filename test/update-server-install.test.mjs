import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("update service installer requires target-specific paths and keeps safe service permissions", async () => {
  const script = await readFile("scripts/install-openpeek-update-server.sh", "utf8");

  assert.match(script, /UPDATE_REMOTE_HOST:\?Set UPDATE_REMOTE_HOST/);
  assert.match(script, /UPDATE_REMOTE_ROOT:\?Set UPDATE_REMOTE_ROOT/);
  assert.match(script, /TELEMETRY_REMOTE_ROOT:\?Set TELEMETRY_REMOTE_ROOT/);
  assert.match(script, /UPDATE_BIND:\?Set UPDATE_BIND/);
  assert.match(script, /UPDATE_REMOTE_USER:\?Set UPDATE_REMOTE_USER/);
  assert.match(script, /UPDATE_REMOTE_BIN_DIR:\?Set UPDATE_REMOTE_BIN_DIR/);
  assert.doesNotMatch(script, /UPDATE_REMOTE_(?:HOST|ROOT):-/);
  assert.doesNotMatch(script, /TELEMETRY_REMOTE_ROOT:-/);
  assert.match(script, /SERVICE_NAME="\$\{UPDATE_SERVICE_NAME:-gitleaf-updates\.service\}"/);
  assert.match(script, /openpeek-update-server\.py/);
  assert.match(script, /--telemetry-root \$TELEMETRY_ROOT/);
  assert.match(script, /ReadWritePaths=\$REMOTE_ROOT \$TELEMETRY_ROOT/);
  assert.match(script, /systemctl enable/);
  assert.match(script, /systemctl restart/);
  assert.doesNotMatch(script, /app-updates/);
});
