---
title: Git Leaf MDX-lite 渲染器参考
domain: ai
type: guide
owner: maintainer
last_updated: 2026-07-10
source: git-leaf
canonical: true
ai_snippet: "[AI Reference] Git Leaf MDX-lite 渲染器参考 | DataTable Timeline Chart DecisionBox MetricGrid FlowDiagram"
change_log:
  - changed: 2026-07-10
    author: maintainer
    summary: 明确 Git Leaf MDX-lite 文档与实现的维护顺序。
  - changed: 2026-07-09
    author: maintainer
    summary: 去掉公司仓库入口假设，明确本文是 Git Leaf 自身的 MDX-lite 能力参考。
  - changed: 2026-07-07
    author: automation
    summary: 收敛本文定位，只保留 Git Leaf 渲染器参考。
  - changed: 2026-07-05
    author: maintainer
    summary: 完善 MDX-lite 使用指南，补充工作流、语法契约、组件边界、数据格式和反例。
---

# Git Leaf MDX-lite 渲染器参考

[Documentation index](README.md) | 简体中文

本文是 Git Leaf 代码仓库内的渲染器和编辑器参考，用于开发、测试和维护 Git Leaf 的 MDX-lite 能力。
Git Leaf 打开的目标仓库可以是任意本机 Git 仓库；MDX-lite 的渲染边界由 Git Leaf 自身实现决定。

MDX-lite 是 Git Leaf 的本地展示层能力。它不是 Next.js、Docusaurus 或通用 MDX runtime，
不支持 `import`、`export`、JS 表达式、任意 JSX 组件或脚本执行。Git Leaf 只识别本文列出的
白名单组件，并把组件 body 里的数据渲染成静态 HTML / SVG。

## 文档维护边界

- 本文是 MDX-lite 组件语法、白名单、数据契约和渲染行为的权威参考，由 Git Leaf 仓库维护。
- [mdx-lite-components-demo.zh-CN.mdx](mdx-lite-components-demo.zh-CN.mdx) 是开发和视觉回归样例，应覆盖 Git Leaf
  已实现并经过测试的完整能力。
- 修改组件语法、白名单或渲染行为时，同时更新代码、测试、本文和开发 Demo。目标内容仓库可以维护自己的
  采用规则和精选示例，但不能覆盖 Git Leaf 的实现契约。

## 快速判断

优先级从低到高：

- 普通叙述、规则、结论、会议纪要和简单表格，继续使用 `.md`。
- 文档需要更好展示表格、时间线、轻量统计图表、决策摘要、指标卡片或轻量流程图，且事实源仍希望保留在
  一个可读文本文件里时，使用 `.mdx` 和本文组件。
- 需要缩放、钻取、地图、复杂关系图、大规模筛选、多页面报表或复杂交互时，不要硬塞进 MDX-lite；应生成
  独立 HTML 展示页、使用飞书表格 / BI，或评估专门图表库。

组件选择：

| 需求 | 优先选择 |
| --- | --- |
| 普通短列表、少量键值 | Markdown 列表 |
| 简单对照表 | Markdown 表格 |
| 可读数据表、宽表、较多行列 | `DataTable` |
| 里程碑、流程节点、问题进度 | `Timeline` |
| 折线、柱状、分组柱状、堆叠柱状统计图 | `Chart` |
| 决策、理由、代价、重评条件摘要 | `DecisionBox` |
| 周报、月报、复盘里的少量核心数字 | `MetricGrid` |
| 5-12 个节点的主流程或链路 | `FlowDiagram` |

## 工作流

打开桌面版 Git Leaf：

```bash
npm run desktop
npm run desktop -- --repo /path/to/docs-repo
```

开发者也可以从内容仓库目录或显式路径打开 Web 入口：

```bash
npm start -- /path/to/docs-repo/docs/repo-structure.md
npm start -- docs/mdx-lite-components-demo.zh-CN.mdx
```

完整效果示例：

```bash
npm start -- docs/mdx-lite-components-demo.zh-CN.mdx
```

