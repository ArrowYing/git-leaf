import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  datasetDependencyFingerprint,
  loadDataset,
} from "../src/server/dataset-loader.mjs";

test("loadDataset validates a typed CSV contract without losing string identifiers", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-dataset-"));
  await mkdir(path.join(repoRoot, "reports", "data"), { recursive: true });
  await writeFile(path.join(repoRoot, "reports", "report.mdx"), "# Report\n");
  await writeFile(
    path.join(repoRoot, "reports", "data", "company.dataset.json"),
    JSON.stringify(datasetManifest()),
  );
  await writeFile(
    path.join(repoRoot, "reports", "data", "company.csv"),
    [
      "date,company_id,revenue,cash,orders,visits",
      "2026-01-01,001,10.5,20,1,2",
      "2026-01-02,001,12.5,25,2,4",
    ].join("\n"),
  );

  try {
    const loaded = await loadDataset({
      repoRoot,
      documentPath: "reports/report.mdx",
      datasetPath: "./data/company.dataset.json",
    });
    assert.equal(loaded.rows.length, 2);
    assert.equal(loaded.rows[0].company_id, "001");
    assert.equal(loaded.rows[0].revenue, 10.5);
    assert.equal(loaded.rows[0].conversion_rate, null);
    assert.equal(loaded.manifest.fields.at(-1).rollup.op, "ratioOfSums");
    assert.equal(loaded.sourcePath, "reports/data/company.csv");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("datasetDependencyFingerprint changes when the external source changes", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-dataset-fingerprint-"));
  await writeFile(path.join(repoRoot, "report.mdx"), "# Report\n");
  await writeFile(path.join(repoRoot, "company.dataset.json"), JSON.stringify(datasetManifest()));
  const dataPath = path.join(repoRoot, "company.csv");
  await writeFile(dataPath, "date,company_id,revenue,cash,orders,visits\n2026-01-01,001,1,1,1,2\n");

  try {
    const options = {
      repoRoot,
      documentPath: "report.mdx",
      datasetPaths: ["company.dataset.json"],
    };
    const before = await datasetDependencyFingerprint(options);
    await new Promise((resolve) => setTimeout(resolve, 8));
    await writeFile(dataPath, "date,company_id,revenue,cash,orders,visits\n2026-01-01,001,100,1,1,2\n");
    const after = await datasetDependencyFingerprint(options);
    assert.notEqual(after, before);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("loadDataset rejects paths that escape the current repository", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "git-leaf-dataset-boundary-"));
  const repoRoot = path.join(parent, "repo");
  await mkdir(repoRoot);
  await writeFile(path.join(repoRoot, "report.mdx"), "# Report\n");
  await writeFile(path.join(parent, "outside.dataset.json"), JSON.stringify(datasetManifest()));

  try {
    await assert.rejects(
      loadDataset({
        repoRoot,
        documentPath: "report.mdx",
        datasetPath: "../outside.dataset.json",
      }),
      /unavailable inside the current repository/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("loadDataset rejects source columns that the manifest does not define", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-dataset-contract-"));
  await writeFile(path.join(repoRoot, "report.mdx"), "# Report\n");
  await writeFile(path.join(repoRoot, "company.dataset.json"), JSON.stringify(datasetManifest()));
  await writeFile(
    path.join(repoRoot, "company.csv"),
    "date,company_id,revenue,cash,orders,visits,guess\n2026-01-01,001,1,1,1,2,no\n",
  );

  try {
    await assert.rejects(
      loadDataset({
        repoRoot,
        documentPath: "report.mdx",
        datasetPath: "company.dataset.json",
      }),
      /undefined field: guess/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("loadDataset accepts aligned weekly periods and rejects non-week-start rows", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-weekly-dataset-"));
  await writeFile(path.join(repoRoot, "report.mdx"), "# Report\n");
  await writeFile(
    path.join(repoRoot, "company.dataset.json"),
    JSON.stringify(datasetManifest({ sourceGranularity: "week" })),
  );
  const dataPath = path.join(repoRoot, "company.csv");
  await writeFile(
    dataPath,
    "date,company_id,revenue,cash,orders,visits\n2026-01-05,001,10,20,1,2\n2026-01-12,001,12,25,2,4\n",
  );

  try {
    const loaded = await loadDataset({
      repoRoot,
      documentPath: "report.mdx",
      datasetPath: "company.dataset.json",
    });
    assert.equal(loaded.manifest.time.sourceGranularity, "week");

    await writeFile(
      dataPath,
      "date,company_id,revenue,cash,orders,visits\n2026-01-06,001,10,20,1,2\n",
    );
    await assert.rejects(
      loadDataset({
        repoRoot,
        documentPath: "report.mdx",
        datasetPath: "company.dataset.json",
      }),
      /must be a monday week start/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("loadDataset requires an explicit source granularity", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-dataset-granularity-"));
  const manifest = datasetManifest();
  delete manifest.time.sourceGranularity;
  await writeFile(path.join(repoRoot, "report.mdx"), "# Report\n");
  await writeFile(path.join(repoRoot, "company.dataset.json"), JSON.stringify(manifest));
  await writeFile(
    path.join(repoRoot, "company.csv"),
    "date,company_id,revenue,cash,orders,visits\n2026-01-01,001,10,20,1,2\n",
  );

  try {
    await assert.rejects(
      loadDataset({
        repoRoot,
        documentPath: "report.mdx",
        datasetPath: "company.dataset.json",
      }),
      /sourceGranularity must be day, week, month, or quarter/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("loadDataset explicitly maps common spreadsheet-export columns", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-spreadsheet-dataset-"));
  await writeFile(path.join(repoRoot, "report.mdx"), "# Report\n");
  const manifest = datasetManifest({ sourceGranularity: "week" });
  manifest.skipBlankRows = true;
  manifest.fields = [
    { name: "date", type: "date", required: true, sourceColumn: 2 },
    {
      name: "users",
      type: "integer",
      rollup: "avg",
      sourceColumn: 3,
      numberFormat: "comma-grouped",
    },
  ];
  manifest.grain = ["date"];
  manifest.primaryKey = ["date"];
  await writeFile(path.join(repoRoot, "company.dataset.json"), JSON.stringify(manifest));
  await writeFile(
    path.join(repoRoot, "company.csv"),
    [
      'Date,Date,"活跃用户\nDB + 火山",Date,,',
      '2026-01,2026-01-05,"12,345",ignored,,',
      '2025-12,2025-12-28,,ignored,,',
    ].join("\n"),
  );

  try {
    const loaded = await loadDataset({
      repoRoot,
      documentPath: "report.mdx",
      datasetPath: "company.dataset.json",
    });
    assert.deepEqual(loaded.rows, [{ date: "2026-01-05", users: 12345 }]);
    assert.equal(loaded.manifest.fields[0].sourceColumn, 2);
    assert.equal(loaded.manifest.fields[1].numberFormat, "comma-grouped");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("loadDataset keeps column mapping explicit and bounded", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "git-leaf-column-map-contract-"));
  await writeFile(path.join(repoRoot, "report.mdx"), "# Report\n");
  await writeFile(path.join(repoRoot, "company.csv"), "Date,users\n2026-01-01,1\n");

  try {
    const partial = datasetManifest();
    partial.fields[0].sourceColumn = 1;
    await writeFile(path.join(repoRoot, "company.dataset.json"), JSON.stringify(partial));
    await assert.rejects(
      loadDataset({
        repoRoot,
        documentPath: "report.mdx",
        datasetPath: "company.dataset.json",
      }),
      /Every dataset field must set sourceColumn/,
    );

    const duplicate = datasetManifest();
    duplicate.fields.forEach((field) => {
      field.sourceColumn = 1;
    });
    await writeFile(path.join(repoRoot, "company.dataset.json"), JSON.stringify(duplicate));
    await assert.rejects(
      loadDataset({
        repoRoot,
        documentPath: "report.mdx",
        datasetPath: "company.dataset.json",
      }),
      /sourceColumn values must be unique/,
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

function datasetManifest({ sourceGranularity = "day" } = {}) {
  return {
    schemaVersion: 1,
    id: "company_daily",
    title: "Company daily report",
    data: "./company.csv",
    format: "csv",
    grain: ["date", "company_id"],
    primaryKey: ["date", "company_id"],
    time: {
      field: "date",
      type: "date",
      timezone: "Asia/Shanghai",
      weekStartsOn: "monday",
      calendar: "calendar",
      sourceGranularity,
    },
    fields: [
      { name: "date", type: "date", required: true },
      { name: "company_id", type: "string", required: true },
      { name: "revenue", type: "decimal", required: true, unit: "CNY", rollup: "sum" },
      { name: "cash", type: "decimal", required: true, unit: "CNY", rollup: "last" },
      { name: "orders", type: "integer", required: true, rollup: "sum" },
      { name: "visits", type: "integer", required: true, rollup: "sum" },
      {
        name: "conversion_rate",
        type: "decimal",
        unit: "%",
        rollup: {
          op: "ratioOfSums",
          numerator: "orders",
          denominator: "visits",
          scale: 100,
        },
      },
    ],
  };
}
