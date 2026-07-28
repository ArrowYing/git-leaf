---
last_updated: 2026-07-28
---

# Git Leaf 用户手册

[English](user-guide.md) | 简体中文

Git Leaf 是供人使用的桌面 App，用来打开和维护团队与 AI Agent 共享的 Git 上下文仓库。它直接打开已经
存在于本机的仓库，不会把仓库上传或复制到另一个知识服务。

这份手册面向需要理解和维护仓库、但不希望把 Git、Markdown 或开发工具变成日常工作方式的用户。截图使用
公开的 [Lighthouse Garden 示例仓库](https://github.com/MangoFuture1210/git-leaf-example-knowledge-base)。

## 从这里开始

1. 从[公开下载页](https://gitleaf.mangofuture.com/download?lang=zh-CN)安装 Git Leaf，或者使用
   [Community Build](build-from-source.md)。
2. 确认共享 Git 仓库已经作为一个本机文件夹存在。仓库维护者可以提前准备好，也可以克隆公开示例：

   ```bash
   git clone https://github.com/MangoFuture1210/git-leaf-example-knowledge-base.git
   ```

3. 打开 Git Leaf，选择仓库文件夹。
4. 通过目录树或搜索找到文档。Git Leaf 默认用 Preview 打开 Markdown 和 MDX。
5. 需要修改时再切换到 Live 或 Source。Git Leaf 会直接写入原文件并自动保存。

Git Leaf 没有单独的“保存”按钮。自动保存只代表修改已经写入本机；在发布以前，它仍然是尚未共享的本地
Git 改动。

## 认识 App 界面

![Git Leaf 展示仓库目录树、文档导航和易读的 Preview](assets/user-guide/browse-and-read.jpg)

App 界面主要分为四个区域：

| 区域 | 用途 |
| --- | --- |
| 顶栏 | 已打开文档的 Tab、Preview／Source／Live、分享和文档操作 |
| 左侧栏 | 仓库目录、搜索、All／Favorites／Sync 和 Agent Context |
| 文档导航 | 当前文档的标题目录；需要更多空间时可以隐藏 |
| 主区域 | 当前文档、编辑器或只读文件预览 |

下次启动时，Git Leaf 会恢复已经打开的仓库及其工作状态，包括 Tab、目录展开和阅读位置。

## 查找和阅读上下文

### 从目录树开始

目录结构是理解文档归属的主要方式。像使用普通文件浏览器一样展开文件夹、选择文件即可。

左侧栏有三个视图：

- **All** 显示普通仓库目录树。
- **Favorites** 集中放置经常返回的文件夹和 Markdown／MDX 文档。可以从右键菜单收藏，也可以使用当前
  文档旁的星标。
- **Sync** 显示远端状态和全部尚未发布的本地文件。

设置中可以选择“内容文件”或“全部仓库文件”。内容模式默认保留 Markdown、MDX、HTML、图片和 PDF；
其他文件在被打开、发生改动或被搜索命中时出现。这个偏好只改变目录树显示，绝不会改变 Git Leaf 发现、
同步、提交或推送的范围。

### 不必为了搜索而重组仓库

使用目录树上方的搜索框；也可以在 macOS 按 `Command+K`，在 Windows 按 `Ctrl+K`。空格分隔的词会
组合匹配，例如 `spring plan` 只保留同时匹配两个词的项目。搜索会临时显露到达结果所需的文件夹，但不会
永久覆盖你手动设置的目录展开状态。它匹配文件夹和文件名，以及仓库提供的搜索摘要，并不是文档正文全文
搜索。

### 带着来源阅读

Preview 呈现文档，同时保留原文件行号。右侧文档导航跟随标题。普通内部链接会留在 Git Leaf 内打开；
在 macOS 使用 Command-click，在 Windows 使用 Ctrl-click，可以把链接打开到另一个 Tab。

这些源文件行号也能在需要提问或纠正时，准确告诉 AI Agent 内容来自哪里。

## 选择合适的编辑方式

Git Leaf 始终编辑原来的 Markdown 或 MDX 文件。三种模式只是同一份源文件的不同界面：

| 模式 | 适合什么时候使用 |
| --- | --- |
| **Preview** | 阅读、跟随链接，或选择带来源的上下文 |
| **Live** | 做日常的小修改，同时让标题、列表、链接和其他结构保持易读 |
| **Source** | 需要精确控制 Markdown、MDX、Frontmatter 或结构化数据，并同时查看 Preview |

![Live 在直接编辑原文件的同时保持文档易读](assets/user-guide/live-editor.jpg)

做一个小修正时，Live 通常是最合适的选择。它不是第二份富文本文件：文字仍然属于原仓库，Agent 和其他
工具仍能直接读取。

![Source 同时显示准确的 Markdown 和呈现结果](assets/user-guide/source-editor.jpg)

当 Agent 写入了一段需要精确检查的语法，或者需要调整 Frontmatter 和结构化数据时，可以使用 Source。
Source 和 Live 都会自动写入本机工作目录。

Git Leaf 内只有 Markdown 和 MDX 可以编辑。其他仓库文件提供只读预览，或交给系统应用打开。

## Agent 直接读数据，人直接看图表

`.mdx` 文档可以把图表序列、表格行、指标、时间线、决策和流程保存为普通 CSV、TSV、JSON 或 Markdown
文本。AI Agent 能直接读取和修改源数据；Git Leaf 则把同一份源文件呈现为供人理解的视觉内容。

![Git Leaf 把 MDX 文档内的结构化数据呈现为图表](assets/user-guide/mdx-visuals.png)

这样可以避免截图或另一个仪表盘成为重要数据唯一的存在位置。Preview 呈现结果，Source 和 Live 仍然
编辑原文件。Git Leaf 只接受一组受控组件，不会运行任意 JSX、JavaScript、`import` 或文档脚本。

负责制作这类组件的仓库维护者可以查看英文技术文档
[MDX-lite reference](mdx-lite-guide.md)。普通读者只需要打开文档、使用呈现结果。

## 把准确上下文交给 AI Agent

Agent Context 用来收集准确段落，不需要在 Git Leaf 内置一个 Agent 对话框：

1. 在 Preview、Source 或 Live 中选择带来源的行。
2. 点击“加入上下文”。
3. 需要时继续从其他文档选择。
4. 打开左侧栏底部的 Agent Context，检查或移除选择内容。
5. 复制整个集合，粘贴到 Codex、Claude 或其他 Agent 工具。

![从 Agent Context 检查并复制一段带来源的内容](assets/user-guide/agent-context.jpg)

复制结果是通用 Markdown，带有仓库相对路径和行号范围。Agent Context 只是当前仓库和工作目录的临时
会话状态，不是长期内容数据库，也不会自动发送给任何 AI 服务商。

## 检查本地和远端改动

Git Leaf 会在打开仓库时及之后每隔十分钟检查一次 Git 远端：

- 本机工作目录干净、只是落后于远端时，Git Leaf 会安全地自动快进。
- 本地已有编辑时，Git Leaf 只报告远端新状态，不会在后台改变真实工作目录。
- “合并远端修改”只把远端版本带入本机分支，全部本地修改仍保持未提交。
- “同步并发布”会先整合必要的远端更新，再提交并推送**整个仓库的全部本地改动**。

![Sync 显示一个尚未发布的文件和明确的“同步并发布”操作](assets/user-guide/sync-and-publish.jpg)

Sync 刻意采用仓库级操作：它不让用户逐个暂存文件，也不要求填写 Git 提交说明。发布前，需要确认 Sync
列出的每个文件都应该进入下一份共享版本。

外部 AI Agent 修改同一个本机工作目录后，这些文件会像其他本地修改一样出现在 Sync。打开相关文档即可
阅读当前结果。Git Leaf 目前显示改动文件和当前文档内容，不提供完整的逐行 Diff 审核，也不会判断一处
改动来自哪个 Agent。

如果本地和远端历史已经分叉、出现冲突，或另一个 Git 操作正在进行，Git Leaf 会停止，不会改写历史，也
不会把未解决的合并留在真实工作目录。需要开发者级 Git 修复时，失败界面可以提供一段交给 AI Agent 的
提示词。

## 分享已经发布的文档

“复制分享链接”用于分享主工作目录 `main` 上的 Markdown／MDX 文档。文档尚未发布时，Git Leaf 会先
询问；确认“同步并复制”后，它会提交并推送仓库、复核 `origin/main` 上的 revision，再复制版本化链接。

需要注意这些边界：

- 链接不包含文档正文、Git 凭证或本机绝对路径。
- 链接会暴露 GitHub 仓库标识、仓库相对路径、revision 和可选标题。
- 链接不会给接收方授予私有仓库权限。
- 接收方仍然需要一个自己原本就有权限使用的本机 checkout。

HTTPS 中转服务由 Mango Future 托管。在敏感仓库路径或标题中使用前，请阅读
[托管链接的元数据与隐私](hosted-links.zh-CN.md)。

## 使用多个仓库和 worktree

Git Leaf 可以保持多个仓库处于已打开状态。仓库顺序保持稳定，每个仓库分别恢复自己的 Tab 和导航状态。

一个仓库存在多个 Git worktree 时，左侧栏上方会出现选择器。每个 worktree 分别保存 Tab、目录状态、
阅读位置和本地改动；收藏在同一个仓库内共享。普通用户通常应留在主工作目录，除非仓库维护者或 AI Agent
明确要求使用另一个 worktree。

如果 worktree 当前没有分支，Git Leaf 会在第一次真正写入前创建保护分支，不会让修改停留在 Detached
HEAD。

## 打开其他仓库文件

Git Leaf 保持以文档为中心，但仍然让周边证据可以被查看：

| 文件 | Git Leaf 的处理方式 |
| --- | --- |
| 图片和 PDF | 只读视觉预览 |
| HTML | 只读效果预览 |
| CSV | 只读表格预览 |
| JSON | 格式化树；解析失败时回退为文本 |
| YAML、文本、代码和配置 | 只读文本或代码预览 |
| 暂不支持的附件 | 条件允许时交给合适的系统应用打开 |

需要浏览普通内容范围以外的文件时，切换到“全部仓库文件”。

## 设置、帮助和快捷键

在 macOS 使用 `Command+,`，在 Windows 使用 `Ctrl+,` 打开“设置与帮助”。其中可以调整：

- 界面语言：跟随系统、英语或简体中文；
- 明亮或深色外观；
- 文档字体和字号；
- “内容文件”或“全部仓库文件”；
- 当前发行版提供的构建、更新和使用统计设置。

同一页面还包含 Git Leaf 帮助、文件类型支持、环境与仓库状态，以及完整快捷键列表。在 macOS 使用
`Command+/`，在 Windows 使用 `Ctrl+/` 可以直接打开快捷键。

## 什么时候应该换用其他工具

当团队和 AI Agent 共享同一个 Git 仓库，而一部分对内容负责的人不希望采用开发者工作流时，Git Leaf
才是合适的人类界面。

详细 Diff、选择性暂存、创建分支、Rebase、解决冲突、重构代码和仓库管理，应使用 IDE 或 Git 客户端；
大范围修改和开发者级修复，应交给外部 AI Agent。Git Leaf 保持专注：让人能够阅读、检查、提供准确
上下文，并对同一批文件做范围明确的修正。

产品范围、下载方式和构建身份见 [Git Leaf README](../README.zh-CN.md)。
