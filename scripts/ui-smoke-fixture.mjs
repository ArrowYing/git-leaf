import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const TREE_TOOLTIP_SMOKE_RELATIVE_FILE = [
  "research",
  "projects",
  "ai-learning-future",
  "2026-07-12-asu-chatgpt-edu-boundary-card-with-an-intentionally-long-title-v01.md",
].join("/");

export const DOCUMENT_OUTLINE_SMOKE_HEADING =
  "这是一个明显超过文档导航最小宽度并且必须通过快速自绘浮层才能完整阅读的二级标题";

export const DOCUMENT_OUTLINE_SMOKE_H4_HEADING =
  "H4 跳级标题应显示为第二级导航";

export const DOCUMENT_OUTLINE_SMOKE_H5_HEADING =
  "H5 标题应显示为第三级导航";

export const DOCUMENT_OUTLINE_SMOKE_ACCEPTANCE =
  `文档导航必须显示 ${DOCUMENT_OUTLINE_SMOKE_H4_HEADING} 与 ${DOCUMENT_OUTLINE_SMOKE_H5_HEADING}，并把 H2、H4、H5 压缩为连续的三级缩进。`;

export const TREE_TOOLTIP_SMOKE_SEARCH_TERM = "boundary";

export const TREE_TOOLTIP_SMOKE_DOCUMENT_TITLE =
  "AI 学习未来：研究边界卡片与验证记录";

export const TREE_TOOLTIP_SMOKE_ROOT_FILE = "CONTEXT.md";

export const TREE_TOOLTIP_SMOKE_ROOT_TITLE =
  "Mango OS 上下文地图（给兄弟仓库 / 外部消费者）";

export const TREE_TOOLTIP_SMOKE_AI_SNIPPET =
  "AI search context boundary evidence that is intentionally longer than the narrow sidebar";

export const TREE_TOOLTIP_SMOKE_READONLY_FILE = [
  "research",
  "projects",
  "ai-learning-future",
  "user-growth-daily-summary-with-an-intentionally-long-filename.csv",
].join("/");

export const TREE_TOOLTIP_SMOKE_ACCEPTANCE =
  `目录树中的目标英文文件名必须保留在第一行，中文 title ${TREE_TOOLTIP_SMOKE_DOCUMENT_TITLE} 默认作为主要视觉信息显示在第二行，文件名仅略微淡化且仍清晰可读，浮窗也必须保持相同层级；关闭“目录树文档标题”设置后目标项必须恢复单行且 title 搜索不再命中，重新开启后第二行与搜索结果必须恢复；目录树和文档导航中的截断项都应在悬停后快速显示同款浮层；文件名浮层不设宽度上限，完整文件名始终保持单行，不能因换行改变浮层高度；浮层内文件名与 title 的文字起点必须分别和目录树原文两行对齐，根目录 ${TREE_TOOLTIP_SMOKE_ROOT_FILE} 也不得因左侧安全边距而右移；浮层出现后，直接点击它覆盖的原文件行或相邻文件行必须打开实际点击的文档，浮层不得抢走点击；将鼠标从目录行直接移入浮层的文件名与 title 两行时，浮层必须继续显示而不得闪动、消失或重新计时；搜索 ${TREE_TOOLTIP_SMOKE_SEARCH_TERM} 后，截断文件名浮层应展示完整高亮名称，从 README 文件名进入整行也应及时展示文件名、title 与完整高亮 AI snippet 三行，浮层从文件名起点展开，鼠标在文件名、title 与 snippet 之间移动时不得消失或重新计时；搜索并打开 ${TREE_TOOLTIP_SMOKE_READONLY_FILE} 时，目录行必须把完整可用宽度留给文件名而不重复显示“只读”，现有浮窗内容不得增加能力状态行，顶部模式区域必须只保留 Preview 并显示“只读”；文档导航分隔线可向右拖宽但不能小于初始宽度；浮层出现后保持鼠标静止至少 10 秒，期间不得消失、闪动或重建。`;

const SIBLING_FILE_NAMES = [
  "2026-07-12-market-research-interview-evidence-card-with-a-long-title-v01.md",
  "2026-07-12-parent-and-student-value-boundary-evidence-card-v01.md",
  "2026-07-12-teacher-workflow-observation-and-verification-notes-v01.md",
  "2026-07-12-learning-product-replacement-mechanism-evidence-card-v01.md",
];

