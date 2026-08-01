import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderMarkdown } from "../src/content/markdown.mjs";
import {
  datasetReferencesFromMarkdown,
  renderMdxLiteRows,
} from "../src/content/mdx-lite.mjs";

test("renderMarkdown renders a small whitelisted MDX DataTable without table tools", () => {
  const html = renderMarkdown(`<DataTable title="费用明细">
\`\`\`csv
name,value,status
研发,10,ok
市场,5,watch
\`\`\`
</DataTable>`);

  assert.match(html, /data-mdx-component="DataTable"/);
  assert.match(html, /<caption>费用明细<\/caption>/);
  assert.match(html, /data-table-complexity="simple"/);
  assert.doesNotMatch(html, /data-enhanced-table/);
  assert.doesNotMatch(html, /data-table-search/);
  assert.doesNotMatch(html, /data-table-copy/);
  assert.match(html, /<th>name<\/th>/);
  assert.match(html, /<td>研发<\/td>/);
  assert.match(html, /<div class="table-card is-simple-table" data-table-complexity="simple" data-table-layout="fit" style="--table-preferred-width: \d+px; --table-min-width: \d+px;">/);
  assert.match(html, /data-table-layout="fit"/);
  assert.match(html, /<colgroup>/);
});

test("renderMarkdown enables table tools for complex MDX DataTable rows", () => {
  const rows = Array.from({ length: 101 }, (_, index) =>
    `检查项 ${index + 1},pass,说明 ${index + 1},A,B,C`,
  ).join("\n");
  const html = renderMarkdown(`<DataTable title="检查项">
\`\`\`csv
name,status,detail,segment,type,bucket
${rows}
\`\`\`
</DataTable>`);

  assert.match(html, /data-mdx-component="DataTable"/);
  assert.match(html, /data-table-complexity="complex"/);
  assert.match(html, /data-enhanced-table/);
  assert.match(html, /data-table-search/);
  assert.doesNotMatch(html, />表格搜索</);
  assert.match(html, /data-table-copy/);
  assert.match(html, /<colgroup>/);
});

test("renderMarkdown renders a whitelisted MDX Timeline from JSON", () => {
  const html = renderMarkdown(`<Timeline title="项目进展">
\`\`\`json
[
  {"date":"2026-06-01","title":"确认口径","body":"收入按源表读取","status":"done"},
  {"date":"2026-06-08","title":"补充复核","body":"现金余额单独核对","status":"blocked"}
]
\`\`\`
</Timeline>`);

  assert.match(html, /data-mdx-component="Timeline"/);
  assert.match(html, /<h3 class="mdx-component-title">项目进展<\/h3>/);
  assert.match(html, /class="mdx-timeline-item is-done"/);
  assert.match(html, /<time>2026-06-01<\/time>/);
  assert.match(html, /确认口径/);
  assert.match(html, /现金余额单独核对/);
});

test("renderMarkdown renders a whitelisted MDX Chart as static SVG", () => {
  const html = renderMarkdown(`<Chart title="收支趋势" type="line" x="month" series="revenue,expense" unit="万元" highlight="2026-06">
\`\`\`csv
month,revenue,expense
2026-05,127.3,127.6
2026-06,126.6,126.1
\`\`\`
</Chart>`);

  assert.match(html, /data-mdx-component="Chart"/);
  assert.match(html, /<svg viewBox="0 0 880 360" role="img" aria-label="收支趋势"/);
  assert.match(html, /<polyline/);
  assert.match(html, /<circle/);
  assert.match(html, /Unit: 万元/);
  assert.match(html, /class="mdx-chart-legend-label"[^>]*>revenue<\/text>/);
  assert.match(html, /class="mdx-chart-unit-label"[^>]*>Unit: 万元<\/text>/);
  assert.match(html, /class="mdx-chart-y-label"/);
  assert.match(html, /class="mdx-chart-x-label mdx-chart-highlight-label"[^>]*>2026-06<\/text>/);
  assert.match(html, /class="mdx-chart-value-label"[^>]*>127<\/text>/);
  assert.doesNotMatch(html, /fill="#172033"|fill="#475467"/);
  assert.doesNotMatch(html, /stroke="#edf0f5"|stroke="#d9dee8"|stroke="#98a2b3"/);
});

