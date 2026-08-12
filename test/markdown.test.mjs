import assert from "node:assert/strict";
import test from "node:test";

import {
  extractDocumentTitle,
  extractFrontmatterScalar,
  extractTitle,
  renderMarkdown,
} from "../src/content/markdown.mjs";

test("renderMarkdown removes frontmatter and renders basic markdown", () => {
  const html = renderMarkdown(`---
title: Demo
---

# Heading

Plain **bold** text.
`);

  assert.match(html, /<h1 id="heading">Heading<\/h1>/);
  assert.match(html, /Plain <strong>bold<\/strong> text\./);
  assert.doesNotMatch(html, /title: Demo/);
});

test("renderMarkdown gives repeated headings unique stable ids", () => {
  const html = renderMarkdown(`# Report

## Current judgment

## Current judgment

## Current judgment
`);

  assert.deepEqual(
    [...html.matchAll(/<h[12] id="([^"]+)">/g)].map((match) => match[1]),
    ["report", "current-judgment", "current-judgment-2", "current-judgment-3"],
  );
});

test("extractTitle prefers frontmatter title before headings", () => {
  assert.equal(
    extractTitle("---\ntitle: Peer Doc\n---\n\n# Fallback\n", "docs/peer.md"),
    "Peer Doc",
  );
  assert.equal(
    extractTitle("---\ntitle: \"Quoted Doc\"\n---\n\n# Fallback\n", "docs/peer.md"),
    "Quoted Doc",
  );
});

test("extractDocumentTitle omits the filename fallback used by opened documents", () => {
  assert.equal(extractDocumentTitle("Plain paragraph without a document title.\n"), "");
  assert.equal(
    extractTitle("Plain paragraph without a document title.\n", "docs/plain.md"),
    "plain.md",
  );
  assert.equal(extractDocumentTitle("## Section only\n"), "");
  assert.equal(extractDocumentTitle("# Human-readable title\n"), "Human-readable title");
});

test("extractFrontmatterScalar reads one-line share preview metadata", () => {
  const source = [
    "---",
    "title: \"Peer Doc\"",
    "ai_snippet: '[Guide] Peer Doc | concise coworker context'",
    "---",
    "# Fallback",
  ].join("\n");

  assert.equal(extractFrontmatterScalar(source, "title"), "Peer Doc");
  assert.equal(
    extractFrontmatterScalar(source, "ai_snippet"),
    "[Guide] Peer Doc | concise coworker context",
  );
  assert.equal(extractFrontmatterScalar(source, "missing"), "");
  assert.equal(extractFrontmatterScalar("---\nai_snippet: >\n  multiline\n---\n", "ai_snippet"), "");
  assert.equal(extractFrontmatterScalar("---\nai_snippet: |-\n  multiline\n---\n", "ai_snippet"), "");
});

test("renderMarkdown renders small markdown tables without table tools", () => {
  const html = renderMarkdown(`| Name | Status |
| --- | --- |
| Alpha | Ready |
`);

  assert.match(html, /data-source-line-layout="table"/);
  assert.match(html, /data-source-line="1"[^>]*data-source-end="2"[^>]*>1–2<\/button>/);
  assert.match(html, /<tr data-source-table-line="1" data-source-table-end="2">/);
  assert.match(html, /data-source-line="3"/);
  assert.match(html, /<tr data-source-table-line="3">/);
  assert.doesNotMatch(html, /data-source-line="2"/);
  assert.match(html, /<div class="table-card is-simple-table" data-table-complexity="simple" data-table-layout="fit" style="--table-preferred-width: \d+px; --table-min-width: \d+px;">/);
  assert.doesNotMatch(html, /<div class="table-toolbar">/);
  assert.doesNotMatch(html, /data-table-search/);
  assert.doesNotMatch(html, /data-table-copy/);
  assert.doesNotMatch(html, /data-table-freeze/);
  assert.match(html, /<div class="table-scroll" data-table-layout="fit" style="--table-preferred-width: \d+px; --table-min-width: \d+px;"><table>/);
  assert.match(html, /<colgroup><col style="width: [\d.]+%"><col style="width: [\d.]+%"><\/colgroup>/);
  assert.match(html, /<th>Name<\/th>/);
  assert.match(html, /<td>Ready<\/td>/);
});

