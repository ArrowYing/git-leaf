import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("package-level Git Leaf command delegates to the app CLI", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(import.meta.dirname, "..", "package.json"), "utf8"),
  );

  assert.equal(packageJson.bin["git-leaf"], "src/cli.mjs");
});