在 Source / Live 模式里输入 `/` 可以打开 Slash menu，插入 `DataTable`、`Timeline`、`Chart`、
`DecisionBox`、`MetricGrid` 和 `FlowDiagram` 模板。如果当前文件是 `.md`，插入 MDX-lite 组件前
Git Leaf 会提示改名为 `.mdx`；确认后自动重命名再插入模板。

写完后至少用 Preview 或 Live 的非当前编辑块检查一次渲染效果。需要自动检查 Git Leaf 代码或渲染器变更时，
在 Git Leaf 仓库运行：

```bash
npm test
```

## 语法契约

组件必须作为独立块出现：

````mdx
<ComponentName title="示例">
```csv
name,value
A,1
```
</ComponentName>
````

规则：

- 文件后缀建议使用 `.mdx`。不要在正式 `.md` 文档里手写 MDX-lite 组件。
- 组件名必须是白名单之一：`DataTable`、`Timeline`、`Chart`、`DecisionBox`、`MetricGrid`、
  `FlowDiagram`。
- 开始标签、结束标签单独占一行；组件 body 通常只放一个 fenced 数据块。
- 属性值一律用引号，例如 `title="费用明细"`。不要写 `{}` 表达式、函数、数组或对象字面量。
- 属性名只使用英文、数字、下划线和短横线；动态系列属性使用 `revenueLabel`、`revenueColor` 这类简单形式。
- 不嵌套 MDX-lite 组件。
- 不写 `import`、`export`、`<script>`、`style`、`onClick` 或其他事件属性。
- 组件 body 不支持 YAML。YAML 只适合 frontmatter 或普通 fenced `yaml` 文本块。
- 自闭合组件语法会被解析，但当前 6 个组件大多需要 body 数据；正式文档不要使用自闭合写法。

错误时 Git Leaf 会显示 `MDX 组件渲染失败：...`，源文件仍然可编辑。

## 数据格式

- CSV：默认选择。适合表格行、图表序列、财务和运营数据点，AI Agent 也容易生成和修改。
- TSV：当字段里逗号很多时使用，避免 CSV 转义过多。
- JSON：适合时间线、流程图、嵌套字段或需要明确对象结构的数据。
- Markdown 表格：适合少量简单对照信息；不适合长期维护的大数据表。
- YAML：当前不是 MDX-lite 组件 body 的已支持格式。若要支持 YAML 组件数据，需要先实现 parser 和测试。

推荐写 fenced 数据块：

````mdx
```csv
name,value
A,1
```
````

Git Leaf 也能读取部分裸数据：裸 JSON、裸 CSV、裸 Markdown 表格。但正式文档优先使用 fenced 数据块，
减少歧义。

CSV / TSV 规则：

- 第一行是表头。
- 数字单元格会被识别为数值；带逗号的数字如 `"1,200"` 在字段正确转义时也可解析为数值。
- CSV 字段里如果有逗号、换行或引号，用标准双引号转义。

JSON 规则：

- 表格、时间线、图表和指标卡通常使用数组：`[{"name":"A","value":1}]`。
- `FlowDiagram` 推荐使用对象：`{"nodes":[...],"edges":[...]}`。

## 通用规则

- `.mdx` 文件仍然是事实源文本，不是生成产物。
- 生成的展示样式只服务本地预览；不要把预览结果当作新的事实源。
- 分析样例、临时报表和未确认材料默认写 `canonical: false` 或不写 `canonical: true`。
- 路径使用仓库相对路径，不写个人机器绝对路径。
- 图片资产放在就近 `_assets/` 目录。需要宽度、对齐和说明工具栏时优先使用 HTML `<img>`；
  标准 Markdown `![说明](路径)` 也可以在 Preview 与 Live 中预览，并会在第一次工具栏修改时转换成受控 `<img>`。
- 受控 `<img>` 可以放在 Markdown 表格单元格、同一行图片组或只包含图片的 `<p>...</p>` 中；渲染器只保留
  `src`、`alt`、`width`、`height`、`data-align` 和 `data-caption`，不会因此启用任意 HTML。
- 需要给 AI Agent 精确定位时，在预览器里选择源文件行，点击旁边的“复制内容”。

