---
title: Git Leaf MDX-lite renderer reference
domain: ai
type: guide
owner: maintainer
last_updated: 2026-08-01
source: git-leaf
canonical: true
ai_snippet: "[AI Reference] Git Leaf MDX-lite renderer | inline data and repository-local dataset views | DataTable Timeline Chart DecisionBox MetricGrid FlowDiagram"
---

# Git Leaf MDX-lite renderer reference

[Documentation index](README.md)

This is the authoritative renderer and editor reference for Git Leaf's MDX-lite capability. A repository
opened by Git Leaf can be any local Git repository; the implementation in Git Leaf defines the supported
syntax and security boundary.

The design goal is one source for two consumers. Small component data stays as readable CSV, TSV, JSON,
or Markdown inside the `.mdx` file. A long-lived report may instead keep its complete time-series data in a
repository-local CSV, TSV, or JSON file described by a `.dataset.json` manifest. AI agents can inspect
and update either source as repository text. Preview renders the same facts for people, while Source and
Live continue to edit the original MDX view definition. Rendered output is never a second data source.

MDX-lite is a local presentation layer. It is not Next.js, Docusaurus, or a general MDX runtime. It does
not support imports, exports, JavaScript expressions, arbitrary JSX, custom components, or script
execution. Git Leaf recognizes only the components documented here and renders their body data to static
HTML or SVG.

## Maintenance boundary

- This document is authoritative for component syntax, the allowlist, data contracts, and rendering.
- [MDX-lite component demo](mdx-lite-components-demo.mdx) is the complete development and visual
  regression fixture.
