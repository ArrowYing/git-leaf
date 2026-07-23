import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { normalizeGeneratedText } from "../scripts/build-client.mjs";

test("client bundle normalization removes trailing spaces without changing line endings", () => {
  assert.equal(
    normalizeGeneratedText("const value = 1;  \n  \nnext();\t\r\n"),
    "const value = 1;\n\nnext();\r\n",
  );
});

test("npm build:client uses the cross-platform client build wrapper", async () => {
  const packageJson = JSON.parse(await readFile(
    path.join(import.meta.dirname, "..", "package.json"),
    "utf8",
  ));
  assert.equal(packageJson.scripts["build:client"], "node scripts/build-client.mjs");
});
