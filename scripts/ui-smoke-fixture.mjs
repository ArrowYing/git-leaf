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

export const TREE_TOOLTIP_SMOKE_ACCEPTANCE =
  "目录树和文档导航中的截断项都应在悬停后快速显示同款浮层；文档导航分隔线可向右拖宽但不能小于初始宽度；浮层出现后保持鼠标静止至少 10 秒，期间不得消失、闪动或重建。";

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
    writeFileSync(path.join(repoRoot, "README.md"), "# Git Leaf UI Smoke Fixture\n", "utf8");
    writeFileSync(
      documentPath,
      [
        "# Long filename tooltip smoke",
        "",
        "This repository exists only for the isolated Git Leaf UI smoke scenario.",
        "",
        "## Acceptance",
        "",
        TREE_TOOLTIP_SMOKE_ACCEPTANCE,
        "",
        `## ${DOCUMENT_OUTLINE_SMOKE_HEADING}`,
        "",
        "The outline item is intentionally long so the isolated app exposes truncation.",
        "",
      ].join("\n"),
      "utf8",
    );
    for (const fileName of SIBLING_FILE_NAMES) {
      writeFileSync(path.join(documentDirectory, fileName), `# ${fileName}\n`, "utf8");
    }
    runGit(["init", "--quiet"], repoRoot);
    return {
      repoRoot,
      file: TREE_TOOLTIP_SMOKE_RELATIVE_FILE,
      acceptance: TREE_TOOLTIP_SMOKE_ACCEPTANCE,
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