- A component change updates code, tests, this reference, and the demo together.
- Content repositories may maintain their own adoption rules and selected examples, but cannot override
  Git Leaf's implementation contract. The
  [public User Guide Demo repository](https://github.com/MangoFuture1210/git-leaf-example-knowledge-base)
  uses only a small, natural subset for first-run experience; it must not duplicate this full reference
  or regression matrix.

## Choosing Markdown or MDX-lite

Use ordinary `.md` for prose, rules, decisions, meeting notes, short lists, and simple tables.

Use `.mdx` when the document benefits from a readable data table, timeline, compact statistical chart,
decision summary, metric grid, or small process diagram while keeping facts in a readable text file.

Do not force zooming, drill-down, maps, dense relationship graphs, linked filters, multi-page reporting,
or complex interaction into MDX-lite. A bounded view over a long external dataset is supported; a full BI
workflow still belongs in a spreadsheet, BI tool, or purpose-built visualization.

| Need | Preferred format |
| --- | --- |
| Short list or a few key-value pairs | Markdown list |
| Simple comparison | Markdown table |
| Readable data table or wide table | `DataTable` |
| Milestones, process history, issue progress | `Timeline` |
| Line, bar, grouped, stacked, or combo statistics | `Chart` |
| Decision, rationale, tradeoffs, reconsideration | `DecisionBox` |
| A few headline numbers | `MetricGrid` |
| Main flow with roughly 5–12 nodes | `FlowDiagram` |

## Development workflow

Open the desktop app:

```bash
npm run desktop
npm run desktop -- --repo /path/to/docs-repository
```

Open a document through the browser development entry:

```bash
npm start -- /path/to/docs-repository/docs/repository-structure.md
npm start -- docs/mdx-lite-components-demo.mdx
```

In Source or Live, enter `/` to insert templates for `DataTable`, `Timeline`, `Chart`, `DecisionBox`,
`MetricGrid`, and `FlowDiagram`. In a `.md` document Git Leaf asks before renaming it to `.mdx`.

Check the rendered result in Preview or in an inactive Live block. Renderer or editor changes require:

```bash
npm test
```

## Syntax contract

A component is a standalone block:

````mdx
<ComponentName title="Example">
```csv
name,value
A,1
```
</ComponentName>
````

Rules:

- Use `.mdx` for documents that contain components.
- The allowlist is exactly `DataTable`, `Timeline`, `Chart`, `DecisionBox`, `MetricGrid`, and
  `FlowDiagram`.
- Opening and closing tags occupy their own lines.
- A component body normally contains one fenced data block.
- Attribute values are quoted strings such as `title="Cost detail"`.
- Attribute names contain English letters, digits, underscores, or hyphens. Dynamic series attributes
  use forms such as `revenueLabel` and `revenueColor`.
- Components cannot nest.
- Do not use imports, exports, expressions, `<script>`, `style`, event attributes, or custom JSX.
- YAML is not a component-body input format. It remains valid frontmatter or an ordinary fenced block.
- Self-closing syntax is the normal form for an external `Chart` or `DataTable`; inline components
  generally require body data.

On error Git Leaf displays `MDX component failed to render: ...`; the source remains editable.

## Data formats

- **CSV** is the default for table rows, chart series, and operational data.
- **TSV** avoids excessive CSV quoting when values contain many commas.
- **JSON** is preferred for timelines, flows, nested fields, and explicit object structure.
- **Markdown tables** are suitable for small comparisons.
- **YAML** is not supported as component input.

Prefer fenced input:

````mdx
```csv
name,value
A,1
```
````

The parser also accepts some un-fenced JSON, CSV, and Markdown tables, but fenced blocks reduce
ambiguity.

CSV and TSV use the first row as headers. Numeric cells are parsed as numbers. Values containing
delimiters, newlines, or quotes use standard double-quote escaping. JSON table, timeline, chart, and
metric data normally uses an array; FlowDiagram normally uses an object with `nodes` and `edges`.

## Shared content rules

- Inline component facts remain authoritative in the `.mdx` file. For an external dataset, the data
  file is authoritative, the `.dataset.json` file is its contract, and MDX declares only the view.
- Analysis samples and unconfirmed reports use `canonical: false` or omit `canonical: true`.
- Paths are repository-relative and never contain a contributor's absolute machine path.
- Images live in a nearby `_assets/` directory.
- Allowlisted component attributes may stay on one line or span multiple lines like HTML attributes.
  Git Leaf's insertion templates put one attribute on each line by default so longer components remain
  readable and easy to review.
- Standard Markdown images and controlled single-line HTML `<img>` are previewable. The controlled image
  form keeps only `src`, `alt`, `width`, `height`, `data-align`, and `data-caption`.
- Controlled images may appear in Markdown table cells, same-line image groups, or an image-only
  `<p>...</p>` without enabling arbitrary HTML.

## External dataset views

Use an external dataset when a report maintains complete time-series history over months or years and several
documents need bounded human views of the same data. This capability extends the existing `Chart` and
`DataTable` components; it does not add a general `Dataset`, `DataView`, SQL, or script component.

```mdx
<Chart
  title="Revenue trend"
  dataset="./data/company-daily.dataset.json"
  type="line"
  x="period"
  series="revenue,expense"
  from="2025-01-01"
  to="2026-12-31"
  granularity="month"
  granularityOptions="day,week,month,quarter"
/>
```

The toolbar changes only transient view state and exposes only intervals supported by the manifest's
source granularity. Clicking an available interval sends a finite request to Git Leaf's localhost service.
The service reads and validates repository files, applies the
manifest rollups, sorts periods ascending, and returns normal `Chart` or `DataTable` markup. It does not
write the MDX or data files. Quarter means a natural calendar quarter and is labelled like `2026-Q1`.

An optional fenced `query` JSON object adds a bounded range or equality filter:

````mdx
<DataTable
  dataset="./data/company-daily.dataset.json"
  columns="date,revenue,cash"
  granularity="week"
>
```query
{
  "from": "2026-01-01",
  "to": "2026-06-30",
  "where": [
    {"field": "company_id", "op": "eq", "value": "001"}
  ]
}
```
</DataTable>
````

`from` and `to` use inclusive `YYYY-MM-DD` dates. Attributes provide the same range when a separate
query block is unnecessary. `where` accepts at most ten filters using `eq`, `notEq`, `in`, or `notIn`;
`in` and `notIn` accept at most 100 values. No joins, formulas in MDX, arbitrary sorting, grouping,
network requests, imports, JavaScript, or SQL are executed. A dataset component body may be empty or
contain one fenced `query` object; inline CSV, TSV, JSON rows, or Markdown tables are an error when
`dataset` is present.

### Dataset manifest

CSV intentionally has no frontmatter. Adding YAML-like lines above a CSV header would make it
nonstandard and break ordinary CSV tools. Put types, meanings, units, keys, time rules, and aggregation
semantics in a sidecar manifest whose filename ends in `.dataset.json`:

```json
{
  "schemaVersion": 1,
  "id": "company_daily",
  "title": "Company daily report",
  "description": "Complete daily operating data",
  "data": "./company-daily.csv",
  "format": "csv",
  "grain": ["date", "company_id"],
  "primaryKey": ["date", "company_id"],
  "time": {
    "field": "date",
    "type": "date",
    "timezone": "Asia/Shanghai",
    "weekStartsOn": "monday",
    "calendar": "calendar",
    "sourceGranularity": "day"
  },
  "fields": [
    {"name": "date", "type": "date", "required": true, "description": "Natural date"},
    {"name": "company_id", "type": "string", "required": true, "description": "Stable identifier"},
    {"name": "revenue", "type": "decimal", "required": true, "unit": "CNY", "rollup": "sum"},
    {"name": "daily_active_users", "type": "integer", "rollup": "avg"},
    {"name": "cash_balance", "type": "decimal", "unit": "CNY", "rollup": "last"},
    {"name": "orders", "type": "integer", "rollup": "sum"},
    {"name": "visits", "type": "integer", "rollup": "sum"},
    {
      "name": "conversion_rate",
      "type": "decimal",
      "unit": "%",
      "rollup": {
        "op": "ratioOfSums",
        "numerator": "orders",
        "denominator": "visits",
        "scale": 100
      }
    }
  ]
}
```

Schema version 1 supports `string`, `integer`, `decimal`, `number`, `boolean`, and `date`. Its time field
must be a required `date`; `calendar` is `calendar` or `weekdays`, and `weekStartsOn` is `monday` or
`sunday`. `sourceGranularity` is required and is `day`, `week`, `month`, or `quarter`. Week rows use the
declared week-start date; month rows use the first day of the month; quarter rows use the first day of a
natural quarter. `from` and `to` name inclusive source-period starts, so they follow the same alignment.
Source data is standard CSV, TSV, or either a JSON array or `{ "rows": [...] }`. Headers and JSON keys
must be declared fields. String fields remain strings, so an identifier such as `001` keeps its leading
zeros. Primary keys must be required and unique.

Some spreadsheet and BI exports are valid CSV but use duplicate, blank, or multiline display headers,
retain unrelated presentation columns, format numbers with comma grouping, or include empty historical
and future placeholders. The manifest can adapt those files without guessing or rewriting the source:

```json
{
  "skipBlankRows": true,
  "fields": [
    {"name": "date", "type": "date", "required": true, "sourceColumn": 2},
    {
      "name": "daily_active_users",
      "type": "integer",
      "rollup": "avg",
      "sourceColumn": 3,
      "numberFormat": "comma-grouped"
    }
  ]
}
```

`sourceColumn` is the one-based physical column number in CSV or TSV. If one field uses it, every field
must use it, mapped columns must be unique, and undeclared source columns are ignored. JSON datasets keep
using field names and do not support physical column mapping. `numberFormat="comma-grouped"` accepts
values such as `12,345.67` for numeric fields. `skipBlankRows` removes a source row only when every
declared non-time field is blank; it never converts a blank into zero. These options are explicit source
adapters: field names, types, meanings, keys, time rules, and rollups still belong in the manifest.
When a field declares `label`, external charts use it as the default legend text and external tables use
it as the column heading. An explicit component label such as `revenueLabel` still takes precedence for
that chart.

Available views follow a safe compatibility matrix:

| Source granularity | Available views |
| --- | --- |
| `day` | `day`, `week`, `month`, `quarter` |
| `week` | `week` |
| `month` | `month`, `quarter` |
| `quarter` | `quarter` |

A calendar week can cross month and quarter boundaries, so Git Leaf does not assign weekly totals to a
natural month or quarter by start date, end date, or proportional spreading. Reports that need reliable
monthly values must maintain a monthly source instead.

Rollups are `sum`, `avg`, `min`, `max`, `count`, `first`, or `last`. `ratioOfSums` is the one derived
rollup and divides the sum of a numeric numerator by the sum of a numeric denominator. If a requested
field has no rollup and multiple source rows enter a period, Git Leaf reports an error instead of
guessing. `first` and `last` also require at most one filtered row per source period, so a snapshot is
never chosen arbitrarily among companies or other dimensions. The engine never fills a missing source
period with zero. It reports missing expected source periods and any displayed period that is incomplete
within the selected range.

Dataset and source paths resolve relative to the owning document or manifest and must stay inside the
same real repository/worktree. URLs, absolute paths, symlinks outside the repository, and cross-repo
access are rejected. Manifests are limited to 256 KiB, source files to 20 MiB, source rows to 250,000,
fields to 100, query ranges to 10,000 days, and rendered period rows to 5,000. Parsed data is cached by
file identity and change fingerprint. Dataset changes participate in document refresh even when the MDX
source itself is unchanged.

For `Chart`, use `x="period"` or the manifest time-field name and name numeric series explicitly. For
`DataTable`, `columns` controls order; without it, Git Leaf shows the time field plus fields that declare
rollups. `granularity` defaults to the manifest's source granularity. `granularityOptions` can only narrow
the safe views above; it cannot add a view that the source granularity does not support. Controls stay
hidden until the manifest has been validated, so readers never see unavailable finer-grained buttons.

## DataTable

`DataTable` provides a more readable data view than a large Markdown table. Its body accepts fenced CSV,
TSV, JSON, or a simple Markdown table.

````mdx
<DataTable
  title="Cost detail"
>
```csv
name,value,status
Engineering,10,ok
Marketing,5,watch
```
</DataTable>
````

Attributes:

- `title`: table title.
- `columns`: optional comma-separated display order.
- `complexity="simple|complex"`: optional policy override.
- `search="true|false"`: table filtering.
- `freezeFirstColumn="true|false"` or `freeze`: freeze the first column.
- `copyCsv="true|false"` or `copy`: show Copy CSV.
- `stickyHeader="true|false"` or `sticky`: sticky header.

Defaults are deliberately conservative:

- small tables have no search, freeze, or copy toolbar;
- a table is complex when rows exceed 20, columns are at least 8, cells exceed 100, the longest cell is
  at least 120 characters, or `complexity="complex"` is explicit;
- complex tables show Copy CSV;
- a complex table with more than 20 rows uses a sticky header;
- a complex table with more than 20 rows and at least 6 columns freezes the first column;
- search becomes automatic only above 100 rows.

Do not encode manual column widths. Git Leaf estimates them, keeps compact tables natural, scrolls wide
tables horizontally, and wraps long text first.

## Timeline

`Timeline` shows milestones, progress, or issue history. JSON is preferred; simple entries may use CSV.

````mdx
<Timeline
  title="Project progress"
>
```json
[
  {"date":"2026-06-01","title":"Confirm definitions","body":"Read revenue from the source table","status":"done"},
  {"date":"2026-06-08","title":"Review cash","body":"Verify balance separately","status":"blocked"}
]
```
</Timeline>
````

Field aliases:

- time: `date`, `time`, `month`;
- title: `title`, `name`, `event`;
- body: `body`, `description`, `summary`, `note`;
- owner: `owner`, `assignee`;
- status: `done`, `active`, `blocked`, or default.

`complete`, `completed`, and `success` map to done. `doing`, `progress`, and `in-progress` map to active.
`risk` and `warning` map to blocked.

## Chart

`Chart` produces a static SVG for reading. It does not load ECharts. Moving anywhere inside the plot
shows the nearest x value and combines its series into one tooltip. X-axis labels use the available
width more actively while still skipping labels that would overlap.

````mdx
<Chart
  title="Revenue and expense"
  type="line"
  x="month"
  series="revenue,expense"
  unit="$k"
  highlight="2026-06"
  revenueLabel="Revenue"
  expenseLabel="Expense"
>
```csv
month,revenue,expense
2026-05,127.3,127.6
2026-06,126.6,126.1
```
</Chart>
````

Attributes:

- `title`: chart title.
- `type`: `line`, `bar`, `grouped-bar`, `stacked-bar`, `combo`, or `combo-dual-axis`.
- `x`: x-axis field; defaults to the first column.
- `series` or `y`: comma-separated numeric fields.
- `bars` and `lines`: series roles for combo charts.
- `unit`: shared unit.
- `leftUnit`, `rightUnit`: units for a dual-axis combo.
- `rightSeries`: fields on the right axis; defaults to `lines`.
- `labels="none"`: hide point labels.
- `highlight`: comma-separated x values.
- `<seriesKey>Label`: human label for a series.
- `<seriesKey>Color`: color such as `#2563eb`.
- `note`: caption below the chart.

Use `line` for trends, `bar` for one-series categories, `grouped-bar` for side-by-side comparison,
`stacked-bar` for nonnegative composition, `combo` for bars and lines with one unit, and
`combo-dual-axis` when units differ. Empty and nonnumeric values are not drawn. Negative stacked values
are treated as zero.

````mdx
<Chart
  title="New and completed"
  type="combo"
  x="month"
  bars="newItems"
  lines="completedItems"
  unit="items"
>
```csv
month,newItems,completedItems
2026-05,120,18
2026-06,150,24
```
</Chart>
````

````mdx
<Chart
  title="Volume and conversion"
  type="combo-dual-axis"
  x="month"
  bars="volume"
  lines="conversion"
  rightSeries="conversion"
  leftUnit="items"
  rightUnit="%"
>
```csv
month,volume,conversion
2026-05,120,8.5
2026-06,150,9.1
```
</Chart>
````

Zooming, drill-down, complex axes, maps, graphs, linked analysis, and unbounded detail exploration
belong in a standalone HTML or BI surface. A bounded time view may read a long external dataset through
the contract above.

## DecisionBox

`DecisionBox` summarizes a decision, rationale, tradeoffs, and reconsideration conditions near the
supporting prose.

````mdx
<DecisionBox
  title="Issue ownership contract"
  status="accepted"
  owner="maintainer"
  source="docs/decision.md"
>
```csv
label,value
Decision,"Each issue has one assignee; watchers use @mentions."
Rationale,"One assignee preserves accountability."
Tradeoff,"Creating an issue requires enough context and acceptance criteria."
```
</DecisionBox>
````

Attributes are `title`, `status` (`accepted`, `proposed`, `rejected`, or `superseded`), `owner`, and
`source`.

Label fields may be `label`, `key`, `name`, or `item`. Value fields may be `value`, `text`, `body`,
`description`, or `summary`. Plain prose bodies render as lightweight paragraphs and lists, but
`label,value` data is preferred for stable decision summaries.

## MetricGrid

`MetricGrid` presents a few headline metrics before a detailed table or analysis.

````mdx
<MetricGrid
  title="May highlights"
>
```csv
label,value,delta,note,status
Monthly active,139k,,Active-installation definition,good
New this month,16.5k,,Average 550 per day,watch
Value per active,$6.60,,Revenue / active,neutral
```
</MetricGrid>
````

Field aliases:

- label: `label`, `metric`, `name`, `title`;
- main value: `value`, `current`, `amount`, `count`;
- change: `delta`, `change`, `mom`, `yoy`;
- note: `note`, `description`, `source`, `body`;
- status: `good`, `watch`, `risk`, `neutral`.

`up`, `positive`, `success`, `active`, or `+...` map to good. `warning`, `blocked`, `down`, `negative`,
or `-...` map to risk. `flat` maps to watch/neutral.

Use DataTable, CSV/spreadsheets, or BI for large detail sets, sorting, and filtering.

## FlowDiagram

`FlowDiagram` renders a small process, sync chain, system boundary, or agent handoff as static SVG. It
does not load a Mermaid runtime.

````mdx
<FlowDiagram
  title="Request flow"
  note="Main path only; prose is authoritative."
>
```json
{
  "nodes": [
    {"id":"request","label":"Request arrives","type":"start"},
    {"id":"rules","label":"Rules decide?","type":"decision"},
    {"id":"agent","label":"Agent review","type":"gate"},
    {"id":"done","label":"Mark complete","type":"end"}
  ],
  "edges": [
    {"from":"request","to":"rules"},
    {"from":"rules","to":"agent","label":"uncertain"},
    {"from":"agent","to":"done"}
  ]
}
```
</FlowDiagram>
````

A simple flow can use CSV:

````mdx
<FlowDiagram
  title="Publishing flow"
>
```csv
id,label,type,next
draft,Write draft,start,review
review,Review,gate,publish
publish,Publish,end,
```
</FlowDiagram>
````

Nodes require `id` and `label`. Optional node types are `start`, `end`, `action`, `decision`, `gate`,
and `risk`. Edges use `from`, `to`, and optional `label`. CSV may use `next` or `to`; quote a
comma-separated list of multiple successors.

Use Mermaid, standalone HTML, or a diagramming tool for swimlanes, many branches, deep architecture, or
layout-sensitive diagrams.

## Unsupported examples

Arbitrary JSX is rejected:

```mdx
<MyChart data={rows} onClick={() => alert(1)} />
```

YAML is not component data:

````mdx
<DataTable title="Unsupported">
```yaml
- name: A
  value: 1
```
</DataTable>
````

Visual width is not a content contract:

```mdx
<DataTable title="Unsupported" width="1200" columnWidth="name:240,value:80">
```

Do not embed multi-page dashboards, linked filters, drill-down, maps, or complex axes in MDX-lite.

## Guidance for AI agents

- Prefer Markdown unless the presentation benefit is clear.
- Prefer CSV for tabular rules and metrics; use JSON for flows, timelines, and nested data.
- Keep external CSV standard; describe long-lived datasets in a `.dataset.json` sidecar.
- Declare every coarser-period rollup instead of asking the renderer to guess.
- Keep short key-value content as Markdown lists.
- Use only documented components, attributes, and data formats.
- Never generate imports, exports, scripts, inline events, or unsupported custom components.
- Do not claim YAML component bodies are renderable.
- Rely on Git Leaf layout instead of inventing width and positioning properties.
- Open the result in Git Leaf and inspect Preview or Live.
- Run `npm test` after changing the renderer, editor, or this contract.
