---
last_updated: 2026-07-17
---

# AGENTS.md - Git Leaf

本仓库是 Git Leaf 的独立代码仓库，用于开发本地 Markdown / MDX 文档工作台。
Git Leaf 可以打开任意本机 Git 仓库；目标仓库来自用户选择，不区分公司仓库或第三方仓库。
Git Leaf 代码、桌面壳、Web 工作台、测试和打包配置都维护在本仓库。

## 本文件定位

- 本文件只维护 Agent 进入仓库后必须知道的阅读路由、安全红线、验证门槛和交付流程。
- 用户可见的产品能力与使用方式写入 `README.md`；跨模块设计和长期行为协议写入 `architecture.md`；具体回归场景、
  fixture 和验收细节写入对应测试或脚本。
- 不在本文件逐项维护功能清单、单个功能的交互说明、一次性 Bug 根因或设计讨论历史。

## 先读哪里

- 普通改动前先读本文件，再按改动范围阅读最近相关源文件和测试。
- 产品能力、使用方式和边界见 `README.md`。
- 产品传播定位、开源推广和未来 Agent 推广方向见 `marketing/README.md`。
- 架构、服务边界、worktree、本机编辑和桌面封装见 `architecture.md`。
- MDX-lite 渲染器实现和组件边界见 `mdx-lite-guide.md`；完整开发效果和视觉回归样例见
  `mdx-lite-components-demo.mdx`。
- Windows unsigned Preview 的安装和启动说明见 `windows-portable-guide.md`。
- 正式桌面版使用统计的事件语义、数据项、逻辑关系、指标公式、隐私边界、JSONL 存储和禁止推断项都以
  `docs/app-usage-analytics-spec.md` 为唯一口径。
- 发布流程见 `release.md`；`AGENTS.md` 不维护完整发布 SOP。

## 目录

- `src/`: Node 本地服务、仓库发现、Markdown/MDX 渲染、Git 同步和 CLI 入口。
- `src/client/`: CodeMirror Source / Live 编辑器源码。
- `public/`: 浏览器工作台静态资源；`source-editor.bundle.js` 由 `src/client/source-editor.mjs` 构建生成。
- `desktop/`: Electron 主进程入口；桌面配置、home、导航和环境检查逻辑在 `src/desktop-*` 与
  `src/git-environment.mjs`。
- `assets/`: App 图标等打包资产；macOS 图标源在 `assets/icons/git-leaf.*`。
- `test/`: Node test runner 测试。
- `dist/`: 本地打包产物，不入库。

## 开发命令

```bash
npm test
npm run test:all
npm run test:ci:mac
npm run test:ci:win
npm run release:prepare
npm run release:status
npm run build:client
npm run docs:check
npm run telemetry:summary -- /path/to/gitleaf-telemetry/events --format markdown
npm run desktop -- --repo /path/to/docs-repo
node src/cli.mjs --no-open
node src/cli.mjs <repo-relative-path.md-or-mdx> --no-open
make smoke-dev-mac
make install-dev-mac
make package-mac
make package-win
```

