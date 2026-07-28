---
last_updated: 2026-07-27
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

## 当前能力

- 打开任意本机 Git 仓库，并保留多个已打开仓库的稳定顺序；同一仓库存在多个 worktree 时可以直接切换。
- 目录树支持“内容文件”和“全部仓库文件”两种个人偏好；内容模式默认显示 Markdown／MDX、HTML、图片和 PDF，搜索、当前文件和本地改动会按需显露其他路径，切换文档不会因为引用关系改变目录内容。
- 侧边栏分为 All、Favorites、Sync 三个视图：All 是普通仓库目录树，Favorites 集中显示收藏的目录和 Markdown／MDX 文档，Sync 同时显示尚未发布的本地改动与最近一次检查到的远端状态。
- 收藏按仓库保存，并由同一仓库的所有 worktree 共享；目录和 Markdown／MDX 文档可以从文件树右键菜单收藏，当前文档也可以通过正文旁的星标收藏。
- Markdown／MDX 支持 Preview、Source、Live；图片、PDF、CSV、JSON、YAML、HTML、文本代码和其他附件按能力只读预览或交给系统应用打开。
- 文档 Tab、滚动和焦点按 worktree 保存，All 与 Favorites 分别保存目录展开状态；每次进入 Sync 都会自动展开所有包含未发布文件的目录链。Tab 切换不会擅自滚动目录树，用户可以显式执行“在左侧目录中显示”。
- 前进／后退只操作当前 Tab 自己的文档历史：普通内部文档链接替换当前 Tab，Command／Ctrl 点击则在独立 Tab 打开，不改变当前 Tab。
- Preview 保留源文件行号，支持选择原始 Markdown 并复制仓库相对路径和行号范围。
- Preview、Source、Live 的行选区可以加入当前 worktree 的“Agent 上下文”；入口固定在文件树底部，浮窗向上覆盖目录树，支持跨文件定位、移除、清空并复制为通用 AI Agent 可用的 Markdown。
- Source 与 Live 基于同一个 CodeMirror 文本模型实时写回；Live 只增加阅读态视觉层，不创建第二份富文本数据。
- 支持受控 MDX-lite 组件，不执行任意 JSX、JavaScript、`import` 或文档脚本。
- 打开仓库时及之后每隔 10 分钟自动检查远端；工作区干净时自动快进更新。若本地也有尚未完成的编辑，可点击“合并远端修改”，只把远端版本合入本地，全部本地编辑仍保持未提交。
- 发布保持人工触发：“同步并发布”一次提交并推送当前仓库的全部本地改动，不要求选择文件或填写 Git 提交说明；分叉、冲突和进行中的 Git 操作会安全停止，只有无法自动处理时才提供 AI Agent 提示词。
- “复制分享链接”会把主工作目录 `main` 中尚未发布的改动完整提交、推送并复核 `origin/main`，成功后才复制版本化链接；失败会保留本地内容并提供发布重试。链接不携带正文、本机路径或 `ai_snippet`。
- 全屏“设置与帮助”页面集中管理界面语言、明暗模式、文档字体、文档字号和目录树内容，并展示帮助、快捷键、版本、环境与仓库状态。界面语言默认跟随系统，也可以固定为英语或简体中文。

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
