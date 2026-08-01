import {
  renderTableToolbar,
  tableCardAttributeString,
  tableComplexityAttributes,
} from "./table-complexity.mjs";
import {
  renderTableColgroup,
  tableLayoutAttributes,
  tableScrollAttributeString,
} from "./table-layout.mjs";
import { parseDelimitedRecords } from "./delimited-data.mjs";
import {
  DATASET_GRANULARITIES,
  isDatasetGranularity,
} from "./dataset-granularity.mjs";
import {
  MDX_LITE_COMPONENT_NAMES,
  mdxLiteComponentBlockAtLines,
  mdxLiteComponentOpeningAtLines,
} from "./mdx-lite-syntax.mjs";
import { createTranslator } from "../../public/i18n.js";

const COMPONENT_NAMES = new Set(MDX_LITE_COMPONENT_NAMES);
const CHART_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];
const DATASET_COMPONENT_NAMES = new Set(["Chart", "DataTable"]);
const MDX_MESSAGES = Object.freeze({
  en: Object.freeze({
    "component.error": "Failed to render MDX component: {message}",
    "decision.kicker": "Decision",
    "flow.ariaLabel": "Flow diagram",
    "chart.unit": "Unit: {unit}",
    "dataset.controls": "Dataset time interval",
    "dataset.loading": "Loading dataset…",
    "dataset.day": "Day",
    "dataset.week": "Week",
    "dataset.month": "Month",
    "dataset.quarter": "Quarter",
  }),
  "zh-CN": Object.freeze({
    "component.error": "MDX 组件渲染失败：{message}",
    "decision.kicker": "决策",
    "flow.ariaLabel": "流程图",
    "chart.unit": "单位：{unit}",
    "dataset.controls": "数据集时间区间",
    "dataset.loading": "正在加载数据集……",
    "dataset.day": "日",
    "dataset.week": "周",
    "dataset.month": "月",
    "dataset.quarter": "季度",
  }),
});

export function mdxLiteBlockRule(state, startLine, endLine, silent) {
  const startMatch = sourceLine(state, startLine).trimStart()
    .match(/^<([A-Z][A-Za-z0-9]*)\b/);
  if (!startMatch || !COMPONENT_NAMES.has(startMatch[1])) {
    return false;
  }

  const openingLines = [];
  let opening = null;
  for (let lineIndex = startLine; lineIndex < endLine && openingLines.length < 100; lineIndex += 1) {
    openingLines.push(sourceLine(state, lineIndex));
    opening = mdxLiteComponentOpeningAtLines(openingLines);
    if (opening) break;
  }
  if (!opening || !COMPONENT_NAMES.has(opening.name)) {
    return false;
  }

  if (silent) {
    return true;
  }

  const openingEndLine = startLine + opening.endIndex;
  let closeLine = openingEndLine;
  if (!opening.selfClosing) {
    closeLine = findClosingLine(state, openingEndLine + 1, endLine, opening.name);
    if (closeLine < 0) {
      return false;
    }
  }

  const token = state.push("mdx_lite_component", "", 0);
  token.block = true;
  token.map = [startLine, closeLine + 1];
  token.meta = {
    name: opening.name,
    attributes: opening.attributes,
  };
  token.content = opening.selfClosing
    ? ""
    : state.getLines(openingEndLine + 1, closeLine, state.blkIndent, false);

  state.line = closeLine + 1;
  return true;
}

export function renderMdxLiteComponent(token, { locale = "en" } = {}) {
  const name = token.meta?.name;
  const attributes = token.meta?.attributes ?? {};
  const translate = createTranslator(MDX_MESSAGES, locale);

  try {
    if (Object.hasOwn(attributes, "dataset")) {
      return renderDatasetView(token, attributes, translate);
    }
    if (name === "DataTable") {
      return renderDataTable(token.content, attributes, translate);
    }
    if (name === "Timeline") {
      return renderTimeline(token.content, attributes, translate);
    }
    if (name === "Chart") {
      return renderChart(token.content, attributes, translate);
    }
    if (name === "DecisionBox") {
      return renderDecisionBox(token.content, attributes, translate);
    }
    if (name === "MetricGrid") {
      return renderMetricGrid(token.content, attributes, translate);
    }
    if (name === "FlowDiagram") {
      return renderFlowDiagram(token.content, attributes, translate);
    }
  } catch (error) {
    return componentError(name, error, translate);
  }

  return componentError(name, new Error("Unsupported MDX-lite component."), translate);
}

export function renderMdxLiteRows(name, rows, attributes = {}, { locale = "en" } = {}) {
  const translate = createTranslator(MDX_MESSAGES, locale);
  try {
    if (name === "DataTable") {
      return renderDataTableRows(rows, attributes, translate);
    }
    if (name === "Chart") {
      return renderChartRows(rows, attributes, translate);
    }
  } catch (error) {
    return componentError(name, error, translate);
  }
  return componentError(name, new Error("External datasets support Chart and DataTable."), translate);
}

export function datasetReferencesFromMarkdown(markdown) {
  const references = [];
  const lines = String(markdown ?? "").split(/\r?\n/);
  let fence = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) {
        fence = fenceMatch[1][0];
      } else if (fence === fenceMatch[1][0]) {
        fence = "";
      }
      continue;
    }
    if (fence) continue;
    const block = mdxLiteComponentBlockAtLines(lines, index);
    if (!block) continue;
    if (DATASET_COMPONENT_NAMES.has(block.component) && block.attributes.dataset) {
      references.push(block.attributes.dataset);
    }
    index = block.endIndex;
  }
  return [...new Set(references)];
}

function renderDatasetView(token, attributes, translate) {
  const name = token.meta?.name;
  if (!DATASET_COMPONENT_NAMES.has(name)) {
    throw new Error("External datasets support Chart and DataTable.");
  }
  const dataset = String(attributes.dataset || "").trim();
  if (!dataset) {
    throw new Error("dataset must point to a .dataset.json manifest.");
  }
  const query = datasetQueryFromContent(token.content);
  const granularities = uniqueStrings(listAttribute(
    attributes.granularityOptions || DATASET_GRANULARITIES.join(","),
  ))
    .map((value) => value.toLowerCase());
  if (granularities.length === 0 || granularities.some((value) => !isDatasetGranularity(value))) {
    throw new Error("granularityOptions supports day, week, month, and quarter.");
  }
  const defaultGranularity = String(attributes.granularity || "auto").trim().toLowerCase();
  if (defaultGranularity !== "auto" && !granularities.includes(defaultGranularity)) {
    throw new Error("granularity must be included in granularityOptions.");
  }
  const requestAttributes = { ...attributes };
  delete requestAttributes.dataset;
  delete requestAttributes.granularity;
  delete requestAttributes.granularityOptions;
  const request = encodeURIComponent(JSON.stringify({
    component: name,
    dataset,
    attributes: requestAttributes,
    query,
    granularityOptions: granularities,
  }));

  return [
    `<section class="mdx-component mdx-dataset-view" data-mdx-component="${name}" data-mdx-dataset-view="true" data-dataset-request="${request}" data-dataset-default-granularity="${defaultGranularity}">`,
    `<div class="mdx-dataset-controls" role="group" aria-label="${escapeHtml(translate("dataset.controls"))}" hidden>`,
    granularities.map((granularity) => [
      `<button type="button" class="mdx-dataset-granularity${granularity === defaultGranularity ? " is-active" : ""}" data-dataset-granularity="${granularity}" aria-pressed="${granularity === defaultGranularity}">`,
      escapeHtml(translate(`dataset.${granularity}`)),
      "</button>",
    ].join("")).join(""),
    "</div>",
    `<div class="mdx-dataset-result" data-dataset-result aria-live="polite"><p class="mdx-dataset-loading">${escapeHtml(translate("dataset.loading"))}</p></div>`,
    "</section>",
  ].join("");
}

