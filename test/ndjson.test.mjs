import assert from "node:assert/strict";
import test from "node:test";

import { parseNdjsonRecords } from "../public/ndjson.js";

test("parseNdjsonRecords preserves physical line references and parses one JSON value per line", () => {
  const result = parseNdjsonRecords([
    '{"id":"first","nested":{"note":"a long value"}}',
    "",
    '[1,2,3]',
    "true",
    "",
  ].join("\r\n"));

  assert.equal(result.invalidCount, 0);
  assert.deepEqual(result.records, [
    {
      line: 1,
      valid: true,
      value: { id: "first", nested: { note: "a long value" } },
    },
    { line: 3, valid: true, value: [1, 2, 3] },
    { line: 4, valid: true, value: true },
  ]);
});

test("parseNdjsonRecords keeps invalid lines verbatim without hiding valid records", () => {
  const result = parseNdjsonRecords('\uFEFF{"ok":true}\n  {broken json}  \n{"still_ok":2}\n');

  assert.equal(result.invalidCount, 1);
  assert.deepEqual(result.records, [
    { line: 1, valid: true, value: { ok: true } },
    { line: 2, valid: false, raw: "  {broken json}  " },
    { line: 3, valid: true, value: { still_ok: 2 } },
  ]);
});

test("parseNdjsonRecords treats whitespace-only content as an empty record set", () => {
  assert.deepEqual(parseNdjsonRecords(" \n\t\n"), {
    records: [],
    invalidCount: 0,
  });
});
