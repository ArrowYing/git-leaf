import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { parseDelimitedRecords } from "../content/delimited-data.mjs";
import { resolveInsideRepo, toPosixPath } from "./paths.mjs";

const MANIFEST_MAX_BYTES = 256 * 1024;
const DATA_MAX_BYTES = 20 * 1024 * 1024;
const DATA_MAX_ROWS = 250_000;
const DATA_MAX_FIELDS = 100;
const CACHE_MAX_ENTRIES = 16;
const MANIFEST_KEYS = new Set([
  "schemaVersion",
  "id",
  "title",
  "description",
  "data",
  "format",
  "grain",
  "primaryKey",
  "time",
  "fields",
]);
const TIME_KEYS = new Set(["field", "type", "timezone", "weekStartsOn", "calendar"]);
const FIELD_KEYS = new Set([
  "name",
  "label",
  "description",
  "type",
  "unit",
  "required",
  "rollup",
]);
const FIELD_TYPES = new Set(["string", "integer", "decimal", "number", "boolean", "date"]);
const SIMPLE_ROLLUPS = new Set(["sum", "avg", "min", "max", "count", "first", "last"]);
const NUMERIC_ROLLUPS = new Set(["sum", "avg", "min", "max"]);
const DATA_FORMATS = new Set(["csv", "tsv", "json"]);
const datasetCache = new Map();

export async function loadDataset({ repoRoot, documentPath, datasetPath }) {
  const manifestFile = await resolveDatasetReference(repoRoot, documentPath, datasetPath, {
    expectedSuffix: ".dataset.json",
    label: "Dataset manifest",
  });
  const manifestStat = await stat(manifestFile.absolutePath);
  assertRegularSizedFile(manifestStat, MANIFEST_MAX_BYTES, "Dataset manifest");
  const manifestSource = await readFile(manifestFile.absolutePath, "utf8");
  const manifest = validateManifest(parseJson(manifestSource, "Dataset manifest"));
  const dataFile = await resolveDatasetReference(
    repoRoot,
    manifestFile.relativePath,
    manifest.data,
    { label: "Dataset data" },
  );
  const dataStat = await stat(dataFile.absolutePath);
  assertRegularSizedFile(dataStat, DATA_MAX_BYTES, "Dataset data");
  const format = datasetFormat(manifest.format, dataFile.relativePath);
  const fingerprint = [
    manifestFile.relativePath,
    manifestStat.size,
    manifestStat.mtimeMs,
    manifestStat.ctimeMs,
    dataFile.relativePath,
    dataStat.size,
    dataStat.mtimeMs,
    dataStat.ctimeMs,
  ].join(":");
  const cached = datasetCache.get(manifestFile.absolutePath);
  if (cached?.fingerprint === fingerprint) {
    touchCache(manifestFile.absolutePath, cached);
    return cached.value;
  }

  const dataSource = await readFile(dataFile.absolutePath, "utf8");
  const rawRows = parseDatasetRows(dataSource, format);
  const rows = validateRows(rawRows, manifest);
  const value = {
    manifest,
    rows,
    manifestPath: manifestFile.relativePath,
    sourcePath: dataFile.relativePath,
    dependencyHash: hashText(fingerprint),
  };
  touchCache(manifestFile.absolutePath, { fingerprint, value });
  trimCache();
  return value;
}