function datasetQueryFromContent(content) {
  if (!String(content ?? "").trim()) {
    return {};
  }
  const dataBlock = extractDataBlock(content);
  if (!dataBlock || dataBlock.format !== "query") {
    throw new Error("A dataset component body may contain only a fenced query JSON object.");
  }
  let query;
  try {
    query = JSON.parse(dataBlock.body);
  } catch {
    throw new Error("Dataset query must contain valid JSON.");
  }
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    throw new Error("Dataset query must be a JSON object.");
  }
  return query;
}

function renderDataTable(content, attributes, translate) {
  return renderDataTableRows(extractRows(content), attributes, translate);
}

function renderDataTableRows(rows, attributes, translate) {
  const columns = columnsForRows(rows, attributes.columns);
  if (rows.length === 0 || columns.length === 0) {
    return componentError(
      "DataTable",
      new Error("DataTable requires CSV, JSON, or a Markdown table."),
      translate,
    );
  }
  const columnLabels = attributes.columnLabels
    && typeof attributes.columnLabels === "object"
    && !Array.isArray(attributes.columnLabels)
    ? attributes.columnLabels
    : {};
  const displayColumn = (column) => String(columnLabels[column] || column);
  const tableAttributes = tableComplexityAttributes({
    rows,
    columns,
    cells: rows.flatMap((row) => columns.map((column) => row[column])),
    overrides: attributes,
  });
  const tableLayout = tableLayoutAttributes({
    columnNames: columns.map(displayColumn),
    cellsByColumn: columns.map((column) => [displayColumn(column), ...rows.map((row) => row[column] ?? "")]),
  });

  return [
    '<div class="mdx-component mdx-data-table" data-mdx-component="DataTable">',
    `<div ${tableCardAttributeString(tableAttributes, tableLayout)}>`,
    renderTableToolbar(tableAttributes, { locale: translate.locale }),
    `<div ${tableScrollAttributeString(tableLayout)}><table>`,
    renderTableColgroup(tableLayout),
    attributes.title ? `<caption>${escapeHtml(attributes.title)}</caption>` : "",
    "<thead><tr>",
    columns.map((column) => `<th>${escapeHtml(displayColumn(column))}</th>`).join(""),
    "</tr></thead><tbody>",
    rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column] ?? "")}</td>`).join("")}</tr>`).join(""),
    "</tbody></table></div></div></div>",
  ].join("");
}

function renderTimeline(content, attributes, translate) {
  const rows = extractRows(content);
  if (rows.length === 0) {
    return componentError("Timeline", new Error("Timeline requires CSV or JSON rows."), translate);
  }

  return [
    '<section class="mdx-component mdx-timeline" data-mdx-component="Timeline">',
    attributes.title ? `<h3 class="mdx-component-title">${escapeHtml(attributes.title)}</h3>` : "",
    '<ol class="mdx-timeline-list">',
    rows.map(renderTimelineItem).join(""),
    "</ol></section>",
  ].join("");
}

function renderTimelineItem(row) {
  const status = normalizeStatus(row.status);
  const date = row.date ?? row.time ?? row.month ?? "";
  const title = row.title ?? row.name ?? row.event ?? "";
  const body = row.body ?? row.description ?? row.summary ?? row.note ?? "";
  const owner = row.owner ?? row.assignee ?? "";

  return [
    `<li class="mdx-timeline-item is-${status}">`,
    '<div class="mdx-timeline-marker" aria-hidden="true"></div>',
    '<div class="mdx-timeline-content">',
    date ? `<time>${escapeHtml(date)}</time>` : "",
    title ? `<strong>${escapeHtml(title)}</strong>` : "",
    body ? `<p>${escapeHtml(body)}</p>` : "",
    owner ? `<span class="mdx-timeline-meta">${escapeHtml(owner)}</span>` : "",
    "</div></li>",
  ].join("");
}

function renderDecisionBox(content, attributes, translate) {
  const rows = extractRows(content);
  const items = rows.map((row) => ({
    label: row.label ?? row.key ?? row.name ?? row.item ?? "",
    value: row.value ?? row.text ?? row.body ?? row.description ?? row.summary ?? "",
  })).filter((item) => item.label || item.value);
  const status = normalizeDecisionStatus(attributes.status || attributes.decisionStatus);
  const badges = [
    status ? `<span class="mdx-decision-badge">${escapeHtml(status)}</span>` : "",
    attributes.owner ? `<span class="mdx-decision-badge">${escapeHtml(attributes.owner)}</span>` : "",
    attributes.source ? `<span class="mdx-decision-badge">${escapeHtml(attributes.source)}</span>` : "",
  ].filter(Boolean).join("");

  return [
    `<section class="mdx-component mdx-decision-box is-${status || "default"}" data-mdx-component="DecisionBox">`,
    '<div class="mdx-decision-header">',
    `<span class="mdx-component-kicker">${escapeHtml(translate("decision.kicker"))}</span>`,
    attributes.title ? `<h3 class="mdx-component-title">${escapeHtml(attributes.title)}</h3>` : "",
    badges ? `<div class="mdx-decision-badges">${badges}</div>` : "",
    "</div>",
    items.length > 0
      ? `<dl class="mdx-decision-list">${items.map(renderDecisionItem).join("")}</dl>`
      : `<div class="mdx-decision-body">${renderRichBlock(content)}</div>`,
    "</section>",
  ].join("");
}

function renderDecisionItem(item) {
  return [
    "<div>",
    item.label ? `<dt>${escapeHtml(item.label)}</dt>` : "",
    item.value ? `<dd>${renderInlineText(item.value)}</dd>` : "",
    "</div>",
  ].join("");
}