## DataTable

`DataTable` 用于比 Markdown 表格更适合预览的数据表。组件 body 支持 fenced `csv`、`tsv`、`json`，
也能读取简单 Markdown 表格。

````mdx
<DataTable title="费用明细">
```csv
name,value,status
研发,10,ok
市场,5,watch
```
</DataTable>
````

常用属性：

- `title`：表格标题。
- `columns`：可选，逗号分隔，用于指定展示列顺序。
- `complexity="simple|complex"`：可选，强制复杂度。
- `search="true|false"`：可选，是否启用表格内筛选。
- `freezeFirstColumn="true|false"` 或 `freeze="true|false"`：可选，是否启用冻结首列。
- `copyCsv="true|false"` 或 `copy="true|false"`：可选，是否显示复制 CSV。
- `stickyHeader="true|false"` 或 `sticky="true|false"`：可选，是否启用粘性表头。

默认策略保持克制：

- 小表格不显示搜索、冻结或复制工具栏。
- 行数 `> 20`、列数 `>= 8`、总单元格数 `> 100`、最长单元格 `>= 120` 字符，或手动写
  `complexity="complex"` 时，视为复杂表格。
- 复杂表格默认显示复制 CSV。
- 复杂表格且行数 `> 20` 时启用粘性表头。
- 复杂表格且行数 `> 20`、列数 `>= 6` 时启用冻结首列。
- 复杂表格且行数 `> 100` 时才启用搜索。

不要为了调宽度写手工列宽。Git Leaf 会自动估算列宽：短表自然宽度展示，宽表横向滚动，长文本列优先换行。

## Timeline

`Timeline` 用于展示里程碑、流程节点、复核进度或问题处理过程。推荐使用 JSON；简单节点也可以用 CSV。

````mdx
<Timeline title="项目进展">
```json
[
  {"date":"2026-06-01","title":"确认口径","body":"收入按源表读取","status":"done"},
  {"date":"2026-06-08","title":"补充复核","body":"现金余额单独核对","status":"blocked"}
]
```
</Timeline>
````

字段约定：

- 时间字段：`date`、`time` 或 `month`。
- 标题字段：`title`、`name` 或 `event`。
- 正文字段：`body`、`description`、`summary` 或 `note`。
- 负责人字段：`owner` 或 `assignee`。
- 状态字段：`done`、`active`、`blocked` 或默认状态。

状态映射：

- `done`、`complete`、`completed`、`success` 显示为完成。
- `active`、`doing`、`progress`、`in-progress` 显示为进行中。
- `blocked`、`risk`、`warning` 显示为阻塞 / 风险。

## Chart

`Chart` 用于阅读型静态统计图。它使用 SVG 渲染，不依赖 ECharts；鼠标悬停时会显示同一横坐标下多个指标的
组合 tooltip。

````mdx
<Chart title="收支趋势" type="line" x="month" series="revenue,expense" unit="万元" highlight="2026-06" revenueLabel="收入" expenseLabel="支出">
```csv
month,revenue,expense
2026-05,127.3,127.6
2026-06,126.6,126.1
```
</Chart>
````

常用属性：

- `title`：图表标题。
- `type`：`line`、`bar`、`grouped-bar`、`stacked-bar`、`combo` 或 `combo-dual-axis`。
- `x`：横轴字段；不写时默认使用第一列。
- `series` 或 `y`：逗号分隔的数值字段。
- `bars`：`combo` / `combo-dual-axis` 中作为柱状图渲染的字段。
- `lines`：`combo` / `combo-dual-axis` 中作为折线图渲染的字段。
- `unit`：单位，例如 `万元`。
- `leftUnit` / `rightUnit`：`combo-dual-axis` 的左右轴单位；`leftUnit` 不写时退回 `unit`。
- `rightSeries`：`combo-dual-axis` 中放到右轴的字段；不写时默认把 `lines` 放到右轴。
- `labels="none"`：隐藏数据点数值标签；不写时默认显示。
- `highlight`：逗号分隔的横轴值，用于高亮关键月份或分类。
- `<seriesKey>Label`：给某个指标改中文名，例如 `revenueLabel="收入"`。
- `<seriesKey>Color`：给某个指标指定颜色，例如 `revenueColor="#2563eb"`。
- `note`：图表下方补充说明。

