import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  startCompletion,
} from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import {
  Compartment,
  EditorState,
  EditorSelection,
  Facet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  crosshairCursor,
  Decoration,
  dropCursor,
  GutterMarker,
  gutterLineClass,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
  WidgetType,
} from "@codemirror/view";
import { EditorView, minimalSetup } from "codemirror";

import { renderMarkdown } from "../content/markdown.mjs";
import { findTextMatches } from "../../public/document-search.js";
import { enhanceImageLoadStates } from "../../public/image-preview.js";
import { createTranslator } from "../../public/i18n.js";

const livePreviewEnterEffect = StateEffect.define();
const livePreviewExitEffect = StateEffect.define();
const sourceEditorSetup = [
  minimalSetup,
  lineNumbers(),
  highlightActiveLineGutter(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...completionKeymap,
  ]),
];
const liveRenderOptionsFacet = Facet.define({
  combine(values) {
    return values[0] ?? {};
  },
});
const cursorPlaceholder = "{{cursor}}";
const mdxLiteComponentNames = [
  "DataTable",
  "Timeline",
  "Chart",
  "DecisionBox",
  "MetricGrid",
  "FlowDiagram",
];
const imageWidthSteps = [320, 480, 640, 760, 960, 1200];

const SOURCE_EDITOR_SLASH_MESSAGES = {
  en: {
    "frontmatter.title": "Document frontmatter",
    "frontmatter.description": "Insert document metadata",
    "quote.title": "Quote",
    "quote.description": "Insert a block quote",
    "code.title": "Code block",
    "code.description": "Insert a fenced code block",
    "link.title": "External link",
    "link.description": "Insert an external Markdown link",
    "doclink.title": "Repository document link",
    "doclink.description": "Link to another document in this repository",
    "datatable.title": "DataTable",
    "datatable.description": "Insert a CSV-backed data table",
    "datatable.example": "Example",
    "timeline.title": "Timeline",
    "timeline.description": "Insert a JSON-backed timeline",
    "timeline.exampleTitle": "Milestone",
    "timeline.exampleBody": "Add details",
    "chart.title": "Chart",
    "chart.description": "Insert a CSV-backed chart",
    "decision.title": "DecisionBox",
    "decision.description": "Insert a structured decision summary",
    "decision.rowDecision": "Decision",
    "decision.rowReason": "Reason",
    "decision.rowTradeoff": "Trade-off",
    "metrics.title": "MetricGrid",
    "metrics.description": "Insert a metric card grid",
    "metrics.exampleLabel": "Core metric",
    "metrics.exampleNote": "Definition",
    "flow.title": "FlowDiagram",
    "flow.description": "Insert a JSON-backed flow diagram",
    "flow.start": "Start",
    "flow.done": "Done",
  },
  "zh-CN": {
    "frontmatter.title": "文档 frontmatter",
    "frontmatter.description": "插入文档元数据",
    "quote.title": "引用",
    "quote.description": "插入引用块",
    "code.title": "代码块",
    "code.description": "插入围栏代码块",
    "link.title": "外部链接",
    "link.description": "插入外部 Markdown 链接",
    "doclink.title": "仓库文档链接",
    "doclink.description": "链接到当前仓库中的其他文档",
    "datatable.title": "DataTable 数据表",
    "datatable.description": "插入由 CSV 数据驱动的数据表",
    "datatable.example": "示例",
    "timeline.title": "Timeline 时间线",
    "timeline.description": "插入由 JSON 数据驱动的时间线",
    "timeline.exampleTitle": "关键节点",
    "timeline.exampleBody": "补充说明",
    "chart.title": "Chart 统计图表",
    "chart.description": "插入由 CSV 数据驱动的统计图表",
    "decision.title": "DecisionBox 决策摘要",
    "decision.description": "插入结构化决策摘要",
    "decision.rowDecision": "决策",
    "decision.rowReason": "理由",
    "decision.rowTradeoff": "代价",
    "metrics.title": "MetricGrid 指标卡",
    "metrics.description": "插入指标卡网格",
    "metrics.exampleLabel": "核心指标",
    "metrics.exampleNote": "口径说明",
    "flow.title": "FlowDiagram 流程图",
    "flow.description": "插入由 JSON 数据驱动的流程图",
    "flow.start": "开始",
    "flow.done": "完成",
  },
};

const slashCommandDefinitions = [
  {
    label: "frontmatter",
    detail: "Markdown",
    template: ({ today }) => [
      "---",
      "title: {{cursor}}",
      "domain: ",
      "type: ",
      "owner: ",
      `last_updated: ${today}`,
      "canonical: false",
      "---",
      "",
    ].join("\n"),
  },
  {
    label: "quote",
    detail: "Markdown",
    template: "> {{cursor}}",
  },
  {
    label: "code",
    detail: "Markdown",
    template: "```text\n{{cursor}}\n```",
  },
  {
    label: "link",
    detail: "Markdown",
    custom: "link",
  },
  {
    label: "doclink",
    detail: "Markdown",
    custom: "doclink",
  },
  {
    label: "datatable",
    detail: "MDX-lite",
    requiresMdx: true,
    template: ({ translate }) => [
      '<DataTable title="{{cursor}}">',
      "```csv",
      "name,value,status",
      `${translate("datatable.example")},1,active`,
      "```",
      "</DataTable>",
    ].join("\n"),
  },
  {
    label: "timeline",
    detail: "MDX-lite",
    requiresMdx: true,
    template: ({ translate }) => [
      '<Timeline title="{{cursor}}">',
      "```json",
      "[",
      `  {"date":"2026-07-04","title":"${translate("timeline.exampleTitle")}","body":"${translate("timeline.exampleBody")}","status":"active"}`,
      "]",
      "```",
      "</Timeline>",
    ].join("\n"),
  },
  {
    label: "chart",
    detail: "MDX-lite",
    requiresMdx: true,
    template: [
      '<Chart title="{{cursor}}" type="line" x="month" series="value" unit="">',
      "```csv",
      "month,value",
      "2026-06,100",
      "2026-07,120",
      "```",
      "</Chart>",
    ].join("\n"),
  },
  {
    label: "decision",
    detail: "MDX-lite",
    requiresMdx: true,
    template: ({ translate }) => [
      '<DecisionBox title="{{cursor}}" status="proposed" owner="">',
      "```csv",
      "label,value",
      `${translate("decision.rowDecision")},`,
      `${translate("decision.rowReason")},`,
      `${translate("decision.rowTradeoff")},`,
      "```",
      "</DecisionBox>",
    ].join("\n"),
  },
  {
    label: "metrics",
    detail: "MDX-lite",
    requiresMdx: true,
    template: ({ translate }) => [
      '<MetricGrid title="{{cursor}}">',
      "```csv",
      "label,value,delta,note,status",
      `${translate("metrics.exampleLabel")},0,,${translate("metrics.exampleNote")},neutral`,
      "```",
      "</MetricGrid>",
    ].join("\n"),
  },
  {
    label: "flow",
    detail: "MDX-lite",
    requiresMdx: true,
    template: ({ translate }) => [
      '<FlowDiagram title="{{cursor}}">',
      "```json",
      "{",
      '  "nodes": [',
      `    {"id": "start", "label": "${translate("flow.start")}", "type": "start"},`,
      `    {"id": "done", "label": "${translate("flow.done")}", "type": "end"}`,
      "  ],",
      '  "edges": [',
      '    {"from": "start", "to": "done"}',
      "  ]",
      "}",
      "```",
      "</FlowDiagram>",
    ].join("\n"),
  },
];

export function slashCommandsForLocale({ locale, language } = {}) {
  const translate = createTranslator(SOURCE_EDITOR_SLASH_MESSAGES, locale ?? language);
  return slashCommandDefinitions.map((definition) => {
    const command = {
      ...definition,
      locale: translate.locale,
      title: translate(`${definition.label}.title`),
      description: translate(`${definition.label}.description`),
    };
    if (typeof definition.template === "function") {
      command.template = ({ today }) => definition.template({ today, translate });
    }
    return command;
  });
}

export const SLASH_COMMANDS = slashCommandsForLocale();

const liveEditingSuppression = StateField.define({
  create() {
    return false;
  },
  update(isSuppressed, transaction) {
    let enterEditing = false;
    let exitEditing = false;
    for (const effect of transaction.effects) {
      if (effect.is(livePreviewExitEffect)) {
        exitEditing = true;
      }
      if (effect.is(livePreviewEnterEffect)) {
        enterEditing = true;
      }
    }

    return nextLiveEditingSuppression(isSuppressed, {
      docChanged: transaction.docChanged,
      enterEditing,
      exitEditing,
    });
  },
});

