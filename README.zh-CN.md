---
last_updated: 2026-07-28
---

# Git Leaf

[English](README.md) | 简体中文

面向 Git 知识库的桌面应用。

无需直接操作 Git 或 Markdown，即可打开并维护知识库。

任何人都可以使用 Git Leaf，AI Agent 则直接使用 Git 中的同一份文件。

[**下载 macOS 版**](https://gitleaf.mangofuture.com/download?lang=zh-CN#macos) ·
[Windows Preview](https://gitleaf.mangofuture.com/download?lang=zh-CN#windows) ·
[从源码构建](docs/build-from-source.md)

![Git Leaf 展示 Git 知识库、本地改动和 Agent 上下文](marketing/assets/git-leaf-product.png)

[![CI](https://github.com/MangoFuture1210/git-leaf/actions/workflows/ci.yml/badge.svg)](https://github.com/MangoFuture1210/git-leaf/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

安装 Git Leaf 后，可以直接[打开公开示例知识库](https://gitleaf.mangofuture.com/open?repo=mangofuture1210%2Fgit-leaf-example-knowledge-base&path=README.md)，
也可以先克隆到本机，完成一次完全本地的首次体验。

## 核心工作流

- **直接打开已有知识库。** Git Leaf 可以使用任意本机 Git 仓库，无需把内容导入另一个系统；Git
  仓库始终是知识库的内容事实源。
- **沿着熟悉的目录找到文档。** 在目录树中按原有文件夹结构浏览知识库，也可以直接搜索。空格分隔的
  多个关键词会共同收窄结果；命中的目录名和文件名会高亮，并且只保留命中项及到达它们所需的上级目录。
- **在 Live Editor 中边看边改。** 标题、列表、链接等内容以接近阅读效果的方式呈现，每次修改仍保存到
  原来的文件；需要时可以切换到 Preview 或 Source。
- **让人与 AI Agent 使用同一份文件。** 把准确行选区整理成通用 Agent 上下文，让 Agent 直接读取或修改
  仓库，再回到 Git Leaf 检查改动。
- **引入远端变化，同时保留尚未完成的编辑。** Git Leaf 会在打开仓库时及之后每隔 10 分钟检查远端；
  工作区干净时自动快进，也可以在本地有改动时合入远端版本，并让全部本地编辑保持未提交。
- **检查后再发布。** Sync 同时显示尚未发布的本地改动和远端状态；“同步并发布”由人主动触发提交与
  推送，在 Git 需要处理时安全停止；“复制分享链接”只在复核已发布 revision 后返回版本化链接。

## 更多能力

- All、Favorites、Sync 三个视图，可在“内容文件”和完整仓库目录树之间切换。
- 克制的目录树文件操作：重命名单个普通文件、新建可进入 Git 的文件夹，以及直接删除单个文件或空文件夹；
  暂不提供移动和非空文件夹递归删除。
- 仓库与 worktree 切换，并分别恢复文档 Tab、导航历史、滚动位置和焦点。
- 只读预览图片、PDF、CSV、JSON、YAML、HTML、代码和其他仓库附件。
- 保留源文件行号与引用，说明选中内容来自哪里。

## 不只是文字

知识库中的文档还可以直接呈现数据表、时间线、关键指标、决策、流程图和图表。内容仍然以可读文本保存在
Git 中，人与 AI Agent 可以继续读取和修改同一份文件。

Git Leaf 使用安全的内置组件呈现这些内容，文档本身不能运行代码或脚本。

![Git Leaf 在知识库文档中呈现柱线组合图](marketing/assets/git-leaf-mdx-chart.png)

## Git Leaf、Obsidian 和 VS Code 怎么选

这三个工具都能打开本机文本文件，但设计出发点不同：

| 主要需求 | 更适合 |
| --- | --- |
| 知识已经放在 Git 中，希望产品、运营、项目负责人和 AI Agent 共同维护，但不希望每个人都直接操作 Git 或 Markdown | **Git Leaf** |
| 以笔记、双向链接和可扩展的本地 Markdown 知识库为中心，Git 不是主要工作流 | [**Obsidian**](https://obsidian.md/help/obsidian) |
| 主要编写代码，并愿意直接处理项目文件、Git 暂存、提交、分支和冲突 | [**VS Code**](https://code.visualstudio.com/docs/sourcecontrol/overview) |

同一个仓库不必让所有人使用同一种工具。产品、运营和项目人员可以使用 Git Leaf；开发者可以继续使用
VS Code 或命令行；AI Agent 直接使用仓库文件。大家维护的仍是同一个 Git 仓库中的内容。

## 下载

普通用户使用已安装的 Git Leaf 桌面 App。首次打开时选择本机 Git 仓库；之后 App 会恢复已打开仓库和各
worktree 的工作台状态。官方公开安装包由 [Git Leaf 下载页](https://gitleaf.mangofuture.com/download?lang=zh-CN) 提供；
公司内部正式包通过公司发布渠道提供，不会出现在公开下载页。

Mango Future 官方 macOS 安装包使用 Developer ID 签名和公证。Windows 当前是明确标记的 unsigned Preview；
下载后应核对发布版本的 SHA-256，具体见 [Windows Preview](docs/windows-portable-guide.md)。

### 从源码运行

从源码运行需要 Node.js 22 或更高版本，并且本机已安装 Git：

```bash
npm ci
npm run desktop -- --repo /path/to/docs-repo
```

[从源码构建指南](docs/build-from-source.md)说明了依赖、打包方式、Community Build 身份，以及它与
Mango Future 官方发行版的区别。[公开示例知识库](https://github.com/MangoFuture1210/git-leaf-example-knowledge-base)
提供了一组可以直接打开的 Markdown／MDX 内容。

CLI／Web 入口主要用于本机开发和浏览器工作台：

```bash
npm start -- /path/to/docs-repo/README.md
npm start -- /path/to/docs-repo/README.md --no-open
```

桌面版和 CLI／Web 服务都只监听 localhost。开发版人工检查使用独立、持久的开发配置；Agent 自动化 smoke
使用一次性副本，不能写入正式版配置。具体命令和安全边界见 [AGENTS.md](AGENTS.md)。

## 构建身份与隐私

| 构建 | 更新轨道 | 新安装默认使用统计 |
| --- | --- | --- |
| 社区或本机源码构建 | 关闭 | 关闭 |
| Mango Future 官方公开包 | `stable` | 关闭 |
| Mango Future 官方内部包 | `internal-stable` | 开启 |

Settings 会显示当前是“社区构建”“官方公开构建”“官方内部构建”还是“开发构建”，并显示实际使用统计状态。
构建包里的默认值只用于首次初始化；后续更新不会覆盖 userData 中已经存在的 `usageAnalyticsEnabled`。

使用统计只在公司管理的官方构建且本机设置已启用时运行。它不发送仓库名、路径、文件名、搜索词、文档内容或
Git 身份。完整事件语义与禁止推断项见英文技术文档
[Usage analytics specification](docs/app-usage-analytics-spec.md)。

## 产品边界

- Git Leaf 是本地工具，不提供账号、SSO、多人协同编辑或公网文档站。
- Git Leaf 只编辑 Markdown／MDX 的正文；其他仓库文件保持只读或由系统应用打开，但仍可在目录树中重命名
  或删除普通文件。
- 文件树的显示偏好不改变 Git 文件发现、状态统计、同步或提交范围。
- 正常分支都可以编辑；Detached worktree 在第一次实际写入前自动创建保护分支。
- Source／Live 实时写回、localhost 绑定、MDX-lite 白名单、分享 revision 门禁和 Git 历史安全不是个人设置。
- 公开 `/open`、`/share` 页面由 Mango Future 托管，只承担打开和分享中转。它们会接收仓库标识和文档元数据，
  不接收 Git 凭证或文档正文；完整说明见[托管链接的元数据与隐私](docs/hosted-links.zh-CN.md)。

## 开发验证

```bash
npm test
npm run test:all
npm run test:ci:mac
npm run test:ci:win
```

修改 `src/client/source-editor.mjs` 后还必须运行 `npm run build:client` 并提交生成的
`public/source-editor.bundle.js`。贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，技术文档入口见
[docs/README.md](docs/README.md)，UI 专项验收与 userData 隔离要求见 [AGENTS.md](AGENTS.md)。

## License

源码使用 [Apache License 2.0](LICENSE)。该许可证不授予将社区构建描述为 Mango Future 官方发行版的权利；
官方身份以公司代码签名、官方下载渠道、checksum、tag 和公开 commit 的对应关系为准。