function renderMetricGrid(content, attributes, translate) {
  const rows = extractRows(content);
  if (rows.length === 0) {
    return componentError(
      "MetricGrid",
      new Error("MetricGrid requires CSV, JSON, or a Markdown table."),
      translate,
    );
  }
  const items = rows.map((row) => ({
    label: row.label ?? row.metric ?? row.name ?? row.title ?? "",
    value: row.value ?? row.current ?? row.amount ?? row.count ?? "",
    delta: row.delta ?? row.change ?? row.mom ?? row.yoy ?? "",
    note: row.note ?? row.description ?? row.source ?? row.body ?? "",
    status: normalizeMetricStatus(row.status ?? row.trend ?? row.delta ?? row.change),
  })).filter((item) => item.label || item.value);

  return [
    '<section class="mdx-component mdx-metric-grid" data-mdx-component="MetricGrid">',
    attributes.title ? `<h3 class="mdx-component-title">${escapeHtml(attributes.title)}</h3>` : "",
    '<div class="mdx-metric-grid-items">',
    items.map(renderMetricItem).join(""),
    "</div></section>",
  ].join("");
}

function renderMetricItem(item) {
  return [
    `<article class="mdx-metric-item is-${item.status}">`,
    item.label ? `<span class="mdx-metric-label">${escapeHtml(item.label)}</span>` : "",
    item.value ? `<strong>${escapeHtml(item.value)}</strong>` : "",
    item.delta ? `<span class="mdx-metric-delta">${escapeHtml(item.delta)}</span>` : "",
    item.note ? `<p>${escapeHtml(item.note)}</p>` : "",
    "</article>",
  ].join("");
}

function renderFlowDiagram(content, attributes, translate) {
  const model = extractFlowDiagram(content);
  if (model.nodes.length === 0) {
    return componentError("FlowDiagram", new Error("FlowDiagram requires nodes."), translate);
  }

  const layout = layoutFlowDiagram(model.nodes, model.edges);
  return [
    '<figure class="mdx-component mdx-flow-diagram" data-mdx-component="FlowDiagram">',
    attributes.title ? `<figcaption>${escapeHtml(attributes.title)}</figcaption>` : "",
    '<div class="mdx-flow-scroll">',
    `<svg viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="${escapeHtml(attributes.title || translate("flow.ariaLabel"))}">`,
    '<defs><marker id="mdx-flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>',
    layout.edges.map((edge) => renderFlowEdge(edge, layout)).join(""),
    layout.nodes.map((node) => renderFlowNode(node, layout)).join(""),
    "</svg></div>",
    attributes.note ? `<p class="mdx-flow-note">${escapeHtml(attributes.note)}</p>` : "",
    "</figure>",
  ].join("");
}

function renderChart(content, attributes, translate) {
  return renderChartRows(extractRows(content), attributes, translate);
}

function renderChartRows(rows, attributes, translate) {
  if (rows.length === 0) {
    return componentError("Chart", new Error("Chart requires CSV or JSON rows."), translate);
  }

  const xKey = attributes.x || Object.keys(rows[0] ?? {})[0];
  const type = chartTypeFromAttributes(attributes);
  const seriesKeys = chartSeriesKeys(attributes)
    .filter((key) => key !== xKey && rows.some((row) => Number.isFinite(toNumber(row[key]))));
  if (!xKey || seriesKeys.length === 0) {
    return componentError(
      "Chart",
      new Error("Chart requires x and numeric series fields."),
      translate,
    );
  }

  const chartType = type || (seriesKeys.length > 1 ? "line" : "bar");
  const model = buildChartModel({ rows, xKey, seriesKeys, attributes, type: chartType });
  model.translate = translate;
  configureChartSeries(model, chartType);
  const chartError = chartModelError(model, chartType);
  if (chartError) {
    return componentError("Chart", chartError, translate);
  }
  const svg = chartType === "bar"
    ? renderBarSvg(model)
    : chartType === "grouped-bar"
      ? renderGroupedBarSvg(model)
      : chartType === "stacked-bar"
        ? renderStackedBarSvg(model)
        : chartType === "combo"
          ? renderComboSvg(model)
          : chartType === "combo-dual-axis"
            ? renderComboSvg(model, { dualAxis: true })
            : renderLineSvg(model);

  return [
    '<figure class="mdx-component mdx-chart" data-mdx-component="Chart">',
    attributes.title ? `<figcaption>${escapeHtml(attributes.title)}</figcaption>` : "",
    svg,
    attributes.note ? `<p class="mdx-chart-note">${escapeHtml(attributes.note)}</p>` : "",
    "</figure>",
  ].join("");
}

function chartTypeFromAttributes(attributes) {
  const type = String(attributes.type || "").trim().toLowerCase();
  return ["line", "bar", "grouped-bar", "stacked-bar", "combo", "combo-dual-axis"].includes(type)
    ? type
    : "";
}

function chartSeriesKeys(attributes) {
  const configured = listAttribute(attributes.series || attributes.y);
  const roleKeys = [
    ...listAttribute(attributes.bars || attributes.bar),
    ...listAttribute(attributes.lines || attributes.line),
    ...listAttribute(attributes.leftSeries || attributes.left || attributes.leftAxis || attributes.leftY),
    ...listAttribute(attributes.rightSeries || attributes.right || attributes.rightAxis || attributes.rightY),
  ];
  return uniqueStrings(configured.length > 0 ? [...configured, ...roleKeys] : roleKeys);
}

function buildChartModel({ rows, xKey, seriesKeys, attributes, type }) {
  const width = 880;
  const height = 360;
  const pad = { left: 58, right: type === "combo-dual-axis" ? 58 : 26, top: 46, bottom: 64 };
  const labels = rows.map((row) => String(row[xKey] ?? ""));
  const series = seriesKeys.map((key, index) => ({
    key,
    label: attributes[`${key}Label`] || key,
    color: chartColor(attributes[`${key}Color`], CHART_COLORS[index % CHART_COLORS.length]),
    values: rows.map((row) => toNumber(row[key])),
  }));
  const highlights = new Set(listAttribute(attributes.highlight));

  return {
    attributes,
    width,
    height,
    pad,
    plotW: width - pad.left - pad.right,
    plotH: height - pad.top - pad.bottom,
    labels,
    series,
    highlights,
    title: attributes.title || "Chart",
    unit: type === "combo-dual-axis" ? attributes.leftUnit || attributes.unit || "" : attributes.unit || "",
    rightUnit: attributes.rightUnit || "",
  };
}

function chartColor(value, fallback) {
  const color = String(value || "").trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)
    ? color
    : fallback;
}