test("renderMarkdown extends Chart with an external dataset view placeholder", () => {
  const html = renderMarkdown(`<Chart title="收入趋势" dataset="./data/company.dataset.json" type="line" x="period" series="revenue" from="2025-01-01" to="2026-12-31" granularity="quarter" />`, {
    locale: "zh-CN",
  });

  assert.match(html, /data-mdx-dataset-view="true"/);
  assert.match(html, /data-dataset-default-granularity="quarter"/);
  assert.match(html, /class="mdx-dataset-controls"[^>]* hidden/);
  assert.match(html, /data-dataset-granularity="day"/);
  assert.match(html, /data-dataset-granularity="week"/);
  assert.match(html, /data-dataset-granularity="month"/);
  assert.match(html, /data-dataset-granularity="quarter"/);
  assert.match(html, />季度<\/button>/);
  assert.match(html, /正在加载数据集/);
  assert.doesNotMatch(html, /mdx-component-error/);
  const encodedRequest = html.match(/data-dataset-request="([^"]+)"/)?.[1];
  const request = JSON.parse(decodeURIComponent(encodedRequest));
  assert.deepEqual(request.granularityOptions, ["day", "week", "month", "quarter"]);
});

test("dataset components defer their default interval to the manifest", () => {
  const html = renderMarkdown(
    '<Chart dataset="./company-weekly.dataset.json" x="period" series="revenue" />',
  );

  assert.match(html, /data-dataset-default-granularity="auto"/);
  assert.match(html, /class="mdx-dataset-controls"[^>]* hidden/);
});

test("renderMarkdown accepts one dataset component attribute per line", () => {
  const chart = renderMarkdown([
    "<Chart",
    '  title="收入趋势"',
    '  dataset="./data/company.dataset.json"',
    '  type="line"',
    '  x="period"',
    '  series="revenue"',
    '  granularity="quarter"',
    "/>",
  ].join("\n"), { locale: "zh-CN" });
  const table = renderMarkdown([
    "<DataTable",
    '  title="收入明细"',
    '  dataset="./data/company.dataset.json"',
    '  columns="date,revenue"',
    '  granularity="month"',
    ">",
    "```query",
    '{"where":[{"field":"company_id","op":"eq","value":"001"}]}',
    "```",
    "</DataTable>",
  ].join("\n"), { locale: "zh-CN" });

  assert.match(chart, /data-mdx-dataset-view="true"/);
  assert.match(chart, /data-dataset-default-granularity="quarter"/);
  assert.match(chart, /data-source-start="1" data-source-end="8"/);
  assert.doesNotMatch(chart, /&lt;Chart/);
  assert.match(table, /data-mdx-dataset-view="true"/);
  assert.match(table, /data-dataset-default-granularity="month"/);
  assert.match(table, /data-source-start="1" data-source-end="10"/);
  assert.doesNotMatch(table, /&lt;DataTable/);
});

test("every allowlisted MDX-lite component accepts HTML-like multiline attributes", () => {
  const cases = [
    ["DataTable", [
      "<DataTable",
      '  title="Detail"',
      '  columns="name,value"',
      ">",
      "```csv",
      "name,value",
      "Revenue,10",
      "```",
      "</DataTable>",
    ]],
    ["Timeline", [
      "<Timeline",
      '  title="Milestones"',
      ">",
      "```json",
      '[{"date":"2026-01-01","title":"Start","status":"done"}]',
      "```",
      "</Timeline>",
    ]],
    ["Chart", [
      "<Chart",
      '  title="Revenue"',
      '  type="line"',
      '  x="month"',
      '  series="value"',
      ">",
      "```csv",
      "month,value",
      "2026-01,10",
      "```",
      "</Chart>",
    ]],
    ["DecisionBox", [
      "<DecisionBox",
      '  title="Decision"',
      '  status="accepted"',
      ">",
      "```csv",
      "label,value",
      "Decision,Ship",
      "```",
      "</DecisionBox>",
    ]],
    ["MetricGrid", [
      "<MetricGrid",
      '  title="Metrics"',
      ">",
      "```csv",
      "label,value",
      "Revenue,10",
      "```",
      "</MetricGrid>",
    ]],
    ["FlowDiagram", [
      "<FlowDiagram",
      '  title="Flow"',
      ">",
      "```json",
      '{"nodes":[{"id":"start","label":"Start","type":"start"}],"edges":[]}',
      "```",
      "</FlowDiagram>",
    ]],
  ];

  for (const [name, lines] of cases) {
    const html = renderMarkdown(lines.join("\n"));
    assert.match(html, new RegExp(`data-mdx-component="${name}"`), name);
    assert.doesNotMatch(html, /mdx-component-error/, name);
    assert.doesNotMatch(html, new RegExp(`&lt;${name}`), name);
  }
});