修改 Git Leaf 核心代码后默认运行 `npm test`；它只跑跨平台 core 测试。
发布前完整本地回归运行 `npm run test:all`。
如果改了 `src/client/source-editor.mjs`，
还必须运行 `npm run build:client` 并提交生成的 `public/source-editor.bundle.js`。
如果改了 Preview / Live Editor、MDX-lite 组件、frontmatter 弹窗、行号或键盘焦点等
真实 UI 行为，除了 Node 测试，macOS 还要使用 `make smoke-dev-mac` 在隔离配置中打开实际文档做 smoke：
至少覆盖 Preview 与 Live 两种模式，并确认目标交互在真实 DOM 中可点击、可见、可滚动或可编辑。
如果改了 macOS 打包、签名、公证、本机安装或图标流程，至少运行
`npm run test:ci:mac`；需要验证本机 App 更新时再运行 `make install-dev-mac`。
`make install-dev-mac` 用于安装或替换开发版，并使用稳定、持久的开发配置供用户人工检查；它不是
自动化 UI smoke 的入口。开发版仍安装为 `Git Leaf.app`，但界面明确显示 `Git Leaf dev`，并且不会检查
正式版本更新。Agent 自动化验证必须使用 `make smoke-dev-mac` 的独立一次性快照，不能污染正式配置或人工检查环境。
这里隔离的是写入位置，不是用户的初始体验：稳定开发配置首次不存在时，必须从正式版当前配置完整初始化，继承仓库列表、
当前仓库、工作台会话、外观、字号和侧边栏状态；此后安装新版必须保留用户已在开发版中形成的熟悉状态，不得再次用正式
配置覆盖。Agent smoke 优先从稳定开发配置只读生成一次性副本；只有稳定开发配置尚不存在时才从正式配置初始化。已有开发
配置缺少有效标记、复制失败或指纹校验失败时，不得退回正式或空配置，应终止并保留两份持久配置不变。
正式发布流程以 `release.md` 为准；使用 `release:prepare` 创建冻结 commit 的独立 release worktree，
再通过 worktree 内的发布控制器完成构建、candidate、stable 和 tag。不要只靠 `make release-mac` 或
`make release-win` 完成正式 stable 发布。发布包必须排除 `test/`、`dist/`、`.git/` 等开发目录。
改 Windows 打包、portable zip 或发布门禁时运行 `npm run test:ci:win`。

## UI 回归诊断与完成门槛

- 用户通过视频、截图或已安装 App 报告真实 UI Bug 时，描述只作为线索。修改代码前必须先在隔离开发版中复现同一个可观察症状，
  并使用 Computer Use、真实 DOM 状态或针对性事件记录形成 Agent 自己的证据；不能只根据文字猜测事件来源。
- 先建立快速、确定性的反馈回路，再修改代码。优先记录目标组件的显示／隐藏、相关 DOM 是否被替换、跨 renderer／desktop／server
  的事件和调用来源；完整测试、打包和人工开发版安装是根因确认后的回归步骤，不用于代替诊断。
- 周期性 UI 问题的反馈回路必须覆盖多个完整周期；静止悬停、焦点或滚动问题默认连续观察至少 10 秒。用户反馈“仍然存在”时，
  当前诊断视为已被证伪，必须重新扩大调用链和模块范围，不能继续给原假设叠加 cooldown、延时或相邻补丁。
- 只有使用本次代码新打包的隔离 smoke 在原始复现场景中通过，才可以声称“已修复”。Node 测试全绿、源码正则断言、截图单帧或
  安装包包含代码都不是单独的完成证据。
- 具体问题的专用 smoke 命令、fixture 和验收文字维护在 `Makefile`、`scripts/` 与 `test/`，不在本文件按功能逐项累积。

## 回归测试准入

- 新增回归测试必须保护一个可说明的用户可观察行为、安全边界或有限契约，并从真实调用 seam 触发；测试名称和断言应表达行为结果，
  不能只证明实现代码、CSS、HTML 或文案仍保持某种形状。
- 负向断言只用于边界明确的输入空间，例如协议、路径、权限、白名单、隐私字段和安全状态；不得为“某个历史文件、旧函数、旧文案或
  旧样式不应再次出现”增加墓碑式测试。需要清理的历史实现直接删除，由代码评审和版本历史负责。
- 文档链接、格式和结构一致性属于 lint；发布清单、安装脚本、CSP、IPC 白名单等可执行配置本身属于产品契约，可以做静态门禁，
  但应断言有限的安全或交付结果，不逐句锁定说明文案。
- UI Bug 没有正确的自动化 seam 时，先改进 seam 或使用隔离 smoke 复现和验收；不得用读取源码后的正则断言代替真实 DOM、事件链或运行时验证。

## 开发配置安全红线

正式版 userData（macOS 默认为 `~/Library/Application Support/git-leaf`）是用户数据，不是测试夹具。

- Agent 的自动化、UI smoke、截图和脚本化点击不得使用正式 userData；macOS 统一运行
  `make smoke-dev-mac`。不得改用未隔离的 `npm run desktop`、`open /Applications/Git\ Leaf.app` 或
  `make install-dev-mac` 完成 smoke。
