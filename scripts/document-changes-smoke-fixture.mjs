import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const DOCUMENT_CHANGES_SMOKE_FILE = "editing-trace.md";
export const DOCUMENT_CHANGES_SMOKE_SIBLING = "unchanged-reference.md";
export const DOCUMENT_CHANGES_SMOKE_ACCEPTANCE = [
  "Preview 正文的当前新增或替换内容显示低干扰暖色底；",
  "左侧文档导航中的“文档顶部”“概览”和“交付”铺满整行改动底色，“未改章节”不着色，点击仍跳到原位置；",
  "右上角删除内容开关默认关闭并以紧凑清晰的图标展示，打开后图标出现实心状态点；被删除文字只增加清晰删除线、不另加颜色，原有单列当前文档行号保持不变；",
  "Source 与 Live 保持同一改动语义，拖选文字在深色模式下显示清晰蓝色底；",
  "正文自动保存并刷新改动提示时，目录自身的滚动位置保持稳定；只有正文实际滚到另一个章节时，目录才继续沿用原有的活动章节定位；",
  `打开 ${DOCUMENT_CHANGES_SMOKE_SIBLING} 后再返回，改动提示仍能从提交版本重新恢复。`,
].join("");

export function documentChangesSmokeBaseline() {
  return [
    "# 编辑轨迹验收",
    "",
    "文档顶部的说明保持不变。",
    "",
    "## 概览",
    "",
    "运营方案暂缓发布，并保留旧文案。",
    "这一整行将在当前文档中删除。",
    "概览中的稳定内容。",
    "",
    ...stableSmokeParagraphs("概览", 10),
    "## 交付",
    "",
    "交付章节的稳定内容。",
    "",
    ...stableSmokeParagraphs("交付", 8),
    "## 未改章节",
    "",
    "这里没有任何编辑。",
    "",
  ].join("\n");
}

export function documentChangesSmokeCurrent() {
  return [
    "# 编辑轨迹验收",
    "",
    "文档顶部的说明已由运营补充。",
    "",
    "## 概览",
    "",
    "运营方案本周发布，并保留文案。",
    "概览中的稳定内容。",
    "",
    ...stableSmokeParagraphs("概览", 10),
    "## 交付",
    "",
    "交付章节的稳定内容。",
    "新增一条需要快速定位的交付说明。",
    "",
    ...stableSmokeParagraphs("交付", 8),
    "## 未改章节",
    "",
    "这里没有任何编辑。",
    "",
  ].join("\n");
}

function stableSmokeParagraphs(section, count) {
  return Array.from({ length: count }, (_value, index) => [
    `${section}稳定段落 ${index + 1}，用于验证目录点击后的滚动定位。`,
    "",
  ]).flat();
}

export function createDocumentChangesSmokeFixture({
  temporaryRoot = tmpdir(),
  runGit = runGitCommand,
} = {}) {
  const repoRoot = mkdtempSync(
    path.join(path.resolve(temporaryRoot), "git-leaf-document-changes-smoke-"),
  );
  try {
    writeFileSync(
      path.join(repoRoot, DOCUMENT_CHANGES_SMOKE_FILE),
      documentChangesSmokeBaseline(),
      "utf8",
    );
    writeFileSync(
      path.join(repoRoot, DOCUMENT_CHANGES_SMOKE_SIBLING),
      "# 未改参考文档\n\n用于验证切换文档后返回。\n",
      "utf8",
    );
    runGit(["init", "--quiet", "--initial-branch=main"], repoRoot);
    runGit(["add", DOCUMENT_CHANGES_SMOKE_FILE, DOCUMENT_CHANGES_SMOKE_SIBLING], repoRoot);
    runGit([
      "-c",
      "user.name=OpenPeek Smoke",
      "-c",
      "user.email=smoke@gitleaf.local",
      "commit",
      "--quiet",
      "-m",
      "Add document changes smoke baseline",
    ], repoRoot);
    writeFileSync(
      path.join(repoRoot, DOCUMENT_CHANGES_SMOKE_FILE),
      documentChangesSmokeCurrent(),
      "utf8",
    );
    return {
      repoRoot,
      file: DOCUMENT_CHANGES_SMOKE_FILE,
      siblingFile: DOCUMENT_CHANGES_SMOKE_SIBLING,
      acceptance: DOCUMENT_CHANGES_SMOKE_ACCEPTANCE,
    };
  } catch (error) {
    rmSync(repoRoot, { recursive: true, force: true });
    throw error;
  }
}

export function readDocumentChangesSmokeDocument(fixture) {
  return readFileSync(path.join(path.resolve(fixture.repoRoot), fixture.file), "utf8");
}

export function cleanupDocumentChangesSmokeFixture(fixture) {
  const repoRoot = path.resolve(fixture?.repoRoot || "");
  const temporaryRoot = path.resolve(tmpdir());
  const relative = path.relative(temporaryRoot, repoRoot);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !path.basename(repoRoot).startsWith("git-leaf-document-changes-smoke-")
  ) {
    throw new Error(`Refusing to clean an unexpected document changes fixture: ${repoRoot}`);
  }
  rmSync(repoRoot, { recursive: true, force: true });
}

function runGitCommand(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
}