function configureChartSeries(model, type) {
  const barKeys = new Set(listAttribute(model.attributes.bars || model.attributes.bar));
  const lineKeys = new Set(listAttribute(model.attributes.lines || model.attributes.line));

  if ((type === "combo" || type === "combo-dual-axis") && barKeys.size === 0 && lineKeys.size === 0) {
    const [first, ...rest] = model.series;
    if (first) {
      barKeys.add(first.key);
    }
    for (const item of rest) {
      lineKeys.add(item.key);
    }
  }

  for (const item of model.series) {
    item.role = lineKeys.has(item.key) && !barKeys.has(item.key) ? "line" : "bar";
    if (type === "line") {
      item.role = "line";
    }
    if (type === "bar" || type === "grouped-bar" || type === "stacked-bar") {
      item.role = "bar";
    }
    item.axis = "left";
    item.unit = model.unit || "";
  }

  if (type !== "combo-dual-axis") {
    return;
  }

  const explicitRightKeys = listAttribute(
    model.attributes.rightSeries || model.attributes.right || model.attributes.rightAxis || model.attributes.rightY,
  );
  const explicitLeftKeys = listAttribute(
    model.attributes.leftSeries || model.attributes.left || model.attributes.leftAxis || model.attributes.leftY,
  );
  const rightKeys = new Set(explicitRightKeys.length > 0
    ? explicitRightKeys
    : model.series.filter((item) => item.role === "line").map((item) => item.key));
  const leftKeys = new Set(explicitLeftKeys);

  for (const item of model.series) {
    item.axis = rightKeys.has(item.key) && !leftKeys.has(item.key) ? "right" : "left";
    item.unit = item.axis === "right" ? model.rightUnit || "" : model.unit || "";
  }
}

function chartModelError(model, type) {
  if (type !== "combo" && type !== "combo-dual-axis") {
    return null;
  }
  if (!model.series.some((item) => item.role === "bar") || !model.series.some((item) => item.role === "line")) {
    return new Error(`${type} charts require at least one bar series and one line series.`);
  }
  if (type === "combo-dual-axis" && !model.series.some((item) => item.axis === "right")) {
    return new Error("combo-dual-axis charts require at least one right-axis series.");
  }
  return null;
}

function chartValueLabelsEnabled(model) {
  const value = String(model.attributes.labels ?? "").trim().toLowerCase();
  return !["0", "false", "hide", "hidden", "no", "none", "off"].includes(value);
}

function renderLineSvg(model) {
  const values = model.series.flatMap((item) => item.values).filter(Number.isFinite);
  const { min, max } = valueRange(values, { allowNegative: values.some((value) => value < 0) });
  const x = (index) => model.pad.left + (model.labels.length === 1 ? model.plotW / 2 : (model.plotW * index) / (model.labels.length - 1));
  const y = (value) => model.pad.top + ((max - value) * model.plotH) / (max - min || 1);

  return chartSvg(model, {
    min,
    max,
    x,
    y,
    body: renderLineSeries(model, model.series, x, () => y),
  });
}

function renderLineSeries(model, series, x, yForItem) {
  const paths = series.map((item) => {
    const y = yForItem(item);
    const points = item.values
      .map((value, index) => Number.isFinite(value) ? `${x(index).toFixed(1)},${y(value).toFixed(1)}` : null)
      .filter(Boolean)
      .join(" ");
    return `<polyline points="${points}" fill="none" stroke="${item.color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></polyline>`;
  }).join("");

  const markers = series.map((item) => item.values.map((value, index) => {
    if (!Number.isFinite(value)) return "";
    const y = yForItem(item);
    return [
      `<circle class="mdx-chart-point" cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="3" stroke="${item.color}" stroke-width="2"${chartTooltipAttributes(model, index, { mark: true })}></circle>`,
      `<circle class="mdx-chart-hit-target" cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="9" fill="transparent" stroke="transparent"${chartTooltipAttributes(model, index)}></circle>`,
    ].join("");
  }).join("")).join("");

  const labels = chartValueLabelsEnabled(model)
    ? series.map((item, seriesIndex) => item.values.map((value, index) => {
      if (!Number.isFinite(value)) return "";
      const y = yForItem(item);
      const offset = seriesIndex % 2 === 0 ? -10 - Math.floor(seriesIndex / 2) * 12 : 18 + Math.floor(seriesIndex / 2) * 12;
      const labelY = Math.max(model.pad.top + 14, Math.min(model.height - model.pad.bottom - 8, y(value) + offset));
      return chartValueLabel({ x: x(index), y: labelY, value, color: item.color });
    }).join("")).join("")
    : "";

  return paths + markers + labels;
}

function chartValueLabel({ x, y, value, color, className = "" }) {
  const classes = ["mdx-chart-value-label", className].filter(Boolean).join(" ");
  return `<text class="${classes}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="11" font-weight="650" fill="${color}">${formatNumber(value)}</text>`;
}

function renderBarSvg(model) {
  const item = model.series[0];
  const values = item.values.filter(Number.isFinite);
  const { min, max } = valueRange(values, { allowNegative: values.some((value) => value < 0) });
  const groupW = model.plotW / model.labels.length;
  const barW = Math.max(12, Math.min(36, groupW * 0.42));
  const x = (index) => model.pad.left + groupW * index + groupW / 2;
  const y = (value) => model.pad.top + ((max - value) * model.plotH) / (max - min || 1);
  const axisY = y(0);

  const bars = item.values.map((value, index) => {
    if (!Number.isFinite(value)) return "";
    const cx = x(index);
    const by = value >= 0 ? y(value) : axisY;
    const bh = Math.max(1, Math.abs(y(value) - axisY));
    return `<rect x="${(cx - barW / 2).toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${item.color}"${chartTooltipAttributes(model, index, { mark: true })}></rect>`;
  }).join("");
  const labels = chartValueLabelsEnabled(model)
    ? item.values.map((value, index) => {
      if (!Number.isFinite(value)) return "";
      const labelY = value >= 0
        ? Math.max(model.pad.top + 14, y(value) - 8)
        : Math.min(model.height - model.pad.bottom - 6, y(value) + 16);
      return chartValueLabel({ x: x(index), y: labelY, value, color: item.color });
    }).join("")
    : "";

  return chartSvg(model, { min, max, x, y, body: bars + labels });
}

