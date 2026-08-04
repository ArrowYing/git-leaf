export function parseNdjsonRecords(source) {
  const lines = String(source ?? "").split(/\r\n|\n|\r/);
  const records = [];
  let invalidCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = index === 0 ? lines[index].replace(/^\uFEFF/, "") : lines[index];
    if (!raw.trim()) {
      continue;
    }

    try {
      records.push({
        line: index + 1,
        valid: true,
        value: JSON.parse(raw),
      });
    } catch {
      invalidCount += 1;
      records.push({
        line: index + 1,
        valid: false,
        raw,
      });
    }
  }

  return {
    records,
    invalidCount,
  };
}