test("renderMarkdown represents a visually merged paragraph as one selectable source range", () => {
  const html = renderMarkdown(`First source line
second source line
third source line
`);

  assert.equal(html.match(/data-source-line="/g)?.length, 1);
  assert.match(html, /data-source-line="1"[^>]*data-source-end="3"[^>]*>1–3<\/button>/);
});

test("renderMarkdown enables table tools for complex markdown tables", () => {
  const rows = Array.from({ length: 101 }, (_, index) =>
    `| Item ${index + 1} | Owner ${index + 1} | ${index * 10} | note ${index + 1} | A | B |`,
  ).join("\n");
  const html = renderMarkdown(`| Name | Owner | Value | Note | Segment | Type |
| --- | --- | --- | --- | --- | --- |
${rows}
`);

  assert.match(html, /<div class="table-card is-complex-table is-sticky-header" data-enhanced-table data-table-complexity="complex" data-table-layout="wrap" style="--table-preferred-width: \d+px; --table-min-width: \d+px;">/);
  assert.match(html, /<div class="table-toolbar">/);
  assert.match(html, /data-table-search/);
  assert.doesNotMatch(html, />表格搜索</);
  assert.match(html, /data-table-copy/);
  assert.match(html, /data-table-freeze/);
  assert.match(html, /<colgroup>/);
});

test("renderMarkdown supports mature markdown features", () => {
  const html = renderMarkdown(`- Parent
  - Child

~~removed~~
`);

  assert.match(html, /<ul>/);
  assert.match(html, />Parent/);
  assert.match(html, />Child</);
  assert.match(html, /<s>removed<\/s>/);
});

test("renderMarkdown wraps list blocks outside the list so gutters stay before bullets", () => {
  const html = renderMarkdown(`- First
- Second
`);

  assert.match(html, /<div class="source-block"[^>]*><div class="source-line-gutter"/);
  assert.match(html, /<div class="source-block-content"><ul>/);
  assert.doesNotMatch(html, /<li><div class="source-block"/);
});

test("renderMarkdown gives compound blockquote source lines one control each", () => {
  const html = renderMarkdown(`> Quoted note
>
> # Quoted heading
>
> Continued quote
`);

  for (const line of [1, 3, 5]) {
    assert.equal(
      html.match(new RegExp(`data-source-line="${line}"`, "g"))?.length,
      1,
      `expected source line ${line} to have exactly one control`,
    );
  }
});

test("renderMarkdown maps list gutters to list item source lines", () => {
  const html = renderMarkdown(`- First
- Second

Paragraph
`);
  const listBlock = html.match(/<div class="source-block"[^>]*>[\s\S]*?<\/ul>/)?.[0] ?? "";

  assert.match(listBlock, /data-source-start="1"/);
  assert.match(listBlock, /data-source-end="2"/);
  assert.match(listBlock, /class="source-line-gutter"[^>]*data-source-line-layout="list"/);
  assert.match(listBlock, /data-source-line="1"/);
  assert.match(listBlock, /data-source-line="2"/);
  assert.match(listBlock, /<li data-source-list-line="1">/);
  assert.match(listBlock, /<li data-source-list-line="2">/);
  assert.doesNotMatch(listBlock, /data-source-line="3"/);
  assert.doesNotMatch(listBlock, /data-source-list-line="3"/);
  assert.match(html, /data-source-line="4"/);
});

test("renderMarkdown keeps nested lists in the same source gutter", () => {
  const html = renderMarkdown(`- Parent
  - Child
`);

  assert.equal(html.match(/data-source-line="2"/g)?.length, 1);
  assert.doesNotMatch(html, /<li>Parent<div class="source-block"/);
});

test("renderMarkdown adds selectable source line controls to rendered blocks", () => {
  const html = renderMarkdown(`# Heading

Paragraph line one
Paragraph line two
`);

  assert.match(html, /class="source-block"/);
  assert.match(html, /data-source-start="1"/);
  assert.match(html, /data-source-line="1"/);
  assert.match(html, /data-source-start="3"/);
  assert.match(html, /data-source-end="4"/);
  assert.match(html, /data-source-line="3"[^>]*data-source-end="4"/);
  assert.match(html, /title="Select line 1" aria-label="Select line 1"/);
  assert.match(html, /aria-label="Source line numbers"/);
});

test("renderMarkdown aligns fenced-code controls with the source lines visible in Preview", () => {
  const html = renderMarkdown(`Before

\`\`\`text
first

third
\`\`\`
`);
  const codeBlock = html.match(
    /<div class="source-block"[^>]*data-source-start="4"[\s\S]*?<\/pre>/,
  )?.[0] ?? "";

  assert.match(codeBlock, /data-source-end="6"/);
  assert.match(codeBlock, /data-source-line-layout="code"/);
  for (const line of [4, 5, 6]) {
    assert.match(codeBlock, new RegExp(`data-source-line="${line}"`));
    assert.match(codeBlock, new RegExp(`data-source-code-line="${line}"`));
  }
  assert.doesNotMatch(codeBlock, /data-source-line="3"/);
  assert.doesNotMatch(codeBlock, /data-source-line="7"/);
  assert.match(codeBlock, /data-source-code-line="5"><\/span>/);
});

test("renderMarkdown turns Mermaid fences into a local diagram shell with source fallback", () => {
  const html = renderMarkdown(`Before

\`\`\`mermaid
flowchart LR
  A["Input <unsafe>"] --> B[Output]
\`\`\`

After
`);
  const diagramBlock = html.match(
    /<div class="source-block"[^>]*data-source-start="4"[\s\S]*?<\/figure><\/div><\/div>/,
  )?.[0] ?? "";

  assert.match(diagramBlock, /data-source-end="5"/);
  assert.match(diagramBlock, /data-source-line-layout="diagram"/);
  assert.match(diagramBlock, /data-source-line="4"[^>]*data-source-end="5"[^>]*>4–5<\/button>/);
  assert.equal(diagramBlock.match(/data-source-line="/g)?.length, 1);
  assert.match(diagramBlock, /data-mermaid-diagram="true"/);
  assert.match(diagramBlock, /data-mermaid-action="smart-layout"/);
  assert.doesNotMatch(diagramBlock, /data-mermaid-focus/);
  assert.match(diagramBlock, /data-mermaid-action="fit"/);
  assert.match(diagramBlock, /data-mermaid-action="source"/);
  assert.match(diagramBlock, /data-mermaid-source>flowchart LR/);
  assert.match(diagramBlock, /Input &lt;unsafe&gt;/);
  assert.doesNotMatch(diagramBlock, /<pre><code class="language-mermaid">/);
  assert.doesNotMatch(diagramBlock, /<unsafe>/);
});

test("renderMarkdown localizes Mermaid controls while preserving portable source", () => {
  const html = renderMarkdown("~~~Mermaid\nflowchart TD\nA --> B\n~~~\n", {
    locale: "zh-CN",
  });

  assert.match(html, />Mermaid 图<\/span>/);
  assert.match(html, />智能阅读<\/button>/);
  assert.doesNotMatch(html, /聚焦节点|全部节点|data-mermaid-focus/);
  assert.match(html, />适应宽度<\/button>/);
  assert.match(html, /aria-label="查看 Mermaid 源码"/);
  assert.match(html, /data-mermaid-source>flowchart TD\nA --&gt; B\n<\/code>/);
});

test("renderMarkdown localizes source line controls without changing document content", () => {
  const html = renderMarkdown("# 用户标题\n", { locale: "zh-CN" });

  assert.match(html, />用户标题<\/h1>/);
  assert.match(html, /title="选择第 1 行" aria-label="选择第 1 行"/);
  assert.match(html, /aria-label="源文件行号"/);
});

test("renderMarkdown carries repository context through relative links and raw assets", () => {
  const html = renderMarkdown(
    "[Next](next.md) ![Chart](assets/chart.png)",
    {
      currentFile: "docs/source.md",
      currentRepo: "content-repo",
    },
  );

  assert.match(
    html,
    /href="\/\?repo=content-repo&amp;file=docs%2Fnext\.md"/,
  );
  assert.doesNotMatch(html, /href="[^"]*share=/);
  assert.match(
    html,
    /src="\/raw\?repo=content-repo&amp;file=docs%2Fassets%2Fchart\.png"/,
  );
});

test("renderMarkdown treats leading slash links as repository-root relative paths", () => {
  const html = renderMarkdown(
    "[Root Doc](/docs/root.md)",
    {
      currentFile: "company/source.md",
      currentRepo: "content-repo",
    },
  );

  assert.match(
    html,
    /href="\/\?repo=content-repo&amp;file=docs%2Froot\.md"/,
  );
  assert.doesNotMatch(html, /href="[^"]*share=/);
  assert.doesNotMatch(html, /company%2Fdocs%2Froot/);
});

test("renderMarkdown preserves OpenPeek document links without rewriting them as raw assets or token links", () => {
  const html = renderMarkdown(
    "[Content Doc](/?repo=content-repo&file=docs%2Fcontent-archive-frontmatter-standard.md&unused=old#L12)",
    {
      currentFile: "docs/source.md",
      currentRepo: "docs-repo",
    },
  );

  assert.match(
    html,
    /href="\/\?repo=content-repo&amp;file=docs%2Fcontent-archive-frontmatter-standard\.md#L12"/,
  );
  assert.doesNotMatch(html, /href="[^"]*unused=/);
  assert.doesNotMatch(html, /\/raw/);
  assert.doesNotMatch(html, /file=\./);
});

test("renderMarkdown renders only safe HTML image tags with repository asset paths", () => {
  const html = renderMarkdown(
    '<img src="_assets/report.png" alt="报表" width="760" height="420" data-align="center" data-caption="六月财务报表">',
    {
      currentFile: "docs/source.md",
      currentRepo: "content-repo",
    },
  );

  assert.match(html, /class="git-leaf-image-frame is-align-center"/);
  assert.match(html, /data-git-leaf-image="true"/);
  assert.match(html, /alt="报表"/);
  assert.match(html, /width="760"/);
  assert.match(html, /height="420"/);
  assert.match(html, /data-image-caption="六月财务报表"/);
  assert.match(html, /<figcaption class="git-leaf-image-caption">六月财务报表<\/figcaption>/);
  assert.match(
    html,
    /src="\/raw\?repo=content-repo&amp;file=docs%2F_assets%2Freport\.png"/,
  );
});

test("renderMarkdown renders safe HTML images inside Markdown table cells", () => {
  const html = renderMarkdown(
    [
      "| Preview |",
      "| --- |",
      '| <img src="_assets/report.png" alt="报表" width="360" onerror="alert(1)"><br>六月报表 |',
    ].join("\n"),
    {
      currentFile: "docs/source.md",
      currentRepo: "content-repo",
    },
  );

  assert.match(html, /<td><span class="git-leaf-image-frame is-align-left"/);
  assert.match(html, /data-git-leaf-image="true"/);
  assert.match(html, /alt="报表"/);
  assert.match(html, /width="360"/);
  assert.match(html, /<br>六月报表<\/td>/);
  assert.match(
    html,
    /src="\/raw\?repo=content-repo&amp;file=docs%2F_assets%2Freport\.png"/,
  );
  assert.doesNotMatch(html, /onerror/);
  assert.doesNotMatch(html, /&lt;img/);
  assert.doesNotMatch(html, /&lt;br/);
});

test("renderMarkdown renders only controlled table text and highlight colors", () => {
  const html = renderMarkdown([
    "| 状态 | 说明 |",
    "| --- | --- |",
    '| <span style="color: #16a34a;">**健康**</span> | <span style="color: #ffffff;">不受控颜色</span> |',
    '| <span style="background-color: #d9770633;">_观察_</span> | <span style="color: #dc2626; background-color: #dc262633;">~~风险~~</span> |',
    '| **~~<span style="background-color: #2563eb33;">复核</span>~~** | 普通 |',
    '| <span style="background-color: #ffffff;">不受控高亮</span> | <span style="font-size: 40px;">不受控样式</span> |',
    '| <span style="color: #dc2626;" onclick="alert(1)">风险</span> | 普通 |',
  ].join("\n"));

  assert.match(
    html,
    /<span class="git-leaf-text-color" style="color:#16a34a"><strong>健康<\/strong><\/span>/,
  );
  assert.match(
    html,
    /&lt;span style=&quot;color: #ffffff;&quot;&gt;不受控颜色&lt;\/span&gt;/,
  );
  assert.match(
    html,
    /<span class="git-leaf-text-highlight" style="background-color:#d9770633"><em>观察<\/em><\/span>/,
  );
  assert.match(
    html,
    /<span class="git-leaf-text-color git-leaf-text-highlight" style="color:#dc2626;background-color:#dc262633"><s>风险<\/s><\/span>/,
  );
  assert.match(
    html,
    /<strong><s><span class="git-leaf-text-highlight" style="background-color:#2563eb33">复核<\/span><\/s><\/strong>/,
  );
  assert.match(
    html,
    /&lt;span style=&quot;background-color: #ffffff;&quot;&gt;不受控高亮&lt;\/span&gt;/,
  );
  assert.match(
    html,
    /&lt;span style=&quot;font-size: 40px;&quot;&gt;不受控样式&lt;\/span&gt;/,
  );
  assert.doesNotMatch(html, /<span[^>]*onclick=/);
  assert.doesNotMatch(html, /style="color:#ffffff"/);
});

test("controlled table text formats do not change table width measurement", () => {
  const source = [
    "| 渠道 | 收入与变化 | 状态 |",
    "| --- | ---: | --- |",
    "| 自然流量 | 128.4（↑ 12.4%） | 健康 |",
    "| 付费投放 | 96.7（↓ 8.7%） | 风险 |",
  ].join("\n");
  const coloredSource = source
    .replace(
      "自然流量",
      '**<span style="color: #d97706;">自然流量</span>**',
    )
    .replace(
      "128.4（↑ 12.4%）",
      '<span style="background-color: #d9770633;">128.4（↑ 12.4%）</span>',
    )
    .replace(
      "健康",
      '<span style="color: #16a34a; background-color: #16a34a33;">健康</span>',
    );
  const layoutMarkup = (html) => ({
    cardStyle: html.match(/<div class="table-card[^>]+style="([^"]+)"/)?.[1],
    colgroup: html.match(/<colgroup>[\s\S]*?<\/colgroup>/)?.[0],
  });

  assert.deepEqual(
    layoutMarkup(renderMarkdown(coloredSource)),
    layoutMarkup(renderMarkdown(source)),
  );
});

test("renderMarkdown renders image-only HTML paragraph wrappers as a gallery", () => {
  const html = renderMarkdown(
    '<p><img src="_assets/one.jpg" width="200" alt="第一张"> <img src="_assets/two.jpg" width="200" alt="第二张"></p>',
    {
      currentFile: "docs/source.md",
      currentRepo: "content-repo",
    },
  );

  assert.match(html, /class="git-leaf-image-gallery"/);
  assert.equal(html.match(/data-git-leaf-image="true"/g)?.length, 2);
  assert.match(html, /alt="第一张"/);
  assert.match(html, /alt="第二张"/);
  assert.doesNotMatch(html, /&lt;p/);
  assert.doesNotMatch(html, /&lt;\/p/);
});