test("renderMarkdown accepts only a fenced finite query inside a dataset component", () => {
  const valid = renderMarkdown(`<DataTable dataset="./data/company.dataset.json" columns="date,revenue">
\`\`\`query
{"from":"2026-01-01","to":"2026-03-31","where":[{"field":"company_id","op":"eq","value":"001"}]}
\`\`\`
</DataTable>`);
  const invalid = renderMarkdown(`<DataTable dataset="./data/company.dataset.json">
\`\`\`csv
date,revenue
2026-01-01,10
\`\`\`
</DataTable>`);

  assert.match(valid, /data-mdx-dataset-view="true"/);
  assert.doesNotMatch(valid, /mdx-component-error/);
  assert.match(invalid, /mdx-component-error/);
  assert.match(invalid, /fenced query JSON object/);
});

test("renderMdxLiteRows uses manifest-provided DataTable column labels", () => {
  const html = renderMdxLiteRows(
    "DataTable",
    [{ date: "2026-01-01", users: 123 }],
    {
      columns: "date,users",
      columnLabels: { date: "日期", users: "活跃用户" },
    },
    { locale: "zh-CN" },
  );

  assert.match(html, /<th>日期<\/th><th>活跃用户<\/th>/);
  assert.doesNotMatch(html, /<th>users<\/th>/);
});

test("datasetReferencesFromMarkdown ignores examples inside fenced code", () => {
  const references = datasetReferencesFromMarkdown([
    '<Chart dataset="./real.dataset.json" />',
    "<DataTable",
    '  dataset="./multiline.dataset.json"',
    '  columns="date,revenue"',
    "/>",
    "```mdx",
    '<Chart dataset="./example.dataset.json" />',
    "```",
  ].join("\n"));

  assert.deepEqual(references, ["./real.dataset.json", "./multiline.dataset.json"]);
});

test("renderMarkdown renders the MDX-lite demo without component errors", async () => {
  const demo = await readFile(new URL("../docs/mdx-lite-components-demo.mdx", import.meta.url), "utf8");
  const html = renderMarkdown(demo);

  assert.doesNotMatch(html, /mdx-component-error/);
  assert.equal((html.match(/data-mdx-component="Chart"/g) ?? []).length, 5);
  assert.match(html, /New and completed items/);
  assert.match(html, /Volume and completion rate/);
  assert.ok(datasetReferencesFromMarkdown(demo).includes("./data/company-weekly.dataset.json"));
});

