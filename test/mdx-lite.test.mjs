import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderMarkdown } from "../src/markdown.mjs";

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

test("renderMarkdown renders the MDX-lite demo without component errors", async () => {
  const demo = await readFile(new URL("../docs/mdx-lite-components-demo.mdx", import.meta.url), "utf8");
  const html = renderMarkdown(demo);

  assert.doesNotMatch(html, /mdx-component-error/);
  assert.equal((html.match(/data-mdx-component="Chart"/g) ?? []).length, 3);
  assert.match(html, /New and completed items/);
  assert.match(html, /Volume and completion rate/);
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