- 隔离启动日志必须明确显示本次临时 userData 路径；没有该证据就停止 smoke，不得尝试正式 App 作为替代。
- 开发过程中只读正式配置。除非用户明确要求修复或迁移其正式配置，否则不得写入、复制回或清理正式 userData。
- 人工检查环境首次从正式配置完整初始化，之后以稳定开发配置持续保留用户在开发版中的仓库、会话和偏好；“隔离配置”
  不得被实现为全新默认配置，也不得在重新安装时重置。自动 smoke 只操作该熟悉状态的一次性只读副本。
- 不得用默认值、当前规范化结果或记忆猜测并“恢复”用户配置。隔离 smoke 后直接清理临时配置；如果误触正式配置，
  立即停止相关进程并保留现场，先报告受影响文件和字段，只有取得用户明确授权且值有可靠来源时才修复。
- 配置 schema 迁移必须是幂等的，并保留旧版本已有的仓库列表、工作台会话、外观和其他无关配置值；
  解析失败不得按空配置继续写回。迁移测试必须使用临时 userData，同时覆盖旧版本夹具和全新安装两条路径。
- 需要验证真实旧配置迁移时，只能在临时目录中使用只读来源的副本；迁移和 UI 操作不得原地作用于正式配置。

## 文档链接输出

- 回复中需要提供 Git 仓库内 Markdown / MDX 文档的打开链接时，默认给可点击的 Git Leaf HTTPS 链接；
  不要只给本机绝对路径、`file://` 地址或 GitHub blob 链接。
- 链接统一通过 `scripts/generate-open-link.mjs` 生成，不要手工拼接仓库、路径或 worktree 参数：

```bash
node <git-leaf-repo>/scripts/generate-open-link.mjs \
  --repo-root "$(git rev-parse --show-toplevel)" \
  --file "<repo-relative.md-or-mdx>"
```

- 主工作目录生成的链接可以跨同事传递；linked worktree 链接只用于创建链接的同一台机器。
- 回复中的推荐文案为“在 Git Leaf 打开：<文档标题>”。只有用户明确要求 GitHub 源码链接，或无法生成
  Git Leaf 链接时，才改给 GitHub 链接并说明原因。
- 除非用户明确要求，不要因为生成了链接就主动启动 Git Leaf 或切换用户当前仓库。

## Git 工作流

- Git Leaf 日常开发不创建功能 PR；可以直接在主 checkout 开发，也可以按隔离、并行或任务需要使用额外 worktree。
- 在 worktree 中完成的改动通过相应检查后，直接合并回主 checkout 的 `main`，再 push `main`；不要以 PR 作为交付步骤。
- 如果 `origin/main` 已前进，先安全同步并解决冲突，再完成检查、合并和 push；不要停在仅有本地提交或等待用户再次确认 push。
- 只有用户明确要求 PR 流程时才创建 PR。

## 不可绕过的边界

- 用户可见能力以 `README.md` 为入口，跨模块行为与边界以 `architecture.md` 为准；不要在本文件复制功能清单或单次实现细节。
- 桌面和 CLI／Web 入口只绑定 localhost；任何改动都不得把仓库内容、编辑接口或本机路径暴露到局域网或公网。
- 目录树显示偏好不得改变 Git 文件发现、状态或同步范围；普通 Deep Link 和分享链接不得扩大到 Markdown／MDX 之外。
- Git Leaf 不自动改写分叉历史，不绕过冲突或进行中的 Git 操作，也不允许写入口绕过 Detached worktree 保护分支。
- 分享、更新、遥测和开发配置属于安全边界；修改前必须阅读对应架构或规范文档并补契约测试。

## 代码约束

- 优先保持现有 Node / Electron / CodeMirror / markdown-it 架构，不为小功能引入新框架。
- MDX 只支持白名单 MDX-lite 组件，不执行任意 JSX、import、script 或事件处理代码。
- 不要把目标内容仓库的事实复制进本仓；需要验证内容时，从用户指定的目标仓库读取源文件。
- 不要提交 `node_modules/`、`dist/`、本机绝对路径或一次性调试产物。
- 不要在 Detached HEAD 上直接写文件；所有写入口必须先经过保护分支创建边界。
- 改桌面仓库选择、desktop home、导航拦截或环境检查时，补对应 `desktop-*` 或
  `git-environment` 回归测试。
- 修改 worktree、本机编辑、仓库切换、Git 同步或 Source / Live 写回逻辑时，必须补回归测试。