export async function datasetDependencyFingerprint({
  repoRoot,
  documentPath,
  datasetPaths = [],
}) {
  const references = [...new Set(datasetPaths.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort();
  if (references.length === 0) {
    return "";
  }

  const entries = [];
  for (const datasetPath of references) {
    try {
      const manifestFile = await resolveDatasetReference(repoRoot, documentPath, datasetPath, {
        expectedSuffix: ".dataset.json",
        label: "Dataset manifest",
      });
      const manifestStat = await stat(manifestFile.absolutePath);
      assertRegularSizedFile(manifestStat, MANIFEST_MAX_BYTES, "Dataset manifest");
      const manifestSource = await readFile(manifestFile.absolutePath, "utf8");
      const parsed = parseJson(manifestSource, "Dataset manifest");
      const dataReference = typeof parsed?.data === "string" ? parsed.data : "";
      if (!dataReference) {
        entries.push([datasetPath, manifestFile.relativePath, statFingerprint(manifestStat), "missing-data"]);
        continue;
      }
      const dataFile = await resolveDatasetReference(
        repoRoot,
        manifestFile.relativePath,
        dataReference,
        { label: "Dataset data" },
      );
      const dataStat = await stat(dataFile.absolutePath);
      entries.push([
        datasetPath,
        manifestFile.relativePath,
        statFingerprint(manifestStat),
        dataFile.relativePath,
        statFingerprint(dataStat),
      ]);
    } catch (error) {
      entries.push([datasetPath, "error", error instanceof Error ? error.message : "unknown"]);
    }
  }
  return hashText(JSON.stringify(entries));
}

export async function resolveDatasetReference(
  repoRoot,
  ownerPath,
  reference,
  { expectedSuffix = "", label = "Dataset file" } = {},
) {
  const value = String(reference ?? "").trim().replaceAll("\\", "/");
  if (
    !value ||
    value.includes("\0") ||
    value.includes("?") ||
    value.includes("#") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
  ) {
    throw datasetError(`${label} must be a repository-relative file path.`);
  }
  if (expectedSuffix && !value.toLowerCase().endsWith(expectedSuffix)) {
    throw datasetError(`${label} must end with ${expectedSuffix}.`);
  }
  const ownerDirectory = path.posix.dirname(toPosixPath(String(ownerPath || "")));
  const candidate = path.posix.normalize(path.posix.join(
    ownerDirectory === "." ? "" : ownerDirectory,
    value,
  ));
  try {
    const resolved = await resolveInsideRepo(repoRoot, candidate);
    const fileStat = await stat(resolved.absolutePath);
    if (!fileStat.isFile()) {
      throw datasetError(`${label} must point to a file.`);
    }
    return resolved;
  } catch (error) {
    if (error?.code === "dataset_invalid") throw error;
    throw datasetError(`${label} is unavailable inside the current repository: ${value}.`);
  }
}

function validateManifest(value) {
  assertPlainObject(value, "Dataset manifest");
  assertKnownKeys(value, MANIFEST_KEYS, "Dataset manifest");
  if (value.schemaVersion !== 1) {
    throw datasetError("Dataset manifest schemaVersion must be 1.");
  }
  const id = requiredText(value.id, "Dataset manifest id", 128);
  const data = requiredText(value.data, "Dataset manifest data", 512);
  const fields = validateFields(value.fields);
  const fieldMap = new Map(fields.map((field) => [field.name, field]));
  const time = validateTime(value.time, fieldMap);
  const grain = validateFieldList(value.grain, "Dataset manifest grain", fieldMap);
  const primaryKey = validateFieldList(value.primaryKey, "Dataset manifest primaryKey", fieldMap);
  if (!grain.includes(time.field)) {
    throw datasetError(`Dataset grain must include the time field "${time.field}".`);
  }
  if (!primaryKey.includes(time.field)) {
    throw datasetError(`Dataset primaryKey must include the time field "${time.field}".`);
  }
  for (const name of primaryKey) {
    if (!fieldMap.get(name).required) {
      throw datasetError(`Primary key field "${name}" must set required to true.`);
    }
  }
  validateRatioRollups(fields, fieldMap);

  const format = value.format === undefined ? "" : String(value.format).trim().toLowerCase();
  if (format && !DATA_FORMATS.has(format)) {
    throw datasetError(`Unsupported dataset format: ${value.format}.`);
  }
  return {
    schemaVersion: 1,
    id,
    title: optionalText(value.title, "Dataset manifest title", 256),
    description: optionalText(value.description, "Dataset manifest description", 2_000),
    data,
    format,
    grain,
    primaryKey,
    time,
    fields,
  };
}

function validateFields(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > DATA_MAX_FIELDS) {
    throw datasetError(`Dataset manifest fields must contain 1 to ${DATA_MAX_FIELDS} definitions.`);
  }
  const names = new Set();
  return value.map((entry, index) => {
    assertPlainObject(entry, `Dataset field ${index + 1}`);
    assertKnownKeys(entry, FIELD_KEYS, `Dataset field ${index + 1}`);
    const name = requiredText(entry.name, `Dataset field ${index + 1} name`, 128);
    if (/\p{C}/u.test(name) || name.includes(",")) {
      throw datasetError(`Dataset field name contains unsupported characters: ${name}.`);
    }
    if (name === "period") {
      throw datasetError('Dataset field name "period" is reserved for rendered time buckets.');
    }
    if (names.has(name)) {
      throw datasetError(`Dataset field names must be unique: ${name}.`);
    }
    names.add(name);
    const type = String(entry.type || "").trim().toLowerCase();
    if (!FIELD_TYPES.has(type)) {
      throw datasetError(`Unsupported type for field "${name}": ${entry.type}.`);
    }
    const rollup = normalizeRollup(entry.rollup, name, type);
    return {
      name,
      type,
      required: entry.required === true,
      label: optionalText(entry.label, `Field "${name}" label`, 256),
      description: optionalText(entry.description, `Field "${name}" description`, 1_000),
      unit: optionalText(entry.unit, `Field "${name}" unit`, 64),
      rollup,
    };
  });
}

function validateTime(value, fieldMap) {
  assertPlainObject(value, "Dataset manifest time");
  assertKnownKeys(value, TIME_KEYS, "Dataset manifest time");
  const field = requiredText(value.field, "Dataset time field", 128);
  if (!fieldMap.has(field)) {
    throw datasetError(`Dataset time field is not defined: ${field}.`);
  }
  if (fieldMap.get(field).type !== "date") {
    throw datasetError(`Dataset time field "${field}" must use type "date" in schemaVersion 1.`);
  }
  if (value.type !== undefined && String(value.type).trim().toLowerCase() !== "date") {
    throw datasetError("Dataset time type must be date in schemaVersion 1.");
  }
  const weekStartsOn = String(value.weekStartsOn || "monday").trim().toLowerCase();
  if (weekStartsOn !== "monday" && weekStartsOn !== "sunday") {
    throw datasetError("Dataset time weekStartsOn must be monday or sunday.");
  }
  const calendar = String(value.calendar || "calendar").trim().toLowerCase();
  if (calendar !== "calendar" && calendar !== "weekdays") {
    throw datasetError("Dataset time calendar must be calendar or weekdays.");
  }
  return {
    field,
    type: "date",
    timezone: optionalText(value.timezone, "Dataset time timezone", 128) || "UTC",
    weekStartsOn,
    calendar,
  };
}

function normalizeRollup(value, name, type) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "string") {
    const op = value.trim();
    if (!SIMPLE_ROLLUPS.has(op)) {
      throw datasetError(`Unsupported rollup for field "${name}": ${value}.`);
    }
    if (NUMERIC_ROLLUPS.has(op) && !["integer", "decimal", "number"].includes(type)) {
      throw datasetError(`Rollup ${op} requires a numeric field: ${name}.`);
    }
    return { op };
  }
  assertPlainObject(value, `Rollup for field "${name}"`);
  const keys = Object.keys(value);
  if (keys.some((key) => !["op", "numerator", "denominator", "scale"].includes(key))) {
    throw datasetError(`Rollup for field "${name}" contains unsupported keys.`);
  }
  if (value.op !== "ratioOfSums") {
    throw datasetError(`Unsupported rollup for field "${name}": ${value.op}.`);
  }
  if (!["integer", "decimal", "number"].includes(type)) {
    throw datasetError(`ratioOfSums requires a numeric result field: ${name}.`);
  }
  const scale = value.scale === undefined ? 1 : Number(value.scale);
  if (!Number.isFinite(scale)) {
    throw datasetError(`ratioOfSums scale must be numeric for field "${name}".`);
  }
  return {
    op: "ratioOfSums",
    numerator: requiredText(value.numerator, `Field "${name}" ratio numerator`, 128),
    denominator: requiredText(value.denominator, `Field "${name}" ratio denominator`, 128),
    scale,
  };
}