const liveMarkdownDecorations = StateField.define({
  create(state) {
    return buildLiveMarkdownDecorations(state);
  },
  update(decorations, transaction) {
    const selectionChanged = !transaction.startState.selection.eq(transaction.state.selection);
    const activeLineSuppressed = transaction.state.field(liveEditingSuppression, false);
    const activeLineSuppressionChanged =
      transaction.startState.field(liveEditingSuppression, false) !== activeLineSuppressed;
    if (transaction.docChanged || selectionChanged || activeLineSuppressionChanged) {
      return buildLiveMarkdownDecorations(transaction.state, {
        suppressActiveLine: activeLineSuppressed,
      });
    }

    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const selectedLinesEffect = StateEffect.define();
const documentSearchEffect = StateEffect.define();

const documentSearchDecorations = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(documentSearchEffect)) {
        return buildDocumentSearchDecorations(transaction.state, effect.value);
      }
    }
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const selectedLineGutterClasses = StateField.define({
  create() {
    return Decoration.none;
  },
  update(gutterClasses, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(selectedLinesEffect)) {
        return buildSelectedLineGutterClasses(transaction.state, effect.value);
      }
    }

    return gutterClasses.map(transaction.changes);
  },
  provide: (field) => gutterLineClass.from(field),
});

const selectedLineGutterMarker = new class extends GutterMarker {
  elementClass = "cm-source-line-selected";

  eq(other) {
    return other === this;
  }
}();

function themeFromInput(theme) {
  return String(theme ?? "").trim().toLowerCase() === "dark" ? "dark" : "light";
}

function isDarkTheme(theme) {
  return themeFromInput(theme) === "dark";
}

function editorThemeExtensions(theme) {
  return [
    sourceEditorThemeForTheme(theme),
    sourceSelectionThemeForTheme(theme),
  ];
}

function sourceEditorThemeForTheme(theme) {
  return EditorView.theme({
    "&.cm-editor": {
      backgroundColor: "var(--panel)",
      color: "var(--text)",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-scroller": {
      backgroundColor: "var(--panel)",
      paddingLeft: "var(--source-line-gutter-inset)",
    },
    ".cm-content": {
      caretColor: "var(--text)",
      paddingLeft: "var(--source-line-gutter-gap)",
    },
    ".cm-gutters": {
      minWidth: "var(--source-line-gutter-width)",
      backgroundColor: "transparent",
      borderRightColor: "transparent",
      boxSizing: "border-box",
      color: "var(--source-line-number-color)",
    },
    ".cm-lineNumbers": {
      boxSizing: "border-box",
      minWidth: "var(--source-line-gutter-width)",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      boxSizing: "border-box",
      fontSize: "var(--source-line-number-font-size)",
      lineHeight: "var(--source-line-number-line-height)",
      minHeight: "var(--source-line-number-height)",
      minWidth: "var(--source-line-gutter-width)",
      padding: "0 var(--source-line-number-padding)",
      textAlign: "right",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--panel-weak)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--panel-weak)",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: isDarkTheme(theme)
        ? "rgba(122, 162, 247, 0.35)"
        : "rgba(37, 99, 235, 0.18)",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--text)",
    },
  }, { dark: isDarkTheme(theme) });
}

function sourceSelectionThemeForTheme(theme) {
  return EditorView.theme({
    ".cm-lineNumbers .cm-gutterElement.cm-source-line-selected": {
      backgroundColor: "var(--selection-bg)",
      borderRadius: "4px",
      boxShadow: "0 0 0 2px var(--selection-ring)",
      color: "var(--selection-text)",
      fontWeight: "750",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      boxSizing: "border-box",
      cursor: "pointer",
      fontSize: "var(--source-line-number-font-size)",
      lineHeight: "var(--source-line-number-line-height)",
      minHeight: "var(--source-line-number-height)",
      minWidth: "var(--source-line-gutter-width)",
      padding: "0 var(--source-line-number-padding)",
      textAlign: "right",
    },
  }, { dark: isDarkTheme(theme) });
}

function liveMarkdownThemeForTheme(theme) {
  return EditorView.theme({
    "&.cm-editor": {
      backgroundColor: "var(--panel)",
      color: "var(--text)",
    },
    ".cm-content": {
      color: "var(--text)",
      fontFamily:
        "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: "var(--document-font-size)",
      lineHeight: "var(--document-line-height)",
      paddingLeft: "var(--source-line-gutter-gap)",
      paddingTop: "var(--document-top-padding)",
    },
    ".cm-scroller": {
      paddingLeft: "var(--source-line-gutter-inset)",
    },
    ".cm-lineNumbers": {
      transform: "translateY(calc(var(--source-line-number-height) * -1))",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      fontSize: "var(--source-line-number-font-size)",
      lineHeight: "var(--source-line-number-line-height)",
      minHeight: "var(--source-line-number-height)",
      minWidth: "var(--source-line-gutter-width)",
      padding: "0 var(--source-line-number-padding)",
      textAlign: "right",
    },
    ".cm-line": {
      fontSize: "var(--document-font-size)",
      lineHeight: "var(--document-line-height)",
      padding: "0 var(--document-inline-padding) 0 0",
    },
    ".cm-activeLine": {
      backgroundColor: "transparent",
    },
    "&.cm-focused .cm-activeLine": {
      backgroundColor: "var(--panel-weak)",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      borderRightColor: "transparent",
      boxSizing: "border-box",
      color: "var(--source-line-number-color)",
      minWidth: "var(--source-line-gutter-width)",
    },
    ".cm-line.cm-live-heading": {
      paddingTop: "0.45em",
      paddingBottom: "0.16em",
    },
    ".cm-live-frontmatter": {
      color: "var(--text-secondary)",
      backgroundColor: "var(--panel-weak)",
      boxShadow: "inset 1px 0 0 var(--panel-border)",
    },
    ".cm-live-frontmatter, .cm-live-frontmatter *": {
      color: "var(--text-secondary)",
    },
    ".cm-live-frontmatter-key": {
      color: "var(--accent-text)",
      fontWeight: "720",
    },
    ".cm-live-frontmatter-value": {
      color: "var(--text)",
    },
    ".cm-live-heading": {
      color: "var(--text-strong)",
      fontWeight: "700",
    },
    ".cm-live-heading-1": {
      fontSize: "var(--document-heading-1-size)",
      lineHeight: "var(--document-heading-line-height)",
    },
    ".cm-live-heading-2": {
      borderBottom: "var(--document-heading-border)",
      fontSize: "var(--document-heading-2-size)",
      lineHeight: "var(--document-heading-line-height)",
      paddingBottom: "var(--document-heading-2-padding-bottom)",
    },
    ".cm-live-heading-3": {
      fontSize: "var(--document-heading-3-size)",
      lineHeight: "var(--document-heading-line-height)",
    },
    ".cm-live-blockquote": {
      color: "var(--text-secondary)",
      borderLeft: "4px solid var(--accent)",
      backgroundColor: "var(--panel-weak)",
      paddingLeft: "16px",
    },
    ".cm-live-code": {
      color: "var(--text)",
      border: "1px solid var(--panel-border)",
      borderRadius: "8px",
      backgroundColor: "var(--code-bg)",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
    },
    ".cm-live-marker": {
      color: "var(--text-secondary)",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      opacity: "0.9",
    },
    ".cm-live-marker *": {
      color: "inherit",
    },
    ".cm-activeLine .cm-live-marker": {
      opacity: "1",
    },
    ".cm-live-replacement-widget": {
      color: "var(--text)",
    },
    ".cm-live-list-widget": {
      display: "inline-flex",
      alignItems: "center",
      boxSizing: "border-box",
      color: "var(--text)",
      fontFamily:
        "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: "var(--document-list-ordered-marker-font-size)",
      fontWeight: "720",
      lineHeight: "inherit",
      marginRight: "var(--document-list-marker-gap)",
    },
    ".cm-live-list-widget.is-unordered": {
      fontSize: "var(--document-font-size)",
    },
    ".cm-live-list-widget.is-unordered::before": {
      content: "\"•\"",
      display: "inline-block",
      width: "1em",
      fontSize: "var(--document-list-unordered-marker-font-size)",
      lineHeight: "1",
      textAlign: "center",
    },
    ".cm-live-strong": {
      color: "var(--text-strong)",
      fontWeight: "700",
    },
    ".cm-live-strong *": {
      color: "inherit",
    },
    ".cm-live-emphasis": {
      fontStyle: "italic",
    },
    ".cm-live-inline-code": {
      borderRadius: "4px",
      backgroundColor: "var(--code-bg)",
      color: "var(--text-strong)",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      fontSize: "0.92em",
      padding: "2px 5px",
    },
    ".cm-live-inline-code *": {
      color: "inherit",
    },
    ".cm-live-link-text": {
      color: "var(--accent-text)",
      cursor: "pointer",
      textDecoration: "underline",
      textUnderlineOffset: "3px",
    },
    ".cm-live-link-destination": {
      opacity: "0.78",
    },
    ".cm-line.cm-live-horizontal-rule": {
      color: "var(--accent-text)",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      fontWeight: "800",
    },
    ".cm-line.cm-live-horizontal-rule, .cm-line.cm-live-horizontal-rule *": {
      color: "var(--accent-text)",
    },
    ".cm-line.cm-live-horizontal-rule::after": {
      content: "\"\"",
      display: "inline-block",
      width: "160px",
      marginLeft: "12px",
      borderTop: "2px solid var(--accent-hover)",
      boxShadow: "0 0 0 1px var(--accent-tint)",
      verticalAlign: "middle",
    },
    ".cm-line.cm-live-mdx-component": {
      backgroundColor: "var(--panel-weak)",
      color: "var(--text-secondary)",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      fontSize: "14px",
      boxShadow: "inset 4px 0 0 var(--accent-hover)",
    },
    ".cm-line.cm-live-mdx-component-start::before": {
      content: "attr(data-live-component)",
      display: "block",
      margin: "10px 0 6px",
      border: "1px solid var(--accent)",
      borderRadius: "6px",
      backgroundColor: "var(--accent-soft)",
      color: "var(--accent-text)",
      fontFamily:
        "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: "14px",
      fontWeight: "760",
      lineHeight: "1.35",
      padding: "9px 11px",
    },
    ".cm-live-block-preview": {
      boxSizing: "border-box",
      width: "100%",
      padding: "10px var(--document-inline-padding) 16px 0",
    },
    ".cm-live-block-preview-card": {
      boxSizing: "border-box",
      width: "100%",
      color: "var(--text)",
    },
    ".cm-live-block-preview .source-line-gutter": {
      display: "none",
    },
    ".cm-live-block-preview .source-block": {
      display: "block",
      padding: "0",
    },
    ".cm-live-block-preview .source-block-content": {
      display: "block",
      margin: "0",
    },
    ".cm-live-block-preview .table-toolbar": {
      display: "none",
    },
    ".cm-live-block-preview .table-card": {
      margin: "0",
    },
    ".cm-live-block-preview .mdx-component": {
      margin: "0",
    },
    ".cm-live-block-preview .mdx-component-title,\n.cm-live-block-preview .mdx-chart figcaption,\n.cm-live-block-preview .mdx-flow-diagram figcaption": {
      color: "var(--text-strong)",
    },
    ".cm-live-block-preview .mdx-chart svg": {
      maxWidth: "100%",
      height: "auto",
    },
    ".cm-live-block-preview .git-leaf-image-frame": {
      margin: "0",
    },
    ".cm-live-block-preview .git-leaf-image-frame img": {
      maxWidth: "100%",
      height: "auto",
    },
  }, { dark: isDarkTheme(theme) });
}