适用边界：

- `line` 适合趋势，可支持多个 series。
- `bar` 适合单指标分类对比；如果有多个 series，优先使用 `grouped-bar` 或 `stacked-bar`。
- `grouped-bar` 适合同一横坐标下多个指标横向比较。
- `stacked-bar` 适合构成关系，只处理非负堆叠值；负数会被当成 0。
- `combo` 适合同一单位、同一 y 轴的柱线混合，例如“新增学生数 + 完课学生数”。
- `combo-dual-axis` 适合单位不同的柱线混合，例如“新增学生数（人）+ 转化率（%）”。
- 空值或非数字值不会绘制。
- 如果需要缩放、点击钻取、复杂坐标轴、地图、关系网络或大量数据，改用独立 HTML / BI。

同轴柱线混合示例：

````mdx
<Chart title="新增与完课" type="combo" x="month" bars="newStudents" lines="finishedStudents" unit="人" newStudentsLabel="新增学生数" finishedStudentsLabel="完课学生数">
```csv
month,newStudents,finishedStudents
2026-05,120,18
2026-06,150,24
```
</Chart>
````

双轴柱线混合示例：

````mdx
<Chart title="新增与转化率" type="combo-dual-axis" x="month" bars="newStudents" lines="conversionRate" rightSeries="conversionRate" leftUnit="人" rightUnit="%" newStudentsLabel="新增学生数" conversionRateLabel="转化率">
```csv
month,newStudents,conversionRate
2026-05,120,8.5
2026-06,150,9.1
```
</Chart>
````

## DecisionBox

`DecisionBox` 用于 DR / ADR、制度、流程文档里的关键决策摘要。它适合把“决策、理由、代价、重评条件”
放在正文附近，帮助读者快速判断当前结论是否可引用。

````mdx
<DecisionBox title="GitHub Issue 任务跟进契约" status="accepted" owner="example" source="docs/dr/dr-03-github-issue-task-tracking-contract.md">
```csv
label,value
决策,"每个 Issue 只能有 1 名 assignee，关注人用 @mention 表达。"
理由,"单一 assignee 保留责任边界；Issue body 包含上下文后，AI Agent 才能直接消费。"
代价,"创建 Issue 的成本高于随手建飞书任务，需要写清 body、关注人和验收标准。"
```
</DecisionBox>
````

常用属性：

- `title`：决策标题。
- `status`：建议使用 `accepted`、`proposed`、`rejected` 或 `superseded`。
- `owner`：责任人或维护人。
- `source`：来源文档路径。

字段约定：

- `label`、`key`、`name` 或 `item`：左侧字段名，例如 `决策`、`理由`、`代价`、`重评`。
- `value`、`text`、`body`、`description` 或 `summary`：对应说明。

如果 body 不是表格数据，`DecisionBox` 会按轻量正文渲染普通段落和列表；但正式决策摘要优先使用
`label,value` 表格，避免格式不稳定。

## MetricGrid

`MetricGrid` 用于月报、周报、财务汇报和增长复盘中的核心指标摘要。它适合放在图表或详细分析前，让读者
先扫到关键数字。

````mdx
<MetricGrid title="一起练琴 2026-05 核心指标">
```csv
label,value,delta,note,status
月活,13.9 万,,用户活跃口径,good
月新增,1.65 万,,日均 550,watch
活跃用户价值,¥ 6.6,,收入 / 活跃用户,neutral
```
</MetricGrid>
````

字段约定：

- `label`、`metric`、`name` 或 `title`：指标名。
- `value`、`current`、`amount` 或 `count`：主数值。
- `delta`、`change`、`mom` 或 `yoy`：变化信息。
- `note`、`description`、`source` 或 `body`：口径或补充说明。
- `status`：可选，`good`、`watch`、`risk` 或 `neutral`。

状态映射：