function validateRatioRollups(fields, fieldMap) {
  for (const field of fields) {
    if (field.rollup?.op !== "ratioOfSums") continue;
    for (const sourceName of [field.rollup.numerator, field.rollup.denominator]) {
      const source = fieldMap.get(sourceName);
      if (!source || !["integer", "decimal", "number"].includes(source.type)) {
        throw datasetError(
          `ratioOfSums field "${field.name}" references a missing or non-numeric field: ${sourceName}.`,
        );
      }
    }
  }
}

function validateRows(rawRows, manifest) {
  if (!Array.isArray(rawRows) || rawRows.length < 1) {
    throw datasetError("Dataset data must contain at least one row.");
  }
  if (rawRows.length > DATA_MAX_ROWS) {
    throw datasetError(`Dataset data exceeds the ${DATA_MAX_ROWS} row limit.`);
  }
  const fieldMap = new Map(manifest.fields.map((field) => [field.name, field]));
  const primaryKeys = new Set();
  return rawRows.map((rawRow, index) => {
    assertPlainObject(rawRow, `Dataset row ${index + 1}`);
    const unknown = Object.keys(rawRow).filter((name) => !fieldMap.has(name));
    if (unknown.length > 0) {
      throw datasetError(`Dataset row ${index + 1} contains an undefined field: ${unknown[0]}.`);
    }
    const row = {};
    for (const field of manifest.fields) {
      row[field.name] = typedValue(rawRow[field.name], field, index + 1);
    }
    const primaryKey = JSON.stringify(manifest.primaryKey.map((name) => row[name]));
    if (primaryKeys.has(primaryKey)) {
      throw datasetError(`Dataset primaryKey is duplicated at row ${index + 1}.`);
    }
    primaryKeys.add(primaryKey);
    return row;
  });
}