export function createSourceEditor({
  parent,
  doc = "",
  locale,
  language,
  onChange,
  onScroll,
  onLineSelect,
  onBlankClick,
  onImageClick,
  onLinkClick,
  onFrontmatterClick,
  onPasteImage,
  onPasteText,
  onSlashCommand,
  theme = "light",
  getDocumentPath = () => "",
  getRenderOptions = () => ({}),
  onBeforeSlashCommand = async () => true,
}) {
  let suppressChange = false;
  let currentMode = "source";
  let currentTheme = themeFromInput(theme);
  let currentEditable = true;
  const themeCompartment = new Compartment();
  const liveModeCompartment = new Compartment();
  const editableCompartment = new Compartment();
  function liveModeExtensions() {
    return currentMode === "live"
      ? [
          liveRenderOptionsFacet.of(getRenderOptions()),
          liveEditingSuppression,
          liveMarkdownDecorations,
          liveMarkdownThemeForTheme(currentTheme),
        ]
      : [];
  }

  const view = new EditorView({
    doc,
    extensions: [
      sourceEditorSetup,
      markdown(),
      EditorView.lineWrapping,
      selectedLineGutterClasses,
      documentSearchDecorations,
      themeCompartment.of(editorThemeExtensions(currentTheme)),
      liveModeCompartment.of([]),
      editableCompartment.of([
        EditorState.readOnly.of(false),
        EditorView.editable.of(true),
      ]),
      autocompletion({
        override: [
          slashCommandCompletionSource({
            locale,
            language,
            getDocumentPath,
            onBeforeSlashCommand,
            onSlashCommand,
          }),
        ],
        icons: false,
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || suppressChange) {
          return;
        }
        onChange?.(update.state.doc.toString());
      }),
      EditorView.domEventHandlers({
        keydown(event, eventView) {
          if (
            (currentMode === "source" || currentMode === "live") &&
            event.key === "/" &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
          ) {
            setTimeout(() => startCompletion(eventView), 0);
            return false;
          }

          if (currentMode === "live" && event.key === "Tab") {
            if (adjustCurrentListItemIndent(eventView, event.shiftKey ? "outdent" : "indent")) {
              event.preventDefault();
              return true;
            }
            return false;
          }

          if (currentMode !== "live" || event.key !== "Escape") {
            return false;
          }

          event.preventDefault();
          eventView.dispatch({
            effects: livePreviewExitEffect.of(true),
          });
          eventView.contentDOM.blur();
          return true;
        },
        focusin(_event, eventView) {
          if (currentMode !== "live") {
            return false;
          }

          eventView.dispatch({
            effects: livePreviewEnterEffect.of(true),
          });
          return false;
        },
        paste(event, eventView) {
          const imageFile = clipboardImageFile(event.clipboardData);
          if (!imageFile || typeof onPasteImage !== "function") {
            const text = pastedTextLinkCandidate(event.clipboardData?.getData("text/plain"));
            if (!text || typeof onPasteText !== "function") {
              return false;
            }

            event.preventDefault();
            void pasteTextAsLinkIntoEditor(eventView, text, onPasteText);
            return true;
          }

          event.preventDefault();
          void pasteImageIntoEditor(eventView, imageFile, onPasteImage);
          return true;
        },
      }),
    ],
    parent,
  });
  const handleMouseDown = (event) => {
    const sourceLine = lineNumberFromGutterEvent(event, view);
    if (Number.isInteger(sourceLine)) {
      event.preventDefault();
      onLineSelect?.(sourceLine, event);
      return;
    }

    if (currentMode !== "live") {
      return;
    }

    const link = liveMarkdownLinkFromMouseEvent(event, view);
    if (link) {
      event.preventDefault();
      event.stopPropagation();
      onLinkClick?.({ ...link, event });
      return;
    }

    const field = liveFrontmatterFieldFromMouseEvent(event, view);
    if (field) {
      event.preventDefault();
      event.stopPropagation();
      onFrontmatterClick?.({ ...field, event });
      return;
    }

    const image = closestElement(event.target, "[data-git-leaf-image]");
    if (image) {
      const block = image.closest(".cm-live-block-preview");
      const line = Number(block?.dataset.liveBlockStart);
      if (!Number.isInteger(line)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onImageClick?.({ line, image, event });
      return;
    }

    if (isLiveBlankClick(event)) {
      onBlankClick?.(event);
    }
  };
  const visibleLine = () => {
    const scrollRect = view.scrollDOM.getBoundingClientRect();
    const pos = view.posAtCoords({
      x: scrollRect.left + 64,
      y: scrollRect.top + 8,
    });
    return Number.isInteger(pos) ? view.state.doc.lineAt(pos).number : null;
  };
  const handleScroll = () => {
    const line = visibleLine();
    onScroll?.({
      scrollTop: view.scrollDOM.scrollTop,
      scrollHeight: view.scrollDOM.scrollHeight,
      clientHeight: view.scrollDOM.clientHeight,
      visibleLine: line,
    });
  };
  view.dom.addEventListener("mousedown", handleMouseDown, true);
  view.scrollDOM.addEventListener("scroll", handleScroll);

  return {
    getValue() {
      return view.state.doc.toString();
    },
    setValue(value, { preserveSelection = false } = {}) {
      const nextValue = String(value ?? "");
      const currentValue = view.state.doc.toString();
      if (currentValue === nextValue) {
        return;
      }
      suppressChange = true;
      try {
        view.dispatch({
          changes: preserveSelection
            ? minimalDocumentChange(currentValue, nextValue)
            : {
                from: 0,
                to: view.state.doc.length,
                insert: nextValue,
              },
        });
      } finally {
        suppressChange = false;
      }
    },
    focus() {
      view.focus();
    },
    selectedText() {
      const range = view.state.selection.main;
      return range.empty ? "" : view.state.sliceDoc(range.from, range.to);
    },
    findMatches(query) {
      return findTextMatches(view.state.doc.toString(), query);
    },
    setSearchMatches(matches, activeIndex, { reveal = false } = {}) {
      const effects = [documentSearchEffect.of({ matches, activeIndex })];
      const activeMatch = matches?.[activeIndex];
      if (reveal && activeMatch) {
        effects.push(EditorView.scrollIntoView(activeMatch.from, { y: "center" }));
      }
      view.dispatch({ effects });
    },
    clearSearchMatches() {
      view.dispatch({
        effects: documentSearchEffect.of({ matches: [], activeIndex: -1 }),
      });
    },
    setMode(mode) {
      currentMode = mode;
      view.dispatch({
        effects: liveModeCompartment.reconfigure(liveModeExtensions()),
      });
    },
    setEditable(editable) {
      const nextEditable = editable !== false;
      if (nextEditable === currentEditable) {
        return;
      }
      currentEditable = nextEditable;
      view.dispatch({
        effects: editableCompartment.reconfigure([
          EditorState.readOnly.of(!currentEditable),
          EditorView.editable.of(currentEditable),
        ]),
      });
    },
    setTheme(theme) {
      const nextTheme = themeFromInput(theme);
      if (nextTheme === currentTheme) {
        return;
      }
      currentTheme = nextTheme;
      view.dispatch({
        effects: [
          themeCompartment.reconfigure(editorThemeExtensions(currentTheme)),
          liveModeCompartment.reconfigure(liveModeExtensions()),
        ],
      });
    },
    scrollToLine(lineNumber) {
      if (!Number.isInteger(lineNumber)) {
        return;
      }
      const line = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, lineNumber)));
      view.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: "start" }),
      });
    },
    visibleLine() {
      return visibleLine();
    },
    setSelectedLines(lines) {
      view.dispatch({
        effects: selectedLinesEffect.of([...new Set(lines)].filter(Number.isInteger)),
      });
    },
    replaceLine(lineNumber, text, { preserveSelection = false } = {}) {
      if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > view.state.doc.lines) {
        return false;
      }

      const line = view.state.doc.line(lineNumber);
      const transaction = {
        changes: {
          from: line.from,
          to: line.to,
          insert: String(text ?? ""),
        },
        scrollIntoView: true,
      };
      if (!preserveSelection) {
        transaction.selection = {
          anchor: line.from + String(text ?? "").length,
        };
      }
      view.dispatch(transaction);
      return true;
    },
    lineRect(lineNumber) {
      if (!Number.isInteger(lineNumber)) {
        return null;
      }

      const line = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, lineNumber)));
      const coords = view.coordsAtPos(line.from);
      if (!coords) {
        return null;
      }

      const gutterRect = view.dom.querySelector(".cm-gutters")?.getBoundingClientRect();
      return {
        left: gutterRect?.left ?? coords.left,
        top: coords.top,
        height: Math.max(coords.bottom - coords.top, 1),
      };
    },
    imageElement(lineNumber) {
      if (!Number.isInteger(lineNumber)) {
        return null;
      }

      return view.dom.querySelector(
        `.cm-live-block-preview[data-live-block-start="${lineNumber}"] [data-git-leaf-image]`,
      );
    },
    linkElement(lineNumber, from, to) {
      if (!Number.isInteger(lineNumber) || !Number.isInteger(from) || !Number.isInteger(to)) {
        return null;
      }

      return view.dom.querySelector(
        [
          ".cm-live-link-text",
          "[data-live-link=\"true\"]",
          `[data-live-line="${lineNumber}"]`,
          `[data-live-link-from="${from}"]`,
          `[data-live-link-to="${to}"]`,
        ].join(""),
      );
    },
    frontmatterFieldElement(lineNumber, key) {
      if (!Number.isInteger(lineNumber) || !key) {
        return null;
      }

      return view.dom.querySelector(
        [
          ".cm-live-frontmatter-token",
          `[data-live-line="${lineNumber}"]`,
          `[data-live-frontmatter-key="${cssEscape(String(key))}"]`,
        ].join(""),
      );
    },
    replaceDocument(value) {
      const nextValue = String(value ?? "");
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: nextValue,
        },
        scrollIntoView: true,
      });
      return true;
    },
    deleteLine(lineNumber) {
      if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > view.state.doc.lines) {
        return false;
      }

      const line = view.state.doc.line(lineNumber);
      const to = lineNumber < view.state.doc.lines
        ? view.state.doc.line(lineNumber + 1).from
        : line.to;
      view.dispatch({
        changes: { from: line.from, to },
        scrollIntoView: true,
      });
      return true;
    },
    destroy() {
      view.dom.removeEventListener("mousedown", handleMouseDown, true);
      view.scrollDOM.removeEventListener("scroll", handleScroll);
      view.destroy();
    },
  };
}

