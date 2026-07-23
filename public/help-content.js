export const GIT_LEAF_HELP_SECTIONS = [
  {
    id: "repository-files",
    title: "仓库文件",
    body: [
      "Git Leaf 始终发现仓库中全部已跟踪文件和未被 .gitignore 忽略的本地文件。目录树可以选择“内容文件”或“全部仓库文件”。内容文件模式默认显示 Markdown / MDX、HTML、图片和 PDF；HTML 常用于原型、副文本输出和报表，因此与 PDF 一样作为内容常驻展示。",
      "CSV、JSON、YAML、TXT、代码、配置和未知类型不会常驻内容目录。当前打开的文件、搜索结果、当前文档引用，以及“仅本地改动”中的文件会按需临时显露。全部仓库文件模式仍会显示完整仓库。",
      "目录树偏好只改变显示，不改变 Git 改动发现、同步或提交范围。只有 Markdown / MDX 可以在 Source / Live 中编辑；HTML、图片、PDF、结构化数据、文本和代码按对应方式只读预览，暂不支持预览的文件可以交给系统应用打开。",
    ],
  },
  {
    id: "filters",
    title: "搜索与 Frontmatter 筛选",
    body: [
      "筛选按钮依赖目标仓库里的 docs/frontmatter-rules.json。没有这个规则文件，或规则里没有可用于聚合的 frontmatter 字段时，Git Leaf 会隐藏筛选按钮。",
      "这是文档筛选：筛选项来自 Markdown / MDX 文件开头的 frontmatter。启用后，图片、附件和其他非文档文件会暂时隐藏；清除筛选即可恢复内容目录。多个条件按 AND 组合；ai_snippet 只参与搜索框文本搜索。",
    ],
  },
  {
    id: "worktrees",
    title: "工作树与分支",
    body: [
      "仓库只有一个主工作目录时，Git Leaf 不显示工作树选择器。检测到多个 worktree 后，左侧目录树上方会显示选择器，并标出各工作目录所在分支。",
      "正常分支都可以使用 Preview、Source 和 Live。切换 worktree 时，Git Leaf 会分别恢复该工作目录的 Tab、目录展开、滚动和焦点状态。",
      "显示“无分支”表示当前 worktree 还没有工作分支。第一次实际写入前，Git Leaf 会自动创建保护分支，避免修改停留在 Detached HEAD。",
      "普通同事通常不需要主动创建或切换 worktree；不确定当前工作目录用途时，先保持主工作目录，或交给 AI Agent 确认。",
    ],
  },
  {
    id: "sync",
    title: "同步",
    body: [
      "左侧出现本地改动数量时，点击“同步”会一次同步当前仓库的全部改动，包括文档、图片、附件和删除；不需要选择文件、填写提交说明或理解 Git 命令。",
      "同步时按钮会显示“正在同步…”，完成后提示“同步完成”。同步期间后来产生的新修改仍保留在本机，不会被悄悄覆盖。",
      "遇到分支分叉、冲突或持续变化时，Git Leaf 会停止危险操作并保留本地内容；复制界面里的提示词交给你选择的 AI Agent 继续处理即可。",
    ],
  },
  {
    id: "sharing",
    title: "分享文档",
    body: [
      "右上角“复制分享链接”只分享主工作区 main 中已经提交并发布的 Markdown / MDX 文档，不会分享本机路径、feature worktree 或未同步内容。",
      "把链接发到飞书等聊天工具时，卡片只使用已发布版本的文档标题，分享 URL 不携带 ai_snippet；卡片描述回退显示仓库与文档路径。卡片只是预览，不会授予文档访问权限。",
      "接收方点击链接后，Git Leaf 会检查本地主工作区和分享版本。需要从其他 worktree 切回主工作区、保留本地修改更新 main，或先同步重叠文件时，应用会先明确询问。",
      "分享链接不会授予 GitHub 权限；接收方本机尚未打开对应仓库时，Git Leaf 会要求选择本机目录并核对 GitHub origin，取消选择不会改变当前工作区。分享前需要同步时，确认后会直接执行同一个全文件“同步”动作。",
    ],
  },
  {
    id: "telemetry",
    title: "基础使用统计",
    body: [
      "Git Leaf 正式版会发送匿名安装实例、App 版本、更新状态、每日活跃时长、仓库数量和核心功能次数，用于了解安装更新是否正常以及工具是否被实际使用。",
      "统计不会发送仓库名、仓库路径、分支名、worktree 身份、文件名、文档内容、搜索词、链接、Git 身份、diff 或错误原文。设备名称只出现在低频安装观察日志中，不作为行为标识。开发版、测试和 CLI / Web 入口不会发送正式统计。",
    ],
  },
];

export const FILE_TYPE_HELP_ROWS = [
  {
    files: ".md .mdx",
    visibility: "默认显示",
    behavior: "Markdown / MDX 预览，可编辑",
  },
  {
    files: ".avif .bmp .png .jpg .jpeg .gif .webp .svg",
    visibility: "默认显示",
    behavior: "图片预览",
  },
  {
    files: ".pdf",
    visibility: "默认显示",
    behavior: "浏览器 PDF 预览",
  },
  {
    files: ".html .htm",
    visibility: "默认显示",
    behavior: "浏览器 HTML 效果预览，只读",
  },
  {
    files: ".csv",
    visibility: "按需显示",
    behavior: "表格预览，首行作为表头",
  },
  {
    files: ".json",
    visibility: "按需显示",
    behavior: "格式化 JSON 树；解析失败时按文本显示",
  },
  {
    files: ".yaml .yml .txt",
    visibility: "按需显示",
    behavior: "只读代码块 / 纯文本预览",
  },
  {
    files: ".js .ts .py .css .toml 等文本代码 / 配置",
    visibility: "按需显示",
    behavior: "只读代码预览，不提供编辑",
  },
  {
    files: "其他文件（例如 .pptx）",
    visibility: "按需显示",
    behavior: "打开后检测预览能力；不支持时使用系统应用打开",
  },
];

export function gitLeafHelpPlainText() {
  return [
    "Git Leaf Help",
    "",
    ...GIT_LEAF_HELP_SECTIONS.flatMap((section) => [
      section.title,
      ...section.body,
      "",
    ]),
    "文件类型支持",
    `${"文件类型".padEnd(30)}${"内容模式".padEnd(12)}打开方式`,
    ...FILE_TYPE_HELP_ROWS.map((row) => `${row.files.padEnd(30)}${row.visibility.padEnd(12)}${row.behavior}`),
  ].join("\n").trim();
}