function renderGroupedBarSvg(model) {
  const values = model.series.flatMap((item) => item.values).filter(Number.isFinite);
  const { min, max } = valueRange(values, { allowNegative: values.some((value) => value < 0) });
  const groupW = model.plotW / model.labels.length;
  const barW = Math.max(6, Math.min(18, (groupW * 0.62) / model.series.length));
  const x = (index) => model.pad.left + groupW * index + groupW / 2;
  const y = (value) => model.pad.top + ((max - value) * model.plotH) / (max - min || 1);
  const axisY = y(0);

  const bars = model.series.map((item, seriesIndex) => item.values.map((value, index) => {
    if (!Number.isFinite(value)) return "";
    const clusterW = barW * model.series.length;
    const bx = x(index) - clusterW / 2 + seriesIndex * barW;
    const by = value >= 0 ? y(value) : axisY;
    const bh = Math.max(1, Math.abs(y(value) - axisY));
    return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${Math.max(1, barW - 2).toFixed(1)}" height="${bh.toFixed(1)}" fill="${item.color}"${chartTooltipAttributes(model, index, { mark: true })}></rect>`;
  }).join("")).join("");
  const labels = chartValueLabelsEnabled(model)
    ? model.series.map((item, seriesIndex) => item.values.map((value, index) => {
      if (!Number.isFinite(value)) return "";
      const clusterW = barW * model.series.length;
      const bx = x(index) - clusterW / 2 + seriesIndex * barW;
      const labelY = value >= 0
        ? Math.max(model.pad.top + 14, y(value) - 8)
        : Math.min(model.height - model.pad.bottom - 6, y(value) + 16);
      return chartValueLabel({ x: bx + Math.max(1, barW - 2) / 2, y: labelY, value, color: item.color });
    }).join("")).join("")
    : "";

  return chartSvg(model, { min, max, x, y, body: bars + labels });
}

function renderStackedBarSvg(model) {
  const totals = model.labels.map((_, index) =>
    model.series.reduce((sum, item) => sum + Math.max(0, toNumber(item.values[index]) ?? 0), 0),
  );
  const { min, max } = valueRange(totals, { allowNegative: false });
  const groupW = model.plotW / model.labels.length;
  const barW = Math.max(18, Math.min(48, groupW * 0.46));
  const x = (index) => model.pad.left + groupW * index + groupW / 2;
  const y = (value) => model.pad.top + ((max - value) * model.plotH) / (max - min || 1);

  const bars = model.labels.map((_, index) => {
    let acc = 0;
    return model.series.map((item) => {
      const value = Math.max(0, toNumber(item.values[index]) ?? 0);
      if (!value) return "";
      const y1 = y(acc + value);
      const y0 = y(acc);
      acc += value;
      return `<rect x="${(x(index) - barW / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, y0 - y1).toFixed(1)}" fill="${item.color}"${chartTooltipAttributes(model, index, { mark: true })}></rect>`;
    }).join("");
  }).join("");
  const labels = chartValueLabelsEnabled(model)
    ? model.labels.map((_, index) => {
      let acc = 0;
      return model.series.map((item) => {
        const value = Math.max(0, toNumber(item.values[index]) ?? 0);
        if (!value) return "";
        const y1 = y(acc + value);
        const y0 = y(acc);
        acc += value;
        return chartValueLabel({
          x: x(index),
          y: y1 + (y0 - y1) / 2 + 4,
          value,
          color: "#f8fafc",
          className: "is-inside-bar",
        });
      }).join("");
    }).join("")
    : "";

  return chartSvg(model, { min, max, x, y, body: bars + labels });
}