export function createTreeTooltipSmokeFixture({
  temporaryRoot = tmpdir(),
  runGit = runGitCommand,
} = {}) {
  const repoRoot = mkdtempSync(path.join(path.resolve(temporaryRoot), "git-leaf-tree-tooltip-smoke-"));
  try {
    const documentPath = path.join(repoRoot, ...TREE_TOOLTIP_SMOKE_RELATIVE_FILE.split("/"));
    const documentDirectory = path.dirname(documentPath);
    mkdirSync(documentDirectory, { recursive: true });
    mkdirSync(path.join(repoRoot, "docs"), { recursive: true });
    writeFileSync(
      path.join(repoRoot, "docs", "frontmatter-rules.json"),
      `${JSON.stringify({
        version: 1,
        basicFields: ["title", "domain", "ai_snippet"],
      }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(repoRoot, "README.md"),
      [
        "---",
        `ai_snippet: "${TREE_TOOLTIP_SMOKE_AI_SNIPPET}"`,
        "---",
        "",
        "# OpenGlance UI Smoke Fixture",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      path.join(repoRoot, TREE_TOOLTIP_SMOKE_ROOT_FILE),
      [
        "---",
        `title: ${TREE_TOOLTIP_SMOKE_ROOT_TITLE}`,
        "---",
        "",
        `# ${TREE_TOOLTIP_SMOKE_ROOT_TITLE}`,
        "",
        "This root-level document protects start-edge tooltip alignment.",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      documentPath,
      [
        "---",
        `title: ${TREE_TOOLTIP_SMOKE_DOCUMENT_TITLE}`,
        "---",
        "",
        "# Long filename tooltip smoke",
        "",
        "This repository exists only for the isolated OpenGlance UI smoke scenario.",
        "",
        "## Acceptance",
        "",
        TREE_TOOLTIP_SMOKE_ACCEPTANCE,
        "",
        DOCUMENT_OUTLINE_SMOKE_ACCEPTANCE,
        "",
        `## ${DOCUMENT_OUTLINE_SMOKE_HEADING}`,
        "",
        "The outline item is intentionally long so the isolated app exposes truncation.",
        "",
        `#### ${DOCUMENT_OUTLINE_SMOKE_H4_HEADING}`,
        "",
        "This skipped heading level must still appear one navigation depth below H2.",
        "",
        `##### ${DOCUMENT_OUTLINE_SMOKE_H5_HEADING}`,
        "",
        "This heading must appear one navigation depth below H4.",
        "",
      ].join("\n"),
      "utf8",
    );
    for (const fileName of SIBLING_FILE_NAMES) {
      writeFileSync(path.join(documentDirectory, fileName), `# ${fileName}\n`, "utf8");
    }
    writeFileSync(
      path.join(repoRoot, ...TREE_TOOLTIP_SMOKE_READONLY_FILE.split("/")),
      "date,active_users\n2026-08-01,1200\n",
      "utf8",
    );
    runGit(["init", "--quiet"], repoRoot);
    return {
      repoRoot,
      file: TREE_TOOLTIP_SMOKE_RELATIVE_FILE,
      readonlyFile: TREE_TOOLTIP_SMOKE_READONLY_FILE,
      rootFile: TREE_TOOLTIP_SMOKE_ROOT_FILE,
      acceptance: `${TREE_TOOLTIP_SMOKE_ACCEPTANCE} ${DOCUMENT_OUTLINE_SMOKE_ACCEPTANCE}`,
      searchTerm: TREE_TOOLTIP_SMOKE_SEARCH_TERM,
    };
  } catch (error) {
    rmSync(repoRoot, { recursive: true, force: true });
    throw error;
  }
}

export function cleanupTreeTooltipSmokeFixture(fixture) {
  const repoRoot = path.resolve(fixture?.repoRoot || "");
  const temporaryRoot = path.resolve(tmpdir());
  const relative = path.relative(temporaryRoot, repoRoot);
  if (
    relative.startsWith("..")
    || path.isAbsolute(relative)
    || !path.basename(repoRoot).startsWith("git-leaf-tree-tooltip-smoke-")
  ) {
    throw new Error(`Refusing to clean an unexpected UI smoke fixture: ${repoRoot}`);
  }
  rmSync(repoRoot, { recursive: true, force: true });
}

function runGitCommand(args, cwd) {
  const result = spawnSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
}