function typedValue(value, field, rowNumber) {
  const empty = value === undefined || value === null || (typeof value === "string" && value.trim() === "");
  if (empty) {
    if (field.required) {
      throw datasetError(`Dataset row ${rowNumber} is missing required field "${field.name}".`);
    }
    return null;
  }
  if (field.type === "string") {
    if (typeof value === "object") {
      throw datasetError(`Dataset row ${rowNumber} field "${field.name}" must be string.`);
    }
    return String(value);
  }
  if (field.type === "boolean") {
    if (value === true || value === false) return value;
    const text = String(value).trim().toLowerCase();
    if (text === "true" || text === "1") return true;
    if (text === "false" || text === "0") return false;
    throw datasetError(`Dataset row ${rowNumber} field "${field.name}" must be boolean.`);
  }
  if (field.type === "date") {
    const text = String(value).trim();
    if (!isIsoDate(text)) {
      throw datasetError(`Dataset row ${rowNumber} field "${field.name}" must be YYYY-MM-DD.`);
    }
    return text;
  }
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(number) || (field.type === "integer" && !Number.isInteger(number))) {
    throw datasetError(`Dataset row ${rowNumber} field "${field.name}" must be ${field.type}.`);
  }
  return number;
}

function parseDatasetRows(source, format) {
  if (format === "json") {
    const parsed = parseJson(source, "Dataset data");
    const rows = Array.isArray(parsed) ? parsed : parsed?.rows;
    if (!Array.isArray(rows)) {
      throw datasetError("JSON dataset data must be an array or an object with a rows array.");
    }
    return rows;
  }

  let records;
  try {
    records = parseDelimitedRecords(source, format === "tsv" ? "\t" : ",");
  } catch (error) {
    throw datasetError(error instanceof Error ? error.message : "Dataset data parsing failed.");
  }
  if (records.length < 2) {
    return [];
  }
  const headers = records[0].map((header) => String(header).trim());
  if (headers.some((header) => !header)) {
    throw datasetError("Dataset data headers must not be empty.");
  }
  if (new Set(headers).size !== headers.length) {
    throw datasetError("Dataset data headers must be unique.");
  }
  return records.slice(1).map((record, index) => {
    if (record.slice(headers.length).some((value) => String(value).trim() !== "")) {
      throw datasetError(`Dataset row ${index + 1} contains more values than headers.`);
    }
    return Object.fromEntries(
      headers.map((header, columnIndex) => [header, record[columnIndex] ?? ""]),
    );
  });
}

function datasetFormat(configured, sourcePath) {
  if (configured) return configured;
  const extension = path.posix.extname(sourcePath).slice(1).toLowerCase();
  if (!DATA_FORMATS.has(extension)) {
    throw datasetError("Dataset format must be csv, tsv, or json.");
  }
  return extension;
}

function validateFieldList(value, label, fieldMap) {
  if (!Array.isArray(value) || value.length < 1 || value.length > DATA_MAX_FIELDS) {
    throw datasetError(`${label} must be a non-empty field-name array.`);
  }
  const fields = value.map((name) => requiredText(name, label, 128));
  if (new Set(fields).size !== fields.length) {
    throw datasetError(`${label} must not contain duplicates.`);
  }
  const missing = fields.find((name) => !fieldMap.has(name));
  if (missing) {
    throw datasetError(`${label} references an undefined field: ${missing}.`);
  }
  return fields;
}

function assertRegularSizedFile(fileStat, maxBytes, label) {
  if (!fileStat.isFile()) {
    throw datasetError(`${label} must point to a file.`);
  }
  if (fileStat.size > maxBytes) {
    throw datasetError(`${label} exceeds the ${maxBytes} byte limit.`);
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw datasetError(`${label} must be a JSON object.`);
  }
}

function assertKnownKeys(value, allowed, label) {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    throw datasetError(`${label} contains an unsupported key: ${unknown}.`);
  }
}

function requiredText(value, label, maxLength) {
  const text = String(value ?? "").trim();
  if (!text || text.length > maxLength || /\u0000/.test(text)) {
    throw datasetError(`${label} is required and must be at most ${maxLength} characters.`);
  }
  return text;
}

function optionalText(value, label, maxLength) {
  if (value === undefined || value === null || value === "") return "";
  const text = String(value).trim();
  if (text.length > maxLength || /\u0000/.test(text)) {
    throw datasetError(`${label} must be at most ${maxLength} characters.`);
  }
  return text;
}

function parseJson(source, label) {
  try {
    return JSON.parse(String(source).replace(/^\uFEFF/, ""));
  } catch {
    throw datasetError(`${label} must contain valid JSON.`);
  }
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

function statFingerprint(fileStat) {
  return `${fileStat.size}:${fileStat.mtimeMs}:${fileStat.ctimeMs}`;
}

function hashText(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function touchCache(key, entry) {
  datasetCache.delete(key);
  datasetCache.set(key, entry);
}

function trimCache() {
  while (datasetCache.size > CACHE_MAX_ENTRIES) {
    datasetCache.delete(datasetCache.keys().next().value);
  }
}

function datasetError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "dataset_invalid";
  return error;
}