export function minimalDocumentChange(currentValue, nextValue) {
  const current = String(currentValue ?? "");
  const next = String(nextValue ?? "");
  let from = 0;
  const sharedLength = Math.min(current.length, next.length);
  while (from < sharedLength && current.charCodeAt(from) === next.charCodeAt(from)) {
    from += 1;
  }

  let currentTo = current.length;
  let nextTo = next.length;
  while (
    currentTo > from
    && nextTo > from
    && current.charCodeAt(currentTo - 1) === next.charCodeAt(nextTo - 1)
  ) {
    currentTo -= 1;
    nextTo -= 1;
  }

  return {
    from,
    to: currentTo,
    insert: next.slice(from, nextTo),
  };
}

function buildDocumentSearchDecorations(state, { matches = [], activeIndex = -1 } = {}) {
  const builder = new RangeSetBuilder();
  for (const [index, match] of matches.entries()) {
    if (
      !Number.isInteger(match?.from) ||
      !Number.isInteger(match?.to) ||
      match.from < 0 ||
      match.to <= match.from ||
      match.to > state.doc.length
    ) {
      continue;
    }
    builder.add(
      match.from,
      match.to,
      Decoration.mark({
        class: index === activeIndex
          ? "cm-document-search-match is-active"
          : "cm-document-search-match",
      }),
    );
  }
  return builder.finish();
}

export function clipboardImageFile(clipboardData) {
  if (!clipboardData) {
    return null;
  }

  for (const item of clipboardData.items ?? []) {
    if (item.kind === "file" && /^image\//i.test(item.type)) {
      return item.getAsFile?.() ?? null;
    }
  }

  for (const file of clipboardData.files ?? []) {
    if (/^image\//i.test(file.type)) {
      return file;
    }
  }

  return null;
}

async function pasteImageIntoEditor(view, imageFile, onPasteImage) {
  try {
    const tag = await onPasteImage(imageFile);
    if (!tag) {
      view.focus();
      return;
    }

    insertTextAtSelection(view, pastedImageInsertionText(view.state, String(tag)));
    view.focus();
  } catch {
    view.focus();
  }
}

async function pasteTextAsLinkIntoEditor(view, text, onPasteText) {
  try {
    const replacement = await onPasteText(text, {
      selectedText: view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      ),
    });
    if (!replacement) {
      view.focus();
      return;
    }

    insertTextAtSelection(view, String(replacement));
    view.focus();
  } catch {
    view.focus();
  }
}

function insertTextAtSelection(view, text) {
  const changes = view.state.changeByRange((range) => ({
    changes: {
      from: range.from,
      to: range.to,
      insert: text,
    },
    range: EditorSelection.cursor(range.from + text.length),
  }));
  view.dispatch({
    ...changes,
    scrollIntoView: true,
    userEvent: "input.paste",
  });
}