test("renderMarkdown groups chart tooltip data by x-axis value", () => {
  const line = renderMarkdown(`<Chart title="收支趋势" type="line" x="month" series="revenue,expense" unit="万元">
\`\`\`csv
month,revenue,expense
2026-06,126.6,126.1
\`\`\`
</Chart>`);
  const grouped = renderMarkdown(`<Chart title="广告费分产品" type="grouped-bar" x="month" series="app,mango" unit="万元" appLabel="一起练琴APP" mangoLabel="魔法钢琴APP">
\`\`\`csv
month,app,mango
2026-06,6.1,7.3
\`\`\`
</Chart>`);

  assert.match(line, /data-chart-tooltip="2026-06\\nrevenue: 126\.6 万元\\nexpense: 126\.1 万元"/);
  assert.match(grouped, /data-chart-tooltip="2026-06\\n一起练琴APP: 6\.1 万元\\n魔法钢琴APP: 7\.3 万元"/);
  assert.doesNotMatch(line, /data-chart-tooltip="收支趋势\\n/);
});

test("renderMarkdown gives every chart x value a full-height nearest-x pointer region", () => {
  const html = renderMarkdown(`<Chart title="收支趋势" type="line" x="month" series="revenue,expense" unit="万元">
\`\`\`csv
month,revenue,expense
2026-05,127.3,127.6
2026-06,126.6,126.1
2026-07,128.2,127.4
\`\`\`
</Chart>`);
  const regions = html.match(/<rect class="mdx-chart-x-hit-target"[^>]*>/g) ?? [];

  assert.equal(regions.length, 3);
  assert.ok(regions.every((region) => /data-chart-tooltip="[^"]+"/.test(region)));
  assert.ok(regions.every((region) => /y="46\.0"/.test(region)));
  assert.ok(regions.every((region) => /height="250\.0"/.test(region)));

  const bounds = regions.map((region) => ({
    x: Number(region.match(/\sx="([^"]+)"/)?.[1]),
    width: Number(region.match(/\swidth="([^"]+)"/)?.[1]),
  }));
  assert.equal(bounds[0].x, 58);
  for (let index = 1; index < bounds.length; index += 1) {
    assert.ok(Math.abs(bounds[index].x - (bounds[index - 1].x + bounds[index - 1].width)) < 0.11);
  }
  assert.ok(Math.abs(bounds.at(-1).x + bounds.at(-1).width - 854) < 0.11);
});

test("renderMarkdown uses available x-axis space without showing every dense label", () => {
  const chartFor = (labels) => renderMarkdown(`<Chart title="趋势" type="line" x="period" series="value" labels="none">
\`\`\`csv
period,value
${labels.map((label, index) => `${label},${index + 1}`).join("\n")}
\`\`\`
</Chart>`);
  const labelTexts = (html) => [
    ...html.matchAll(/<text class="mdx-chart-x-label"[^>]*>([^<]+)<\/text>/g),
  ].map((match) => match[1]);
  const months = Array.from({ length: 24 }, (_, index) =>
    new Date(Date.UTC(2024, 7 + index, 1)).toISOString().slice(0, 7)
  );
  const quarters = [
    "2024-Q3",
    "2024-Q4",
    "2025-Q1",
    "2025-Q2",
    "2025-Q3",
    "2025-Q4",
    "2026-Q1",
    "2026-Q2",
    "2026-Q3",
  ];
  const dense = Array.from({ length: 12 }, (_, index) => `非常长的业务分类名称-${index + 1}`);
  const monthLabels = labelTexts(chartFor(months));
  const quarterLabels = labelTexts(chartFor(quarters));
  const denseLabels = labelTexts(chartFor(dense));

  assert.ok(monthLabels.length > 7);
  assert.ok(monthLabels.length < months.length);
  assert.equal(monthLabels[0], months[0]);
  assert.equal(monthLabels.at(-1), months.at(-1));
  assert.deepEqual(quarterLabels, quarters);
  assert.ok(denseLabels.length >= 2);
  assert.ok(denseLabels.length < dense.length);
  assert.equal(denseLabels[0], dense[0]);
  assert.equal(denseLabels.at(-1), dense.at(-1));
});

test("renderMarkdown shows chart value labels by default and can hide them", () => {
  const visible = renderMarkdown(`<Chart title="收入趋势" type="bar" x="month" series="revenue">
\`\`\`csv
month,revenue
2026-06,120
\`\`\`
</Chart>`);
  const hidden = renderMarkdown(`<Chart title="收入趋势" type="bar" x="month" series="revenue" labels="none">
\`\`\`csv
month,revenue
2026-06,120
\`\`\`
</Chart>`);

  assert.match(visible, /class="mdx-chart-value-label"[^>]*>120<\/text>/);
  assert.doesNotMatch(hidden, /class="mdx-chart-value-label"/);
});

test("renderMarkdown restricts chart colors to inert hexadecimal values", () => {
  const html = renderMarkdown(`<Chart title="Safe" x="month" series="revenue" revenueColor='" onload="alert(1)'>
\`\`\`csv
month,revenue
2026-06,120
\`\`\`
</Chart>`);

  assert.doesNotMatch(html, /onload=/);
  assert.doesNotMatch(html, /alert\(1\)/);
  assert.match(html, /fill="#2563eb"/);
});

test("renderMarkdown supports lightweight grouped and stacked chart variants", () => {
  const grouped = renderMarkdown(`<Chart title="广告费分产品" type="grouped-bar" x="month" series="app,mango,classmate" unit="万元">
\`\`\`csv
month,app,mango,classmate
2026-05,8,6,1
2026-06,6,7,1
\`\`\`
</Chart>`);
  const stacked = renderMarkdown(`<Chart title="现金余额现状" type="stacked-bar" x="company" series="cash,withdrawable,pending" unit="万元">
\`\`\`csv
company,cash,withdrawable,pending
深圳芒果未来,48,115,0
HK芒果未来,157,0,19
\`\`\`
</Chart>`);

  assert.match(grouped, /data-mdx-component="Chart"/);
  assert.match(grouped, /广告费分产品/);
  assert.equal((grouped.match(/<rect x="/g) ?? []).length > 6, true);
  assert.match(stacked, /现金余额现状/);
  assert.equal((stacked.match(/<rect x="/g) ?? []).length > 5, true);
});

test("renderMarkdown supports same-axis combo charts with bars and lines", () => {
  const html = renderMarkdown(`<Chart title="新增与完课" type="combo" x="month" bars="newStudents" lines="finishedStudents" unit="人" newStudentsLabel="新增学生数" finishedStudentsLabel="完课学生数">
\`\`\`csv
month,newStudents,finishedStudents
2026-05,548,60
2026-06,438,25
\`\`\`
</Chart>`);

  assert.match(html, /data-mdx-component="Chart"/);
  assert.match(html, /<rect x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" rx="3" fill="#2563eb"/);
  assert.match(html, /<polyline points="[^"]+" fill="none" stroke="#dc2626"/);
  assert.match(html, /class="mdx-chart-legend-label"[^>]*>新增学生数<\/text>/);
  assert.match(html, /class="mdx-chart-legend-label"[^>]*>完课学生数<\/text>/);
  assert.match(html, /data-chart-tooltip="2026-06\\n新增学生数: 438 人\\n完课学生数: 25 人"/);
  assert.match(html, /class="mdx-chart-value-label"[^>]*>438<\/text>/);
  assert.match(html, /class="mdx-chart-value-label"[^>]*>25<\/text>/);
});

test("renderMarkdown supports dual-axis combo charts with right-axis line series", () => {
  const html = renderMarkdown(`<Chart title="新增与转化率" type="combo-dual-axis" x="month" bars="newStudents" lines="conversionRate" rightSeries="conversionRate" leftUnit="人" rightUnit="%" newStudentsLabel="新增学生数" conversionRateLabel="转化率">
\`\`\`csv
month,newStudents,conversionRate
2026-05,548,12.3
2026-06,438,10.8
\`\`\`
</Chart>`);

  assert.match(html, /data-mdx-component="Chart"/);
  assert.match(html, /mdx-chart-right-y-label/);
  assert.match(html, /class="mdx-chart-unit-label"[^>]*>Unit: 人<\/text>/);
  assert.match(html, /class="mdx-chart-unit-label mdx-chart-right-unit-label"[^>]*>Unit: %<\/text>/);
  assert.match(html, /<rect x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" rx="3" fill="#2563eb"/);
  assert.match(html, /<polyline points="[^"]+" fill="none" stroke="#dc2626"/);
  assert.match(html, /data-chart-tooltip="2026-05\\n新增学生数: 548 人\\n转化率: 12\.3%"/);
});

test("renderMarkdown renders a whitelisted MDX DecisionBox", () => {
  const html = renderMarkdown(`<DecisionBox title="Issue 跟进契约" status="accepted" owner="example">
\`\`\`csv
label,value
决策,每个 Issue 只能有 1 名 assignee
代价,创建成本高于随手建飞书任务
\`\`\`
</DecisionBox>`);

  assert.match(html, /data-mdx-component="DecisionBox"/);
  assert.match(html, /Issue 跟进契约/);
  assert.match(html, /<span class="mdx-decision-badge">accepted<\/span>/);
  assert.match(html, /<dt>决策<\/dt>/);
  assert.match(html, /每个 Issue 只能有 1 名 assignee/);
});

test("renderMarkdown renders a whitelisted MDX MetricGrid", () => {
  const html = renderMarkdown(`<MetricGrid title="核心指标">
\`\`\`csv
label,value,delta,note,status
月活,13.9 万,,用户活跃口径,good
月新增,1.65 万,+3%,日均 550,watch
\`\`\`
</MetricGrid>`);

  assert.match(html, /data-mdx-component="MetricGrid"/);
  assert.match(html, /核心指标/);
  assert.match(html, /class="mdx-metric-item is-good"/);
  assert.match(html, /<strong>13.9 万<\/strong>/);
});

test("renderMarkdown renders a whitelisted MDX FlowDiagram as static SVG", () => {
  const html = renderMarkdown(`<FlowDiagram title="邮件处理流程">
\`\`\`json
{
  "nodes": [
    {"id": "mail", "label": "收到邮件", "type": "start"},
    {"id": "rules", "label": "简单规则能确定？", "type": "decision"},
    {"id": "done", "label": "标记 processed", "type": "end"}
  ],
  "edges": [
    {"from": "mail", "to": "rules"},
    {"from": "rules", "to": "done", "label": "是"}
  ]
}
\`\`\`
</FlowDiagram>`);

  assert.match(html, /data-mdx-component="FlowDiagram"/);
  assert.match(html, /<svg viewBox="0 0 /);
  assert.match(html, /class="mdx-flow-node is-decision"/);
  assert.match(html, /class="mdx-flow-edge"/);
  assert.match(html, />是<\/text>/);
});

test("renderMarkdown keeps source-line selection around MDX-lite components", () => {
  const html = renderMarkdown(`<Timeline>
\`\`\`json
[{"date":"2026-06-01","title":"确认口径"}]
\`\`\`
</Timeline>`);

  assert.match(html, /class="source-block"/);
  assert.match(html, /data-source-start="1"/);
  assert.match(html, /data-source-end="5"/);
  assert.match(html, /data-source-line="5"/);
});

test("renderMarkdown does not execute or render arbitrary MDX tags", () => {
  const html = renderMarkdown(`<UnknownWidget dangerous="true" />

<script>alert("x")</script>`);

  assert.doesNotMatch(html, /data-mdx-component="UnknownWidget"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;UnknownWidget dangerous=&quot;true&quot; \/&gt;/);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
});

test("renderMarkdown localizes MDX chrome while preserving user content and technical errors", () => {
  const decisionSource = `<DecisionBox title="保留原文">
\`\`\`csv
label,value
Decision,Use Git
\`\`\`
</DecisionBox>`;
  const flowSource = `<FlowDiagram>
\`\`\`json
{"nodes":[{"id":"start","label":"用户节点","type":"start"}],"edges":[]}
\`\`\`
</FlowDiagram>`;
  const invalidChart = `<Chart>
</Chart>`;

  const englishDecision = renderMarkdown(decisionSource);
  const chineseDecision = renderMarkdown(decisionSource, { locale: "zh-CN" });
  const englishFlow = renderMarkdown(flowSource);
  const chineseFlow = renderMarkdown(flowSource, { locale: "zh-CN" });
  const englishError = renderMarkdown(invalidChart);
  const chineseError = renderMarkdown(invalidChart, { locale: "zh-CN" });

  assert.match(englishDecision, /<span class="mdx-component-kicker">Decision<\/span>/);
  assert.match(chineseDecision, /<span class="mdx-component-kicker">决策<\/span>/);
  assert.match(englishDecision, /<h3 class="mdx-component-title">保留原文<\/h3>/);
  assert.match(chineseDecision, /<h3 class="mdx-component-title">保留原文<\/h3>/);
  assert.match(englishFlow, /aria-label="Flow diagram"/);
  assert.match(chineseFlow, /aria-label="流程图"/);
  assert.match(englishFlow, />用户节点<\/tspan>/);
  assert.match(chineseFlow, />用户节点<\/tspan>/);
  assert.match(
    englishError,
    /Failed to render MDX component: Chart requires CSV or JSON rows\./,
  );
  assert.match(
    chineseError,
    /MDX 组件渲染失败：Chart requires CSV or JSON rows\./,
  );
});