- `good`、`up`、`positive`、`success`、`active` 或 `+...` 显示为正向。
- `risk`、`warning`、`blocked`、`down`、`negative` 或 `-...` 显示为风险。
- `watch`、`flat`、`neutral` 显示为观察。

适用边界：

- 核心指标少量摘要适合用 `MetricGrid`。
- 大量明细、排序、筛选或宽表仍然用 `DataTable`、CSV/飞书表格或 BI。

## FlowDiagram

`FlowDiagram` 用于轻量流程、同步链路、系统边界和 AI Agent 介入点。它由 Git Leaf 直接渲染为静态 SVG，
不依赖 Mermaid runtime。

推荐 JSON 写法：

````mdx
<FlowDiagram title="单封邮件处理流程" note="只保留主链路，完整流程以正文为准。">
```json
{
  "nodes": [
    {"id": "mail", "label": "机器人邮箱收到邮件", "type": "start"},
    {"id": "rules", "label": "简单规则能确定？", "type": "decision"},
    {"id": "gate", "label": "Email AI Gate", "type": "gate"},
    {"id": "done", "label": "标记 processed", "type": "end"}
  ],
  "edges": [
    {"from": "mail", "to": "rules"},
    {"from": "rules", "to": "gate", "label": "灰区"},
    {"from": "gate", "to": "done"}
  ]
}
```
</FlowDiagram>
````

简单流程也可以用 CSV：

````mdx
<FlowDiagram title="内容发布流程">
```csv
id,label,type,next
draft,写草稿,start,review
review,复核,gate,publish
publish,发布,end,
```
</FlowDiagram>
````

字段约定：

- `nodes`：节点数组，每个节点至少有 `id` 和 `label`。
- `type`：可选，`start`、`end`、`action`、`decision`、`gate` 或 `risk`。
- `edges`：连线数组，使用 `from` 和 `to` 指向节点 `id`，可选 `label`。
- CSV 简写可使用 `next` 或 `to` 指向后续节点；多个后续节点用逗号分隔，并在 CSV 中用双引号包住该字段。
- `note`：图下方说明，适合写“完整流程以正文为准”。

适用边界：

- 5-12 个节点的主流程适合用 `FlowDiagram`。
- 复杂泳道图、大量分支、跨层级架构图或需要精细布局时，继续用 Mermaid、独立 HTML 或专门画图工具。

## 反例

不要写任意 JSX：

```mdx
<MyChart data={rows} onClick={() => alert(1)} />
```

不要在组件 body 里写 YAML 并期待渲染：

````mdx
<DataTable title="错误示例">
```yaml
- name: A
  value: 1
```
</DataTable>
````

不要为了视觉宽度写组件属性：

```mdx
<DataTable title="错误示例" width="1200" columnWidth="name:240,value:80">
```

不要把大型 BI 报告塞进 MDX-lite：

- 多页面仪表盘；
- 需要筛选器联动、下钻、地图或复杂坐标轴；
- 需要长期对外分享的正式报表站点。

这些场景应使用独立 HTML / BI / 飞书表格，或先讨论是否扩展 Git Leaf 能力。

## AI Agent 写作提示

AI Agent 生成 `.mdx` 时应遵守：

- 先判断普通 Markdown 是否足够；只有展示价值明确时才升级到 MDX-lite。
- 优先用 CSV 表达规则数据点、指标和统计数据；用 JSON 表达流程图、时间线和嵌套结构。
- 不要为了少量键值信息写复杂表格；普通短列表仍然直接写 Markdown。
- 不要写未列入本文的组件、属性或数据格式。
- 不写 `import`、`export`、`<script>`、内联事件或自定义未支持组件。
- 不把 YAML 组件 body 写成“已经可渲染”的格式。
- 不手写列宽、图表尺寸或布局微调参数；先依赖 Git Leaf 自动布局。
- 写完后用 Git Leaf 桌面版或 `npm start -- <file>` 打开文件检查效果。
- 修改 Git Leaf 渲染器、编辑器或本文组件契约时，在 Git Leaf 仓库运行 `npm test`。