function renderComboSvg(model, { dualAxis = false } = {}) {
  const barSeries = model.series.filter((item) => item.role === "bar");
  const lineSeries = model.series.filter((item) => item.role === "line");
  const leftSeries = dualAxis ? model.series.filter((item) => item.axis !== "right") : model.series;
  const rightSeries = dualAxis ? model.series.filter((item) => item.axis === "right") : [];
  const leftValues = leftSeries.flatMap((item) => item.values).filter(Number.isFinite);
  const rightValues = rightSeries.flatMap((item) => item.values).filter(Number.isFinite);
  const leftRange = valueRange(leftValues, { allowNegative: leftValues.some((value) => value < 0) });
  const rightRange = dualAxis
    ? valueRange(rightValues, { allowNegative: rightValues.some((value) => value < 0) })
    : null;
  const groupW = model.plotW / model.labels.length;
  const barW = Math.max(8, Math.min(30, (groupW * 0.54) / Math.max(1, barSeries.length)));
  const x = (index) => model.pad.left + groupW * index + groupW / 2;
  const leftY = (value) => model.pad.top + ((leftRange.max - value) * model.plotH) / (leftRange.max - leftRange.min || 1);
  const rightY = rightRange
    ? (value) => model.pad.top + ((rightRange.max - value) * model.plotH) / (rightRange.max - rightRange.min || 1)
    : leftY;

  const bars = barSeries.map((item, seriesIndex) => {
    const itemY = dualAxis && item.axis === "right" ? rightY : leftY;
    const range = dualAxis && item.axis === "right" ? rightRange : leftRange;
    const axisY = axisBaselineY(model, range, itemY);
    return item.values.map((value, index) => {
      if (!Number.isFinite(value)) return "";
      const clusterW = barW * barSeries.length;
      const bx = x(index) - clusterW / 2 + seriesIndex * barW;
      const by = value >= 0 ? itemY(value) : axisY;
      const bh = Math.max(1, Math.abs(itemY(value) - axisY));
      return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${Math.max(1, barW - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${item.color}"${chartTooltipAttributes(model, index, { mark: true })}></rect>`;
    }).join("");
  }).join("");
  const barLabels = chartValueLabelsEnabled(model)
    ? barSeries.map((item, seriesIndex) => {
      const itemY = dualAxis && item.axis === "right" ? rightY : leftY;
      return item.values.map((value, index) => {
        if (!Number.isFinite(value)) return "";
        const clusterW = barW * barSeries.length;
        const bx = x(index) - clusterW / 2 + seriesIndex * barW;
        const labelY = value >= 0
          ? Math.max(model.pad.top + 14, itemY(value) - 8)
          : Math.min(model.height - model.pad.bottom - 6, itemY(value) + 16);
        return chartValueLabel({ x: bx + Math.max(1, barW - 2) / 2, y: labelY, value, color: item.color });
      }).join("");
    }).join("")
    : "";

  const lines = renderLineSeries(model, lineSeries, x, (item) =>
    dualAxis && item.axis === "right" ? rightY : leftY
  );

  return chartSvg(model, {
    min: leftRange.min,
    max: leftRange.max,
    x,
    y: leftY,
    body: bars + barLabels + lines,
    rightAxis: rightRange ? { min: rightRange.min, max: rightRange.max, y: rightY } : null,
  });
}

function chartSvg(model, { min, max, x, y, body, rightAxis = null }) {
  const axisY = axisBaselineY(model, { min, max }, y);
  return [
    `<svg viewBox="0 0 ${model.width} ${model.height}" role="img" aria-label="${escapeHtml(model.title)}">`,
    renderLegend(model),
    renderGrid(model, min, max, y),
    rightAxis ? renderRightAxis(model, rightAxis) : "",
    renderChartActiveGuide(model),
    `<line class="mdx-chart-axis-line" x1="${model.pad.left}" y1="${axisY.toFixed(1)}" x2="${model.width - model.pad.right}" y2="${axisY.toFixed(1)}"></line>`,
    model.unit ? `<text class="mdx-chart-unit-label" x="18" y="${model.pad.top + model.plotH / 2}" transform="rotate(-90 18 ${model.pad.top + model.plotH / 2})" text-anchor="middle" font-size="12" font-weight="700">${escapeHtml(model.translate("chart.unit", { unit: model.unit }))}</text>` : "",
    rightAxis && model.rightUnit ? `<text class="mdx-chart-unit-label mdx-chart-right-unit-label" x="${model.width - 18}" y="${model.pad.top + model.plotH / 2}" transform="rotate(90 ${model.width - 18} ${model.pad.top + model.plotH / 2})" text-anchor="middle" font-size="12" font-weight="700">${escapeHtml(model.translate("chart.unit", { unit: model.rightUnit }))}</text>` : "",
    body,
    renderXAxis(model, x, axisY),
    renderChartTooltipRegions(model, x),
    "</svg>",
  ].join("");
}

function axisBaselineY(model, range, y) {
  return range.min < 0 && range.max > 0 ? y(0) : model.pad.top + model.plotH;
}

function renderLegend(model) {
  let cursor = model.pad.left;
  return model.series.map((item) => {
    const label = escapeHtml(item.label);
    const mark = item.role === "line"
      ? `<line x1="${cursor}" y1="24.5" x2="${cursor + 15}" y2="24.5" stroke="${item.color}" stroke-width="3" stroke-linecap="round"></line>`
      : `<rect x="${cursor}" y="22" width="15" height="5" fill="${item.color}" rx="2"></rect>`;
    const out = `${mark}<text class="mdx-chart-legend-label" x="${cursor + 20}" y="27" font-size="12">${label}</text>`;
    cursor += Math.max(72, item.label.length * 13 + 34);
    return out;
  }).join("");
}

function renderGrid(model, min, max, y) {
  return ticks(min, max, 5).map((tick) => [
    `<line class="mdx-chart-grid-line" x1="${model.pad.left}" y1="${y(tick).toFixed(1)}" x2="${model.width - model.pad.right}" y2="${y(tick).toFixed(1)}"></line>`,
    `<text class="mdx-chart-y-label" x="${model.pad.left - 8}" y="${(y(tick) + 4).toFixed(1)}" text-anchor="end" font-size="11">${formatNumber(tick)}</text>`,
  ].join("")).join("");
}

function renderRightAxis(model, { min, max, y }) {
  return [
    `<line class="mdx-chart-axis-line" x1="${model.width - model.pad.right}" y1="${model.pad.top}" x2="${model.width - model.pad.right}" y2="${model.pad.top + model.plotH}"></line>`,
    ticks(min, max, 5).map((tick) =>
      `<text class="mdx-chart-y-label mdx-chart-right-y-label" x="${model.width - model.pad.right + 8}" y="${(y(tick) + 4).toFixed(1)}" text-anchor="start" font-size="11">${formatNumber(tick)}</text>`
    ).join(""),
  ].join("");
}

function renderXAxis(model, x, axisY) {
  const visibleLabels = visibleXLabelIndices(model, x);
  return model.labels.map((label, index) => {
    const major = visibleLabels.has(index) || model.highlights.has(label);
    const labelClass = model.highlights.has(label)
      ? ' class="mdx-chart-x-label mdx-chart-highlight-label"'
      : ' class="mdx-chart-x-label"';
    const highlight = model.highlights.has(label)
      ? `<rect class="mdx-chart-highlight-bg" x="${(x(index) - Math.max(36, label.length * 7) / 2).toFixed(1)}" y="${model.height - 38}" width="${Math.max(36, label.length * 7)}" height="18"></rect>`
      : "";
    return [
      `<line class="mdx-chart-x-tick${major ? " is-major" : " is-minor"}" x1="${x(index).toFixed(1)}" y1="${axisY.toFixed(1)}" x2="${x(index).toFixed(1)}" y2="${(axisY + (major ? 10 : 5)).toFixed(1)}"></line>`,
      major ? `${highlight}<text${labelClass} x="${x(index).toFixed(1)}" y="${model.height - 24}" text-anchor="middle" font-size="12" font-weight="${model.highlights.has(label) ? 760 : 560}">${escapeHtml(label)}</text>` : "",
    ].join("");
  }).join("");
}

function renderChartActiveGuide(model) {
  return `<line class="mdx-chart-active-guide" x1="${model.pad.left}" y1="${model.pad.top}" x2="${model.pad.left}" y2="${model.pad.top + model.plotH}" aria-hidden="true"></line>`;
}

function renderChartTooltipRegions(model, x) {
  const lastIndex = model.labels.length - 1;
  const plotRight = model.width - model.pad.right;
  return model.labels.map((_, index) => {
    const center = x(index);
    const left = index === 0
      ? model.pad.left
      : (x(index - 1) + center) / 2;
    const right = index === lastIndex
      ? plotRight
      : (center + x(index + 1)) / 2;
    return `<rect class="mdx-chart-x-hit-target" x="${left.toFixed(1)}" y="${model.pad.top.toFixed(1)}" width="${Math.max(0, right - left).toFixed(1)}" height="${model.plotH.toFixed(1)}" fill="transparent" pointer-events="all" data-chart-x-position="${center.toFixed(1)}"${chartTooltipAttributes(model, index)} aria-hidden="true"></rect>`;
  }).join("");
}

function chartTooltipAttributes(model, index, { mark = false } = {}) {
  const label = model.labels[index] || "";
  const seriesLines = model.series
    .map((item) => {
      const value = item.values[index];
      return Number.isFinite(value)
        ? `${item.label}: ${formatTooltipValue(value, item.unit || model.unit || "")}`
        : "";
    })
    .filter(Boolean);
  const tooltip = [
    label,
    ...seriesLines,
  ].filter(Boolean).join("\\n");
  const ariaLabel = tooltip.replaceAll("\\n", ", ");
  return [
    ` data-chart-x-index="${index}"`,
    mark ? ' data-chart-mark="true"' : "",
    ` data-chart-tooltip="${escapeHtml(tooltip)}" aria-label="${escapeHtml(ariaLabel)}"`,
  ].join("");
}

function formatTooltipValue(value, unit) {
  const number = formatTooltipNumber(value);
  if (!unit) return number;
  return unit === "%" ? `${number}%` : `${number} ${unit}`;
}

function renderRichBlock(content) {
  const stripped = stripTextFence(content).trim();
  if (!stripped) return "";

  const blocks = [];
  let paragraph = [];
  let list = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${renderInlineText(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(`<ul>${list.map((item) => `<li>${renderInlineText(item)}</li>`).join("")}</ul>`);
    list = [];
  };

  for (const rawLine of stripped.split(/\r?\n/)) {
    const line = rawLine.trim();
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks.join("");
}

function renderInlineText(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function stripTextFence(content) {
  const dataBlock = extractDataBlock(content);
  if (!dataBlock) return content;
  if (["md", "markdown", "text", "txt"].includes(dataBlock.format)) {
    return dataBlock.body;
  }
  return content;
}

function extractFlowDiagram(content) {
  const parsed = parseJsonValue(content);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray(parsed.nodes)) {
    return normalizeFlowDiagram(parsed.nodes, parsed.edges || parsed.links || []);
  }

  const rows = extractRows(content);
  const nodes = rows.map((row, index) => ({
    id: String(row.id ?? row.key ?? index + 1),
    label: String(row.label ?? row.title ?? row.name ?? row.id ?? index + 1),
    type: normalizeFlowType(row.type ?? row.kind ?? row.status),
    note: row.note ?? row.description ?? "",
    next: row.next ?? row.to ?? "",
  }));
  const edges = nodes.flatMap((node) =>
    listAttribute(node.next).map((target) => ({ from: node.id, to: target, label: "" })),
  );
  return normalizeFlowDiagram(nodes, edges);
}

function normalizeFlowDiagram(rawNodes, rawEdges) {
  const nodes = rawNodes.map((node, index) => {
    const id = String(node.id ?? node.key ?? index + 1).trim();
    return {
      id,
      label: String(node.label ?? node.title ?? node.name ?? id).trim(),
      type: normalizeFlowType(node.type ?? node.kind ?? node.status),
      note: String(node.note ?? node.description ?? "").trim(),
      next: node.next ?? node.to ?? "",
    };
  }).filter((node) => node.id);
  const ids = new Set(nodes.map((node) => node.id));
  const edges = [
    ...rawEdges.map((edge) => ({
      from: String(edge.from ?? edge.source ?? "").trim(),
      to: String(edge.to ?? edge.target ?? "").trim(),
      label: String(edge.label ?? edge.title ?? "").trim(),
    })),
    ...nodes.flatMap((node) =>
      listAttribute(node.next).map((target) => ({ from: node.id, to: target, label: "" })),
    ),
  ].filter((edge) => ids.has(edge.from) && ids.has(edge.to));

  return { nodes, edges };
}

function layoutFlowDiagram(nodes, edges) {
  const levels = computeFlowLevels(nodes, edges);
  const maxLevel = Math.max(...nodes.map((node) => levels.get(node.id) ?? 0), 0);
  const groups = Array.from({ length: maxLevel + 1 }, () => []);
  for (const node of nodes) {
    groups[levels.get(node.id) ?? 0].push(node);
  }

  const nodeW = 200;
  const nodeH = 64;
  const xGap = 34;
  const yGap = 74;
  const margin = 28;
  const maxCols = Math.max(...groups.map((group) => group.length), 1);
  const width = Math.max(760, margin * 2 + maxCols * nodeW + (maxCols - 1) * xGap);
  const height = margin * 2 + groups.length * nodeH + Math.max(0, groups.length - 1) * yGap;
  const positions = new Map();

  groups.forEach((group, level) => {
    const rowW = group.length * nodeW + Math.max(0, group.length - 1) * xGap;
    let x = (width - rowW) / 2;
    const y = margin + level * (nodeH + yGap);
    for (const node of group) {
      positions.set(node.id, { x, y, width: nodeW, height: nodeH });
      x += nodeW + xGap;
    }
  });

  return { width, height, nodes, edges, positions };
}

function computeFlowLevels(nodes, edges) {
  const ids = nodes.map((node) => node.id);
  const levels = new Map(ids.map((id) => [id, 0]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, []]));

  for (const edge of edges) {
    if (!outgoing.has(edge.from) || !indegree.has(edge.to)) continue;
    outgoing.get(edge.from).push(edge.to);
    indegree.set(edge.to, indegree.get(edge.to) + 1);
  }

  const queue = ids.filter((id) => indegree.get(id) === 0);
  const seen = new Set();
  while (queue.length > 0) {
    const id = queue.shift();
    seen.add(id);
    for (const target of outgoing.get(id) || []) {
      levels.set(target, Math.max(levels.get(target), levels.get(id) + 1));
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }

  let fallbackLevel = Math.max(...levels.values(), 0);
  for (const id of ids) {
    if (!seen.has(id)) {
      fallbackLevel += 1;
      levels.set(id, fallbackLevel);
    }
  }
  return levels;
}

function renderFlowEdge(edge, layout) {
  const from = layout.positions.get(edge.from);
  const to = layout.positions.get(edge.to);
  if (!from || !to) return "";
  const sx = from.x + from.width / 2;
  const sy = from.y + from.height;
  const tx = to.x + to.width / 2;
  const ty = to.y;
  const midY = sy + (ty - sy) / 2;
  const label = edge.label
    ? `<text class="mdx-flow-edge-label" x="${((sx + tx) / 2).toFixed(1)}" y="${(midY - 7).toFixed(1)}" text-anchor="middle">${escapeHtml(edge.label)}</text>`
    : "";
  return [
    `<path class="mdx-flow-edge" d="M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${sx.toFixed(1)} ${midY.toFixed(1)}, ${tx.toFixed(1)} ${midY.toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}"></path>`,
    label,
  ].join("");
}

function renderFlowNode(node, layout) {
  const position = layout.positions.get(node.id);
  if (!position) return "";
  const centerX = position.x + position.width / 2;
  const lines = wrapFlowText(node.label);
  const lineHeight = 15;
  const firstY = position.y + position.height / 2 - ((lines.length - 1) * lineHeight) / 2 + 5;
  const title = node.note ? `<title>${escapeHtml(node.note)}</title>` : "";
  const text = lines.map((line, index) =>
    `<tspan x="${centerX.toFixed(1)}" y="${(firstY + index * lineHeight).toFixed(1)}">${escapeHtml(line)}</tspan>`,
  ).join("");

  return [
    `<g class="mdx-flow-node is-${node.type}">`,
    title,
    `<rect x="${position.x.toFixed(1)}" y="${position.y.toFixed(1)}" width="${position.width}" height="${position.height}" rx="8"></rect>`,
    `<text text-anchor="middle">${text}</text>`,
    "</g>",
  ].join("");
}

function wrapFlowText(value, maxWidth = 14, maxLines = 3) {
  const text = String(value ?? "").trim();
  const lines = [];
  let line = "";
  let width = 0;

  for (const char of Array.from(text)) {
    const charWidth = char.charCodeAt(0) > 127 ? 1 : 0.56;
    if (line && width + charWidth > maxWidth) {
      lines.push(line);
      line = "";
      width = 0;
    }
    line += char;
    width += charWidth;
  }
  if (line) lines.push(line);

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, Math.max(1, maxWidth - 3))}...`;
    return kept;
  }
  return lines;
}

function extractRows(content) {
  const dataBlock = extractDataBlock(content);
  if (dataBlock) {
    if (dataBlock.format === "json") {
      return rowsFromJson(dataBlock.body);
    }
    if (dataBlock.format === "tsv") {
      return rowsFromDelimited(dataBlock.body, "\t");
    }
    return rowsFromDelimited(dataBlock.body, ",");
  }

  const trimmed = content.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return rowsFromJson(trimmed);
  }
  if (trimmed.includes("|")) {
    return rowsFromMarkdownTable(trimmed);
  }
  return rowsFromDelimited(trimmed, ",");
}

function extractDataBlock(content) {
  const match = content.match(/^\s*```([A-Za-z0-9_-]+)?[^\n]*\r?\n([\s\S]*?)\r?\n```\s*$/);
  if (!match) return null;
  return {
    format: (match[1] || "csv").toLowerCase(),
    body: match[2],
  };
}

function parseJsonValue(content) {
  const dataBlock = extractDataBlock(content);
  if (dataBlock && dataBlock.format !== "json") return null;
  const body = (dataBlock ? dataBlock.body : content).trim();
  if (!body || (!body.startsWith("{") && !body.startsWith("["))) return null;
  return JSON.parse(body);
}

function rowsFromJson(content) {
  const parsed = JSON.parse(content);
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => row && typeof row === "object");
}

function rowsFromDelimited(content, delimiter) {
  const records = parseDelimitedRecords(content.trim(), delimiter);
  if (records.length < 2) return [];
  const headers = records[0].map((header) => String(header).trim());
  return records.slice(1)
    .filter((record) => record.some((value) => String(value).trim() !== ""))
    .map((record) => Object.fromEntries(headers.map((header, index) => [header, parseCell(record[index] ?? "")])));
}

function rowsFromMarkdownTable(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().startsWith("|"));
  if (lines.length < 3) return [];
  const headers = splitMarkdownRow(lines[0]);
  return lines.slice(2).map((line) => {
    const cells = splitMarkdownRow(line);
    return Object.fromEntries(headers.map((header, index) => [header, parseCell(cells[index] ?? "")]));
  });
}

function splitMarkdownRow(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function columnsForRows(rows, rawColumns) {
  const configured = listAttribute(rawColumns);
  if (configured.length > 0) {
    return configured;
  }
  return [...new Set(rows.flatMap((row) => Object.keys(row)))];
}

function listAttribute(value) {
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function parseCell(value) {
  const text = String(value).trim();
  if (text === "") return "";
  const number = Number(text);
  return Number.isFinite(number) && /^-?\d+(?:\.\d+)?$/.test(text) ? number : text;
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/,/g, "").trim();
  if (normalized === "") return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function valueRange(values, { allowNegative }) {
  const fallback = values.length ? values : [0, 1];
  const minVal = Math.min(...fallback, allowNegative ? 0 : 0);
  const maxVal = Math.max(...fallback, 1);
  const padding = (maxVal - minVal || 1) * 0.08;
  return {
    min: allowNegative ? minVal - padding : 0,
    max: maxVal + padding,
  };
}

function ticks(min, max, count) {
  return Array.from({ length: count + 1 }, (_, index) => min + ((max - min) * index) / count);
}

function visibleXLabelIndices(model, x) {
  const lastIndex = model.labels.length - 1;
  if (lastIndex <= 0) {
    return new Set([0]);
  }

  const widths = model.labels.map(estimatedXLabelWidth);
  const hasSpace = (leftIndex, rightIndex) => (
    x(rightIndex) - x(leftIndex)
    >= widths[leftIndex] / 2 + widths[rightIndex] / 2 + 12
  );
  const visible = [0];
  for (let index = 1; index < lastIndex; index += 1) {
    if (hasSpace(visible.at(-1), index) && hasSpace(index, lastIndex)) {
      visible.push(index);
    }
  }
  visible.push(lastIndex);
  return new Set(visible);
}

function estimatedXLabelWidth(value) {
  let width = 0;
  for (const character of String(value ?? "")) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (/\s/.test(character)) {
      width += 4;
    } else if (codePoint > 0xff) {
      width += 12;
    } else if (/[ilI1.,:;|'!]/.test(character)) {
      width += 4.5;
    } else if (/[MW@#%&]/.test(character)) {
      width += 9;
    } else {
      width += 7;
    }
  }
  return Math.max(12, width);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function formatTooltipNumber(value) {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function normalizeStatus(value) {
  const status = String(value || "default").trim().toLowerCase();
  if (["done", "complete", "completed", "success"].includes(status)) return "done";
  if (["blocked", "risk", "warning"].includes(status)) return "blocked";
  if (["active", "doing", "progress", "in-progress"].includes(status)) return "active";
  return "default";
}

function normalizeDecisionStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (["accepted", "proposed", "rejected", "superseded"].includes(status)) return status;
  if (["done", "complete", "completed"].includes(status)) return "accepted";
  return status ? "default" : "";
}

function normalizeMetricStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (["good", "up", "positive", "success", "active"].includes(status)) return "good";
  if (["risk", "warning", "blocked", "down", "negative"].includes(status)) return "risk";
  if (["watch", "flat", "neutral"].includes(status)) return "watch";
  if (/^\+/.test(status)) return "good";
  if (/^-/.test(status)) return "risk";
  return "neutral";
}

function normalizeFlowType(value) {
  const type = String(value || "action").trim().toLowerCase();
  if (["start", "end", "decision", "gate", "risk", "action"].includes(type)) return type;
  if (["warning", "blocked", "error"].includes(type)) return "risk";
  if (["question", "branch", "condition"].includes(type)) return "decision";
  return "action";
}

function componentError(name, error, translate = createTranslator(MDX_MESSAGES, "en")) {
  return `<div class="mdx-component-error" data-mdx-component="${escapeHtml(name || "Unknown")}">${escapeHtml(translate("component.error", { message: error.message }))}</div>`;
}

function findClosingLine(state, startLine, endLine, name) {
  for (let lineIndex = startLine; lineIndex < endLine; lineIndex += 1) {
    if (sourceLine(state, lineIndex).trim() === `</${name}>`) {
      return lineIndex;
    }
  }
  return -1;
}

function sourceLine(state, lineIndex) {
  return state.src.slice(
    state.bMarks[lineIndex] + state.tShift[lineIndex],
    state.eMarks[lineIndex],
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
