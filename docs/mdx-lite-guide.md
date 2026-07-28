---
title: Git Leaf MDX-lite renderer reference
domain: ai
type: guide
owner: maintainer
last_updated: 2026-07-28
source: git-leaf
canonical: true
ai_snippet: "[AI Reference] Git Leaf MDX-lite renderer | DataTable Timeline Chart DecisionBox MetricGrid FlowDiagram"
---

# Git Leaf MDX-lite renderer reference

[Documentation index](README.md)

This is the authoritative renderer and editor reference for Git Leaf's MDX-lite capability. A repository
opened by Git Leaf can be any local Git repository; the implementation in Git Leaf defines the supported
syntax and security boundary.

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
  [public example context repository](https://github.com/MangoFuture1210/git-leaf-example-knowledge-base)
  uses only a small, natural subset for first-run experience; it must not duplicate this full reference
  or regression matrix.

## Choosing Markdown or MDX-lite

Use ordinary `.md` for prose, rules, decisions, meeting notes, short lists, and simple tables.

Use `.mdx` when the document benefits from a readable data table, timeline, compact statistical chart,
decision summary, metric grid, or small process diagram while keeping facts in a readable text file.

Do not force zooming, drill-down, maps, dense relationship graphs, large filters, multi-page reporting,
or complex interaction into MDX-lite. Use a standalone HTML artifact, a spreadsheet/BI tool, or a
purpose-built visualization library.

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
- Self-closing syntax parses, but the current components generally require body data and should not use
  it in production documents.

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

- The `.mdx` file remains the source of truth; rendered output is not another data source.
- Analysis samples and unconfirmed reports use `canonical: false` or omit `canonical: true`.
- Paths are repository-relative and never contain a contributor's absolute machine path.
- Images live in a nearby `_assets/` directory.
- Standard Markdown images and controlled single-line HTML `<img>` are previewable. The controlled image
  form keeps only `src`, `alt`, `width`, `height`, `data-align`, and `data-caption`.
- Controlled images may appear in Markdown table cells, same-line image groups, or an image-only
  `<p>...</p>` without enabling arbitrary HTML.

## DataTable

`DataTable` provides a more readable data view than a large Markdown table. Its body accepts fenced CSV,
TSV, JSON, or a simple Markdown table.

````mdx
<DataTable title="Cost detail">
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
<Timeline title="Project progress">
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

`Chart` produces a static SVG for reading. It does not load ECharts. Hovering combines series at the
same x value into one tooltip.

````mdx
<Chart title="Revenue and expense" type="line" x="month" series="revenue,expense" unit="$k" highlight="2026-06" revenueLabel="Revenue" expenseLabel="Expense">
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
<Chart title="New and completed" type="combo" x="month" bars="newItems" lines="completedItems" unit="items">
```csv
month,newItems,completedItems
2026-05,120,18
2026-06,150,24
```
</Chart>
````

````mdx
<Chart title="Volume and conversion" type="combo-dual-axis" x="month" bars="volume" lines="conversion" rightSeries="conversion" leftUnit="items" rightUnit="%">
```csv
month,volume,conversion
2026-05,120,8.5
2026-06,150,9.1
```
</Chart>
````

Zooming, drill-down, complex axes, maps, graphs, and large datasets belong in a standalone HTML or BI
surface.

## DecisionBox

`DecisionBox` summarizes a decision, rationale, tradeoffs, and reconsideration conditions near the
supporting prose.

````mdx
<DecisionBox title="Issue ownership contract" status="accepted" owner="maintainer" source="docs/decision.md">
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
<MetricGrid title="May highlights">
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
<FlowDiagram title="Request flow" note="Main path only; prose is authoritative.">
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
<FlowDiagram title="Publishing flow">
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
- Keep short key-value content as Markdown lists.
- Use only documented components, attributes, and data formats.
- Never generate imports, exports, scripts, inline events, or unsupported custom components.
- Do not claim YAML component bodies are renderable.
- Rely on Git Leaf layout instead of inventing width and positioning properties.
- Open the result in Git Leaf and inspect Preview or Live.
- Run `npm test` after changing the renderer, editor, or this contract.
