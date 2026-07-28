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

Git Leaf 是 App；用户打开的本机 Git 仓库才是知识库，也是它的内容事实源。Git Leaf 为人提供熟悉的界面，用来阅读、
搜索、编辑和同步其中的 Markdown／MDX 文件，同时保留开发者、自动化和 AI Agent 直接使用的路径、revision、分支和
worktree。

## 核心工作流

- **直接打开已有知识库。** Git Leaf 可以使用任意本机 Git 仓库，无需把内容导入另一个系统；Git
  仓库始终是知识库的内容事实源。
- **通过熟悉的界面阅读和编辑。** 搜索 Markdown／MDX，在 Preview、Source、Live 之间切换，所有修改
  始终写入同一份纯文本文件。
- **让人与 AI Agent 使用同一份文件。** 把准确行选区整理成通用 Agent 上下文，让 Agent 直接读取或修改
  仓库，再回到 Git Leaf 检查改动。
- **引入远端变化，同时保留尚未完成的编辑。** Git Leaf 会在打开仓库时及之后每隔 10 分钟检查远端；
  工作区干净时自动快进，也可以在本地有改动时合入远端版本，并让全部本地编辑保持未提交。
- **检查后再发布。** Sync 同时显示尚未发布的本地改动和远端状态；“同步并发布”由人主动触发提交与
  推送，在 Git 需要处理时安全停止；“复制分享链接”只在复核已发布 revision 后返回版本化链接。

## 更多能力

- All、Favorites、Sync 三个视图，可在“内容文件”和完整仓库目录树之间切换。
- 仓库与 worktree 切换，并分别恢复文档 Tab、导航历史、滚动位置和焦点。
- 只读预览图片、PDF、CSV、JSON、YAML、HTML、代码和其他仓库附件。
- 保留源文件行号与引用，说明选中内容来自哪里。
- 通过受控 MDX-lite 组件呈现结构化内容，不执行任意文档脚本。

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
- 只有 Markdown／MDX 可以编辑；其他仓库文件保持只读或由系统应用打开。
- 文件树的显示偏好不改变 Git 文件发现、状态统计、同步或提交范围。
- 正常分支都可以编辑；Detached worktree 在第一次实际写入前自动创建保护分支。
- Source／Live 实时写回、localhost 绑定、MDX-lite 白名单、分享 revision 门禁和 Git 历史安全不是个人设置。
- 公开 `/open`、`/share` 页面由 Mango Future 托管，只承担打开和分享中转。它们会接收仓库标识和文档元数据，
  不接收 Git 凭证或文档正文；完整说明见[托管链接的元数据与隐私](docs/hosted-links.zh-CN.md)。

## 文档职责

| 文档 | 维护内容 |
| --- | --- |
| 本文 | 产品定位、当前能力、使用入口和文档索引 |
| [docs/README.md](docs/README.md) | 英文文档索引和读者路线 |
| [docs/build-from-source.md](docs/build-from-source.md) | Community Build 的环境、运行、打包和身份 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变化、兼容性和安装包校验方式 |
| [docs/architecture.md](docs/architecture.md) | 当前系统架构、跨模块行为协议和不可绕过的产品边界 |
| [docs/mdx-lite-guide.md](docs/mdx-lite-guide.md) | MDX-lite 语法、组件白名单和渲染契约 |
| [docs/mdx-lite-components-demo.mdx](docs/mdx-lite-components-demo.mdx) | MDX-lite 完整开发与视觉回归样例 |
| [docs/release.md](docs/release.md) | 正式发布、candidate／stable、签名、公证和 tag 流程（英文） |
| [docs/windows-portable-guide.zh-CN.md](docs/windows-portable-guide.zh-CN.md) | Windows unsigned Preview 的安装、更新和安全说明 |
| [docs/hosted-links.zh-CN.md](docs/hosted-links.zh-CN.md) | `/open`、`/share` 传输的仓库元数据和隐私边界 |
| [docs/app-usage-analytics-spec.md](docs/app-usage-analytics-spec.md) | 正式版使用统计、隐私、事件和指标的唯一口径（英文） |
| [marketing/README.md](marketing/README.md) | 产品传播定位、开源推广方向和未来 Agent 推广设想（英文） |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献方式、开发验证和 Pull Request 要求 |
| [SECURITY.md](SECURITY.md) | 安全边界和漏洞报告方式 |
| [AGENTS.md](AGENTS.md) | Agent 的阅读路由、安全红线、验证门槛和交付流程；不维护功能清单 |

## 开发验证

```bash
npm test
npm run test:all
npm run test:ci:mac
npm run test:ci:win
```

修改 `src/client/source-editor.mjs` 后还必须运行 `npm run build:client` 并提交生成的
`public/source-editor.bundle.js`。UI 专项验收与 userData 隔离要求见 [AGENTS.md](AGENTS.md)。

## License

源码使用 [Apache License 2.0](LICENSE)。该许可证不授予将社区构建描述为 Mango Future 官方发行版的权利；
官方身份以公司代码签名、官方下载渠道、checksum、tag 和公开 commit 的对应关系为准。