export function pastedImageInsertionText(state, tag) {
  const selection = state.selection.main;
  const line = state.doc.lineAt(selection.from);
  const before = line.text.slice(0, selection.from - line.from).trim();
  const after = line.text.slice(selection.to - line.from).trim();
  const prefix = before ? "\n\n" : "";
  const suffix = after ? "\n\n" : "\n";
  return `${prefix}${tag}${suffix}`;
}

export function imageLineAttributes(lineText) {
  const line = String(lineText ?? "").trim();
  if (/^<img\b[^>]*>\s*$/i.test(line)) {
    const attributes = {};
    const attributeRe = /([A-Za-z_:][A-Za-z0-9_:.:-]*)=(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g;
    for (const match of line.matchAll(attributeRe)) {
      attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
    }
    return attributes.src ? attributes : null;
  }

  const markdown = /^!\[((?:\\.|[^\]\\])*)\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^\)\n]*\)))?\s*\)\s*$/.exec(line);
  if (!markdown) {
    return null;
  }
  const rawSource = markdown[2];
  return {
    src: unescapeMarkdownImageValue(
      rawSource.startsWith("<") && rawSource.endsWith(">")
        ? rawSource.slice(1, -1)
        : rawSource,
    ),
    alt: unescapeMarkdownImageValue(markdown[1]),
  };
}

export function imageLineForAction(lineText, action, options = {}) {
  const attributes = imageLineAttributes(lineText);
  if (!attributes?.src) {
    return "";
  }

  if (action === "align-left") {
    attributes["data-align"] = "left";
  } else if (action === "align-center") {
    attributes["data-align"] = "center";
  } else if (action === "shrink" || action === "grow") {
    attributes.width = String(nextImageWidth(attributes.width, action));
  } else if (action === "caption") {
    attributes["data-caption"] = normalizeImageCaption(options.caption);
  }

  return formatImageTag(attributes);
}

export function normalizeImageWidth(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return 0;
  }
  const width = Number(text);
  return Number.isFinite(width) ? Math.min(Math.max(Math.round(width), 80), 2000) : 0;
}

export function normalizeImageAlign(value) {
  return String(value ?? "").trim().toLowerCase() === "center" ? "center" : "left";
}

export function normalizeImageCaption(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 240);
}

function nextImageWidth(value, action) {
  const current = normalizeImageWidth(value) || 760;
  if (action === "shrink") {
    return [...imageWidthSteps].reverse().find((width) => width < current) ?? imageWidthSteps[0];
  }
  return imageWidthSteps.find((width) => width > current) ?? imageWidthSteps.at(-1);
}

function formatImageTag(attributes) {
  const align = normalizeImageAlign(attributes["data-align"]);
  const width = normalizeImageWidth(attributes.width) || 760;
  const height = normalizeImageHeight(attributes.height);
  const caption = normalizeImageCaption(attributes["data-caption"]);
  const parts = [
    `src="${escapeHtmlAttribute(attributes.src)}"`,
    `alt="${escapeHtmlAttribute(attributes.alt ?? "")}"`,
    `width="${width}"`,
    height ? `height="${height}"` : "",
    `data-align="${align}"`,
    caption ? `data-caption="${escapeHtmlAttribute(caption)}"` : "",
  ];
  return `<img ${parts.filter(Boolean).join(" ")}>`;
}

function normalizeImageHeight(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return 0;
  }
  const height = Number(text);
  return Number.isFinite(height) ? Math.min(Math.max(Math.round(height), 40), 2000) : 0;
}

function unescapeMarkdownImageValue(value) {
  return String(value ?? "").replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1");
}

function escapeHtmlAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function pastedTextLinkCandidate(value) {
  const text = String(value ?? "").trim();
  if (!text || /\r|\n/.test(text)) {
    return "";
  }
  if (/^https?:\/\/\S+$/i.test(text)) {
    return text;
  }
  if (/(^|\/|\\)[^/\\]+\.mdx?(?:[?#].*)?$/i.test(text)) {
    return text;
  }
  return "";
}

export function isMarkdownDocumentPath(value) {
  return /\.md$/i.test(String(value ?? ""));
}

export function slashCommandTemplate(
  command,
  {
    today = localIsoDate(),
    locale,
    language,
  } = {},
) {
  const localizedCommand = slashCommandForRequestedLocale(command, { locale, language });
  const rawTemplate = typeof localizedCommand?.template === "function"
    ? localizedCommand.template({ today })
    : String(localizedCommand?.template ?? "");
  const cursorOffset = rawTemplate.indexOf(cursorPlaceholder);
  if (cursorOffset < 0) {
    return {
      text: rawTemplate,
      cursorOffset: rawTemplate.length,
    };
  }

  return {
    text: rawTemplate.replace(cursorPlaceholder, ""),
    cursorOffset,
  };
}

export function slashCommandCompletionSource({
  locale,
  language,
  getDocumentPath = () => "",
  onBeforeSlashCommand = async () => true,
  onSlashCommand = async () => null,
} = {}) {
  const commands = slashCommandsForLocale({ locale, language });
  return (context) => {
    const token = context.matchBefore(/\/[a-z0-9-]*/i);
    if (!token) {
      return null;
    }

    const line = context.state.doc.lineAt(token.from);
    const prefix = line.text.slice(0, token.from - line.from);
    if (prefix.trim().length > 0) {
      return null;
    }

    const query = token.text.slice(1).toLowerCase();
    const options = commands
      .filter((command) => slashCommandMatches(command, query))
      .map((command) => ({
        label: `/${command.label}`,
        detail: command.detail,
        info: command.description
          ? `${command.title} — ${command.description}`
          : command.title,
        type: command.requiresMdx ? "class" : "keyword",
        apply(view, _completion, from, to) {
          void applySlashCommand(view, command, from, to, {
            getDocumentPath,
            onBeforeSlashCommand,
            onSlashCommand,
          });
        },
      }));

    return {
      from: token.from,
      to: context.pos,
      options,
      filter: false,
    };
  };
}

function slashCommandMatches(command, query) {
  if (!query) {
    return true;
  }
  return [command.label, command.title, command.description, command.detail]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function slashCommandForRequestedLocale(command, { locale, language } = {}) {
  if (locale == null && language == null) {
    return command;
  }
  return slashCommandsForLocale({ locale, language })
    .find((candidate) => candidate.label === command?.label) ?? command;
}

async function applySlashCommand(
  view,
  command,
  from,
  to,
  {
    getDocumentPath = () => "",
    onBeforeSlashCommand = async () => true,
    onSlashCommand = async () => null,
  } = {},
) {
  const allowed = await onBeforeSlashCommand(command, {
    documentPath: getDocumentPath(),
  });
  if (allowed === false) {
    view.focus();
    return;
  }

  const template = command.custom
    ? await slashCommandCustomTemplate(command, {
        documentPath: getDocumentPath(),
        onSlashCommand,
      })
    : slashCommandTemplate(command);
  if (!template) {
    view.focus();
    return;
  }
  view.dispatch({
    changes: {
      from,
      to,
      insert: template.text,
    },
    selection: {
      anchor: from + template.cursorOffset,
    },
    scrollIntoView: true,
  });
  view.focus();
}

async function slashCommandCustomTemplate(command, { documentPath, onSlashCommand }) {
  const result = await onSlashCommand(command, { documentPath });
  if (!result) {
    return null;
  }
  if (typeof result === "string") {
    return {
      text: result,
      cursorOffset: result.length,
    };
  }
  const text = String(result.text ?? "");
  return {
    text,
    cursorOffset: Number.isInteger(result.cursorOffset) ? result.cursorOffset : text.length,
  };
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildSelectedLineGutterClasses(state, lines) {
  const selected = [...new Set(lines)]
    .filter((line) => Number.isInteger(line) && line >= 1 && line <= state.doc.lines)
    .sort((left, right) => left - right);
  const builder = new RangeSetBuilder();

  for (const lineNumber of selected) {
    const line = state.doc.line(lineNumber);
    builder.add(line.from, line.from, selectedLineGutterMarker);
  }

  return builder.finish();
}

function lineNumberFromGutterEvent(event, view) {
  const target = event.target instanceof Element ? event.target : null;
  const gutter = target?.closest(".cm-gutters");
  if (!gutter) {
    return null;
  }

  const lineNumberElement = target.closest(".cm-lineNumbers .cm-gutterElement");
  const directLine = Number(lineNumberElement?.textContent);
  if (Number.isInteger(directLine)) {
    return directLine;
  }

  const contentRect = view.contentDOM.getBoundingClientRect();
  const pos = view.posAtCoords({
    x: contentRect.left + 4,
    y: event.clientY,
  });
  return Number.isInteger(pos) ? view.state.doc.lineAt(pos).number : null;
}

function isLiveBlankClick(event) {
  const target = event.target?.closest ? event.target : event.target?.parentElement;
  if (!target) {
    return false;
  }

  const line = target.closest?.(".cm-line");
  if (line) {
    return target === line;
  }

  return Boolean(target.closest?.(".cm-content") || target.closest?.(".cm-scroller"));
}

function adjustCurrentListItemIndent(view, direction) {
  const selection = view.state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const line = view.state.doc.lineAt(selection.head);
  const change = listItemIndentChange(line.text, direction);
  if (!change) {
    return false;
  }

  view.dispatch({
    changes: {
      from: line.from + change.from,
      to: line.from + change.to,
      insert: change.insert,
    },
    scrollIntoView: true,
  });
  return true;
}

export function nextLiveEditingSuppression(
  isSuppressed,
  {
    docChanged = false,
    enterEditing = false,
    exitEditing = false,
  } = {},
) {
  if (exitEditing) {
    return true;
  }
  if (enterEditing || docChanged) {
    return false;
  }
  return isSuppressed;
}

export function listItemIndentChange(text, direction, { step = 2 } = {}) {
  const match = /^(\s*)([-*+]|\d+\.)(?:\s+|$)/.exec(text);
  if (!match) {
    return null;
  }

  const spaces = " ".repeat(step);
  if (direction === "indent") {
    return {
      from: 0,
      to: 0,
      insert: spaces,
    };
  }

  if (direction === "outdent") {
    const removeCount = Math.min(step, match[1].length);
    if (removeCount <= 0) {
      return null;
    }
    return {
      from: 0,
      to: removeCount,
      insert: "",
    };
  }

  return null;
}

function buildLiveMarkdownDecorations(state, { suppressActiveLine = false } = {}) {
  const builder = new RangeSetBuilder();
  const renderOptions = state.facet(liveRenderOptionsFacet);
  let inFrontmatter = false;
  let inCodeBlock = false;
  let mdxComponentName = null;
  const activeLineNumber = suppressActiveLine
    ? null
    : state.doc.lineAt(state.selection.main.head).number;
  const previewBlocks = livePreviewBlocksForSource(state.doc.toString(), {
    activeLineNumber,
  });
  let previewBlockIndex = 0;

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const previewBlock = previewBlocks[previewBlockIndex];
    if (previewBlock?.startLine === lineNumber) {
      const startLine = state.doc.line(previewBlock.startLine);
      const endLine = state.doc.line(previewBlock.endLine);
      builder.add(
        startLine.from,
        endLine.to,
        Decoration.replace({
          block: true,
          widget: new LiveBlockPreviewWidget(previewBlock, renderOptions),
        }),
      );
      lineNumber = previewBlock.endLine;
      previewBlockIndex += 1;
      continue;
    }

    const line = state.doc.line(lineNumber);
    const mdxComponent = liveMdxComponentForLine(line.text);
    const inMdxComponent = Boolean(mdxComponentName);
    const className = liveClassForLine({
      lineNumber,
      text: line.text,
      inFrontmatter,
      inCodeBlock,
      inMdxComponent,
    });

    if (className) {
      builder.add(
        line.from,
        line.from,
        Decoration.line({
          class: className,
          attributes: mdxComponent
            ? { "data-live-component": `${mdxComponent.name} · ${mdxComponent.title}` }
            : {},
        }),
      );
    }

    if (inFrontmatter) {
      for (const range of liveFrontmatterRangesForLine(line.text)) {
        builder.add(
          line.from + range.from,
          line.from + range.to,
          Decoration.mark({
            class: range.className,
            attributes: liveRangeAttributes(range, lineNumber),
          }),
        );
      }
    } else if (!inCodeBlock) {
      for (const range of liveVisualRangesForLine(line.text, {
        isActiveLine: lineNumber === activeLineNumber,
      })) {
        if (range.type === "replace") {
          const widget = range.className === "cm-live-list-widget" &&
              Number.isInteger(range.indentColumns) &&
              Number.isInteger(range.markerColumns)
            ? new LiveListMarkerWidget(
              range.widget,
              range.indentColumns,
              range.markerColumns,
            )
            : new LiveReplacementWidget(range.widget, range.className);
          builder.add(
            line.from + range.from,
            line.from + range.to,
            Decoration.replace({
              widget,
            }),
          );
          continue;
        }

        builder.add(
          line.from + range.from,
          line.from + range.to,
          Decoration.mark({
            class: range.className,
            attributes: liveRangeAttributes(range, lineNumber),
          }),
        );
      }
    }

    const trimmed = line.text.trim();
    if (lineNumber === 1 && trimmed === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter && trimmed === "---") {
      inFrontmatter = false;
      continue;
    }
    if (!inFrontmatter && /^```/.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
    }
    if (!inFrontmatter && !inCodeBlock && mdxComponent && !trimmed.endsWith("/>")) {
      mdxComponentName = mdxComponent.name;
      continue;
    }
    if (mdxComponentName && trimmed === `</${mdxComponentName}>`) {
      mdxComponentName = null;
    }
  }

  return builder.finish();
}

function liveRangeAttributes(range, lineNumber) {
  if (!range.attributes) {
    return undefined;
  }

  const attributes = { ...range.attributes };
  if (attributes["data-live-link"]) {
    attributes["data-live-line"] = String(lineNumber);
  }
  if (attributes["data-live-frontmatter"]) {
    attributes["data-live-line"] = String(lineNumber);
  }
  return attributes;
}

export function closestElement(target, selector) {
  const element = target?.closest
    ? target
    : target?.parentElement;
  return element?.closest?.(selector) ?? null;
}

function liveMarkdownLinkFromMouseEvent(event, view) {
  const element = closestElement(event.target, ".cm-live-link-text[data-live-link=\"true\"]");
  if (!element) {
    return null;
  }

  const pos = view.posAtCoords({
    x: event.clientX,
    y: event.clientY,
  });
  const elementLine = lineFromLiveElement(view, element);
  const posLine = Number.isInteger(pos) ? view.state.doc.lineAt(pos) : null;
  const line = elementLine ?? posLine;
  if (!line) {
    return null;
  }

  const position = posLine?.number === line.number ? pos - line.from : null;
  const dataFrom = Number(element.dataset.liveLinkFrom);
  const dataTo = Number(element.dataset.liveLinkTo);
  const link = (Number.isInteger(position) ? liveMarkdownLinkAtPosition(line.text, position) : null) ??
    liveMarkdownLinksForLine(line.text).find((candidate) => (
      candidate.from === dataFrom && candidate.to === dataTo
    ));
  if (!link) {
    return null;
  }

  return {
    line: line.number,
    element,
    ...link,
  };
}

function liveFrontmatterFieldFromMouseEvent(event, view) {
  const element = closestElement(event.target, ".cm-live-frontmatter-token[data-live-frontmatter-key]");
  if (!element) {
    return null;
  }

  const pos = view.posAtCoords({
    x: event.clientX,
    y: event.clientY,
  });
  const elementLine = lineFromLiveElement(view, element);
  const posLine = Number.isInteger(pos) ? view.state.doc.lineAt(pos) : null;
  const line = elementLine ?? posLine;
  if (!line) {
    return null;
  }

  const position = posLine?.number === line.number ? pos - line.from : null;
  const field = (Number.isInteger(position) ? liveFrontmatterFieldAtPosition(line.text, position) : null) ??
    liveFrontmatterFieldForLine(line.text);
  if (!field || field.key !== element.dataset.liveFrontmatterKey) {
    return null;
  }

  return {
    line: line.number,
    element,
    ...field,
  };
}

function lineFromLiveElement(view, element) {
  const lineNumber = Number(element.dataset.liveLine);
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > view.state.doc.lines) {
    return null;
  }
  return view.state.doc.line(lineNumber);
}

export function liveClassForLine({
  lineNumber,
  text,
  inFrontmatter = false,
  inCodeBlock = false,
  inMdxComponent = false,
}) {
  const trimmed = text.trim();
  if ((lineNumber === 1 && trimmed === "---") || inFrontmatter) {
    return "cm-live-frontmatter";
  }
  const mdxComponent = liveMdxComponentForLine(text);
  if (mdxComponent) {
    return "cm-live-mdx-component cm-live-mdx-component-start";
  }
  if (inMdxComponent) {
    return "cm-live-mdx-component";
  }
  if (/^```/.test(trimmed)) {
    return "cm-live-code cm-live-code-fence";
  }
  if (inCodeBlock) {
    return "cm-live-code";
  }

  if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
    return "cm-live-horizontal-rule";
  }

  const heading = /^(#{1,6})\s+/.exec(text);
  if (heading) {
    const level = Math.min(heading[1].length, 3);
    return `cm-live-heading cm-live-heading-${level}`;
  }
  if (/^\s*>/.test(text)) {
    return "cm-live-blockquote";
  }
  if (/^\s*(?:[-*+]|\d+\.)\s+/.test(text)) {
    return "cm-live-list";
  }
  return "";
}

export function liveInlineRangesForLine(text) {
  const ranges = [];
  const push = (from, to, className, attributes = undefined) => {
    if (Number.isInteger(from) && Number.isInteger(to) && to > from) {
      ranges.push({ from, to, className, ...(attributes ? { attributes } : {}) });
    }
  };

  const heading = /^(#{1,6})(\s+)/.exec(text);
  if (heading) {
    push(0, heading[1].length, "cm-live-marker");
  }

  const blockquote = /^(\s*>+\s?)/.exec(text);
  if (blockquote) {
    push(0, blockquote[1].length, "cm-live-marker");
  }

  const list = /^(\s*)([-*+]|\d+\.)(\s+)/.exec(text);
  if (list) {
    push(list[1].length, list[1].length + list[2].length, "cm-live-marker");
  }

  addDelimitedRanges({
    text,
    regex: /\*\*([^*]+)\*\*/g,
    delimiterLength: 2,
    contentClassName: "cm-live-strong",
    ranges,
  });
  addDelimitedRanges({
    text,
    regex: /__([^_]+)__/g,
    delimiterLength: 2,
    contentClassName: "cm-live-strong",
    ranges,
  });
  addDelimitedRanges({
    text,
    regex: /`([^`]+)`/g,
    delimiterLength: 1,
    contentClassName: "cm-live-inline-code",
    ranges,
  });

  for (const link of liveMarkdownLinksForLine(text)) {
    push(link.from, link.textFrom, "cm-live-marker");
    push(link.textFrom, link.textTo, "cm-live-link-text", {
      "data-live-link": "true",
      "data-live-link-from": String(link.from),
      "data-live-link-to": String(link.to),
    });
    push(link.textTo, link.destinationFrom, "cm-live-marker");
    push(link.destinationFrom, link.destinationTo, "cm-live-marker cm-live-link-destination");
    push(link.destinationTo, link.to, "cm-live-marker");
  }

  return ranges.sort((left, right) => left.from - right.from || left.to - right.to);
}

export function liveFrontmatterFieldForLine(text) {
  const source = String(text ?? "");
  const match = /^([A-Za-z0-9_-]+):(\s*)(.*)$/.exec(source);
  if (!match) {
    return null;
  }

  const value = match[3].trim();
  if (!value) {
    return null;
  }

  const keyFrom = 0;
  const keyTo = match[1].length;
  const valueFrom = keyTo + 1 + match[2].length;
  const valueTo = source.length;
  return {
    from: 0,
    to: source.length,
    keyFrom,
    keyTo,
    valueFrom,
    valueTo,
    key: match[1],
    value,
  };
}

export function liveFrontmatterRangesForLine(text) {
  const field = liveFrontmatterFieldForLine(text);
  if (!field) {
    return [];
  }

  const attributes = {
    "data-live-frontmatter": "true",
    "data-live-frontmatter-key": field.key,
    "data-live-frontmatter-from": String(field.from),
    "data-live-frontmatter-to": String(field.to),
  };
  const ranges = [
    {
      from: field.keyFrom,
      to: field.keyTo,
      className: "cm-live-frontmatter-token cm-live-frontmatter-key",
      attributes,
    },
  ];
  if (field.valueTo > field.valueFrom) {
    ranges.push({
      from: field.valueFrom,
      to: field.valueTo,
      className: "cm-live-frontmatter-token cm-live-frontmatter-value",
      attributes,
    });
  }
  return ranges;
}

export function liveFrontmatterFieldAtPosition(text, position) {
  if (!Number.isInteger(position)) {
    return null;
  }

  const field = liveFrontmatterFieldForLine(text);
  if (!field || position < field.from || position >= field.to) {
    return null;
  }
  return field;
}

export function liveMarkdownLinksForLine(text) {
  return [...String(text ?? "").matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => {
    const from = match.index;
    const textFrom = from + 1;
    const textTo = textFrom + match[1].length;
    const destinationFrom = textTo + 2;
    const destinationTo = destinationFrom + match[2].length;
    return {
      from,
      to: destinationTo + 1,
      textFrom,
      textTo,
      destinationFrom,
      destinationTo,
      text: match[1],
      href: match[2],
    };
  });
}

export function liveMarkdownLinkAtPosition(text, position) {
  if (!Number.isInteger(position)) {
    return null;
  }

  return liveMarkdownLinksForLine(text).find((link) => (
    position >= link.from && position <= link.to
  )) ?? null;
}

export function liveMdxComponentForLine(text) {
  const match = mdxLiteComponentOpeningRegex().exec(text.trim());
  if (!match) {
    return null;
  }

  const titleMatch = match[2].match(/\btitle=(["'])(.*?)\1/);
  return {
    name: match[1],
    title: titleMatch?.[2] || match[1],
  };
}

function cssEscape(value) {
  return globalThis.CSS?.escape
    ? globalThis.CSS.escape(value)
    : String(value).replace(/["\\]/g, "\\$&");
}

export function livePreviewBlocksForSource(source, { activeLineNumber = null } = {}) {
  const lines = String(source ?? "").split(/\r?\n/);
  const blocks = [];
  let inFrontmatter = false;
  let inCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const trimmed = lines[index].trim();

    if (index === 0 && trimmed === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (trimmed === "---") {
        inFrontmatter = false;
      }
      continue;
    }
    if (/^```/.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      continue;
    }

    const imageBlock = liveImagePreviewBlockAt(lines, index);
    if (imageBlock) {
      const startLine = lineNumber;
      const endLine = lineNumber;
      if (!lineNumberInRange(activeLineNumber, startLine, endLine)) {
        blocks.push({
          type: "image",
          startLine,
          endLine,
          source: lines[index],
        });
      }
      continue;
    }

    const mdxBlock = liveMdxPreviewBlockAt(lines, index);
    if (mdxBlock) {
      const startLine = lineNumber;
      const endLine = mdxBlock.endIndex + 1;
      if (!lineNumberInRange(activeLineNumber, startLine, endLine)) {
        blocks.push({
          type: "mdx",
          component: mdxBlock.component,
          startLine,
          endLine,
          source: lines.slice(index, mdxBlock.endIndex + 1).join("\n"),
        });
      }
      index = mdxBlock.endIndex;
      continue;
    }

    const tableBlock = liveMarkdownTableBlockAt(lines, index);
    if (tableBlock) {
      const startLine = lineNumber;
      const endLine = tableBlock.endIndex + 1;
      if (!lineNumberInRange(activeLineNumber, startLine, endLine)) {
        blocks.push({
          type: "table",
          startLine,
          endLine,
          source: lines.slice(index, tableBlock.endIndex + 1).join("\n"),
        });
      }
      index = tableBlock.endIndex;
    }
  }

  return blocks;
}

export function livePreviewHtmlForBlock(source, renderOptions = {}) {
  return removeSourceBlockChrome(renderMarkdown(source, renderOptions)).trim();
}

function liveImagePreviewBlockAt(lines, index) {
  const line = String(lines[index] ?? "").trim();
  return (
    isSafeHtmlImageLine(line) ||
    Boolean(imageLineAttributes(line))
  )
    ? { endIndex: index }
    : null;
}

function isSafeHtmlImageLine(line) {
  return (
    /^(?:<img\b[^<>]*>\s*)+$/i.test(line) ||
    /^<p>\s*(?:<img\b[^<>]*>\s*)+<\/p>\s*$/i.test(line)
  );
}

function liveMdxPreviewBlockAt(lines, index) {
  const trimmed = lines[index].trim();
  const selfClosing = mdxLiteComponentSelfClosingRegex().exec(trimmed);
  if (selfClosing) {
    return { component: selfClosing[1], endIndex: index };
  }

  const opening = mdxLiteComponentBlockOpeningRegex().exec(trimmed);
  if (!opening) {
    return null;
  }

  const component = opening[1];
  for (let endIndex = index + 1; endIndex < lines.length; endIndex += 1) {
    if (lines[endIndex].trim() === `</${component}>`) {
      return { component, endIndex };
    }
  }

  return null;
}

function mdxLiteComponentOpeningRegex() {
  return new RegExp(`^<(${mdxLiteComponentNames.join("|")})\\b([^>]*)>`);
}

function mdxLiteComponentSelfClosingRegex() {
  return new RegExp(`^<(${mdxLiteComponentNames.join("|")})\\b[^>]*\\/\\s*>$`);
}

function mdxLiteComponentBlockOpeningRegex() {
  return new RegExp(`^<(${mdxLiteComponentNames.join("|")})\\b[^>]*>\\s*$`);
}

function liveMarkdownTableBlockAt(lines, index) {
  if (!liveMarkdownTableRow(lines[index]) || !liveMarkdownTableSeparator(lines[index + 1] ?? "")) {
    return null;
  }

  let endIndex = index + 1;
  while (endIndex + 1 < lines.length && liveMarkdownTableRow(lines[endIndex + 1])) {
    endIndex += 1;
  }

  return { endIndex };
}

function liveMarkdownTableRow(line) {
  const trimmed = String(line ?? "").trim();
  return trimmed.length > 0 && trimmed.includes("|") && !/^```/.test(trimmed);
}

function liveMarkdownTableSeparator(line) {
  const cells = String(line ?? "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function lineNumberInRange(lineNumber, startLine, endLine) {
  return Number.isInteger(lineNumber) && lineNumber >= startLine && lineNumber <= endLine;
}

function removeSourceBlockChrome(html) {
  const withoutGutters = String(html ?? "").replace(
    /<div class="source-line-gutter"[^>]*>[\s\S]*?<\/div>/g,
    "",
  );
  return withoutGutters
    .replace(/^<div class="source-block"[^>]*>\s*<div class="source-block-content">/, "")
    .replace(/<\/div>\s*<\/div>\s*$/, "");
}

export function liveVisualRangesForLine(text, { isActiveLine = false } = {}) {
  if (isActiveLine) {
    return liveInlineRangesForLine(text).map((range) => ({
      type: "mark",
      ...range,
    }));
  }

  const readableReplacements = liveReadableReplacementsForLine(text).map((range) => ({
    type: "replace",
    ...range,
  }));
  const inlineMarkerReplacements = liveReadableInlineReplacementsForLine(text)
    .filter((range) => !readableReplacements.some((replacement) => rangesOverlap(range, replacement)))
    .map((range) => ({
      type: "replace",
      ...range,
    }));
  const allReplacements = [...readableReplacements, ...inlineMarkerReplacements];
  const visibleInlineRanges = liveInlineRangesForLine(text)
    .filter((range) => !allReplacements.some((replacement) => rangesOverlap(range, replacement)))
    .map((range) => ({
      type: "mark",
      ...range,
    }));

  return [...allReplacements, ...visibleInlineRanges]
    .sort((left, right) => left.from - right.from || left.to - right.to);
}

function rangesOverlap(left, right) {
  return left.from < right.to && right.from < left.to;
}

export function liveReadableReplacementsForLine(text) {
  const ranges = [];
  const push = (from, to, widget = "", className = "", extra = {}) => {
    if (Number.isInteger(from) && Number.isInteger(to) && to > from) {
      ranges.push({
        from,
        to,
        widget,
        ...(className ? { className } : {}),
        ...extra,
      });
    }
  };

  const heading = /^(#{1,6})(\s+)/.exec(text);
  if (heading) {
    push(0, heading[1].length + heading[2].length, "");
  }

  const blockquote = /^(\s*>+\s?)/.exec(text);
  if (blockquote) {
    push(0, blockquote[1].length, "");
  }

  const list = /^(\s*)([-*+]|\d+\.)(\s+)/.exec(text);
  if (list) {
    const markerStart = list[1].length;
    const markerEnd = markerStart + list[2].length + list[3].length;
    const markerColumns = list[2].length + list[3].length;
    const widget = /^\d+\.$/.test(list[2]) ? list[2] : "\u2022";
    push(markerStart, markerEnd, widget, "cm-live-list-widget", {
      indentColumns: 0,
      markerColumns,
    });
    const nestedHeading = /^(#{1,6})(\s+)/.exec(text.slice(markerEnd));
    if (nestedHeading) {
      push(markerEnd, markerEnd + nestedHeading[1].length + nestedHeading[2].length, "");
    }
  }

  return ranges.sort((left, right) => left.from - right.from || left.to - right.to);
}

function liveReadableInlineReplacementsForLine(text) {
  return liveInlineRangesForLine(text)
    .filter((range) => hasCssClass(range.className, "cm-live-marker"))
    .map((range) => ({
      from: range.from,
      to: range.to,
      widget: "",
    }));
}

function hasCssClass(className, expectedClassName) {
  return String(className ?? "").split(/\s+/).includes(expectedClassName);
}

function addDelimitedRanges({
  text,
  regex,
  delimiterLength,
  contentClassName,
  ranges,
}) {
  for (const match of text.matchAll(regex)) {
    const start = match.index;
    const contentStart = start + delimiterLength;
    const contentEnd = contentStart + match[1].length;
    ranges.push({ from: start, to: contentStart, className: "cm-live-marker" });
    ranges.push({ from: contentStart, to: contentEnd, className: contentClassName });
    ranges.push({
      from: contentEnd,
      to: contentEnd + delimiterLength,
      className: "cm-live-marker",
    });
  }
}

class LiveBlockPreviewWidget extends WidgetType {
  constructor(block, renderOptions = {}) {
    super();
    this.block = block;
    this.renderOptions = renderOptions;
  }

  eq(other) {
    return other.block?.type === this.block.type &&
      other.block?.component === this.block.component &&
      other.block?.startLine === this.block.startLine &&
      other.block?.endLine === this.block.endLine &&
      other.block?.source === this.block.source &&
      JSON.stringify(other.renderOptions ?? {}) === JSON.stringify(this.renderOptions ?? {});
  }

  toDOM() {
    const container = document.createElement("div");
    const classNames = [
      "cm-live-block-preview",
      `cm-live-block-preview-${this.block.type}`,
      this.block.component ? `cm-live-block-preview-${this.block.component.toLowerCase()}` : "",
    ].filter(Boolean);
    container.className = classNames.join(" ");
    container.dataset.liveBlockStart = String(this.block.startLine);
    container.dataset.liveBlockEnd = String(this.block.endLine);
    const card = document.createElement("div");
    card.className = "cm-live-block-preview-card";
    card.innerHTML = livePreviewHtmlForBlock(this.block.source, this.renderOptions);
    enhanceImageLoadStates(card);
    container.append(card);
    return container;
  }

  ignoreEvent() {
    return false;
  }
}

class LiveListMarkerWidget extends WidgetType {
  constructor(text, indentColumns, markerColumns) {
    super();
    this.text = text;
    this.indentColumns = indentColumns;
    this.markerColumns = markerColumns;
  }

  eq(other) {
    return other.text === this.text &&
      other.indentColumns === this.indentColumns &&
      other.markerColumns === this.markerColumns;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-live-list-widget";
    if (this.isUnordered()) {
      span.classList.add("is-unordered");
    }
    if (this.indentColumns > 0) {
      span.style.paddingLeft = `${this.indentColumns}ch`;
    }
    span.textContent = this.isUnordered() ? "" : this.text;
    return span;
  }

  ignoreEvent() {
    return false;
  }

  isUnordered() {
    return this.text === "\u2022";
  }
}

class LiveReplacementWidget extends WidgetType {
  constructor(text, className = "") {
    super();
    this.text = text;
    this.className = className;
  }

  eq(other) {
    return other.text === this.text && other.className === this.className;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = ["cm-live-replacement-widget", this.className].filter(Boolean).join(" ");
    span.textContent = this.text;
    return span;
  }

  ignoreEvent() {
    return false;
  }
}
