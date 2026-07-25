---
title: Git Leaf 系统架构
domain: ai
type: architecture
owner: maintainer
last_updated: 2026-07-24
source: git-leaf
canonical: true
ai_snippet: "[Architecture] Git Leaf | standalone desktop app | Git-native Markdown/MDX workbench | local HTTP server | Git worktrees | Preview Source Live | CodeMirror 6 | realtime sync"
change_log:
  - changed: 2026-07-24
    author: codex
    summary: 将发送端分享收敛为提交、推送、远端 revision 复核和复制链接的一次发布动作，并为发送失败及接收端 fetch 失败增加原地重试。
  - changed: 2026-07-19
    author: codex
    summary: 将 Git 同步收敛为显式的一键全量动作，增加工作区漂移保护、一次重试、明确 commit 发布与隐私安全统计。
  - changed: 2026-07-19
    author: codex
    summary: 清理已实施方案文档，补齐设置与帮助中心、文档入口和架构不变量的当前契约。
  - changed: 2026-07-17
    author: codex
    summary: 固化桌面偏好同步的单向与广播边界，避免工作台状态保存形成目录树重复渲染反馈环。
  - changed: 2026-07-16
    author: codex
    summary: 分享 URL 停止携带 ai_snippet，仅保留已发布文档标题；接收服务 继续兼容旧链接。
  - changed: 2026-07-14
    author: codex
    summary: 重构桌面更新状态机，分离版本发现与下载，持久化更新入口，并把安装放到 App 完成关闭之后。
  - changed: 2026-07-14
    author: codex
    summary: 分享链接增加基于已发布 revision 的 title 和 ai_snippet 聊天预览元数据。
  - changed: 2026-07-12
    author: codex
    summary: 加固全文件同步的分叉与冲突恢复，修复分享附件选择，并补充文件能力提示和系统打开入口。
  - changed: 2026-07-12
    author: codex
    summary: 文件树改为显示仓库全部文件，增加只读代码与不支持预览占位，并将 Git 同步扩展到全部文件类型。
  - changed: 2026-07-12
    author: codex
    summary: 增加主工作区 main 已发布文档的跨设备分享链接、revision 门禁和接收端安全更新流程。
  - changed: 2026-07-12
    author: codex
    summary: 加固 Windows 跨历史版本迁移，增加单实例门禁、启动确认、原子版本记录和可恢复切换。
  - changed: 2026-07-11
    author: codex
    summary: 增加 HTTPS 启动入口、stable 下载链接和本机 worktree 精确预览能力。
  - changed: 2026-07-10
    author: codex
    summary: 增加本机文档深链，并明确 Windows 固定用户目录和协议注册边界。
  - changed: 2026-07-10
    author: maintainer
    summary: 删除远程分享权限模型，支持本机多 worktree 切换和 Detached 自动保护分支。
  - changed: 2026-07-05
    author: maintainer
    summary: 将原编辑器方案升级为 Git Leaf 当前系统架构文档，明确独立桌面 App、运行模型、仓库边界、模式和写入契约。
---

# Git Leaf 系统架构

[Documentation index](README.md) | 简体中文

本文说明 Git Leaf 当前整体系统是什么、由哪些模块组成、哪些行为是架构契约。它不是使用手册，也不是
MDX-lite 组件语法说明。

- 使用方式、命令和当前能力清单见 [README.zh-CN.md](../README.zh-CN.md)。
- MDX-lite 的写法、数据格式和组件边界见
  [mdx-lite-guide.zh-CN.md](mdx-lite-guide.zh-CN.md)。
- 正式发布操作见 [release.md](release.md)；使用统计与隐私的唯一口径见
  [app-usage-analytics-spec.zh-CN.md](app-usage-analytics-spec.zh-CN.md)。

## 系统定位

Git Leaf 是面向 Git 仓库知识库的独立本地 Markdown / MDX 文档工作台。

它解决三个问题：

- 让非技术同事在桌面 App 或本机浏览器里阅读、搜索、定位和轻量编辑仓库文档；
- 让 AI Agent 能通过源文件路径、行号和原始 Markdown 精确理解用户选中的内容；
- 让用户在同一 Git 仓库的多个 worktree 之间切换，并清楚看到每个工作区所在分支。

Git Leaf 不把文档迁移到数据库、CMS 或云端服务。权威源文件始终是用户选择的 Git 仓库里的 `.md` / `.mdx`
文件；Git Leaf 只是这些文件的本地工作台。仓库中同时存在的图片、附件、代码和其他文件不会被隐藏，
但不因此把 Git Leaf 扩展成通用代码编辑器。

## 运行模型

Git Leaf 由一个 Node.js 本地 HTTP 服务、一个 Web 前端和一个 Electron 桌面壳组成。

桌面版是普通用户默认入口：

- 用户打开 App 后选择一个本机 Git 仓库目录；
- 选择结果保存到 Electron `userData` 配置目录；
- 正式构建使用正式 `userData`；开发构建和源码启动默认改用隔离的开发目录。`make install-dev-mac`
  首次从正式配置初始化稳定的人工开发 profile，后续安装只替换 App 并保留这个 profile；`make smoke-dev-mac`
  再从人工开发 profile 生成独立的一次性快照，二者都同时隔离 `userData` 与 `sessionData`；
- 人工开发 profile 采用“熟悉配置、隔离写入、持续保留”模型：首次完整继承正式版已有的仓库、工作台、外观和布局状态，
  开发版后续变更只写入该副本且不会在重新安装时被覆盖。人工 profile 尚不存在时，smoke 才直接以正式配置为基线；
  已有 profile 无有效标记、复制或双源指纹校验失败时终止，不允许回退到正式或空配置继续启动；
- 后续启动默认打开上次选择的仓库；
- 仓库不存在或不再是 Git 仓库时，重新提示用户选择；
- 桌面版服务默认监听 `127.0.0.1:4317`，不把编辑服务暴露到内网。

CLI / Web 入口主要服务本机开发和浏览器工作台：

- `npm start -- <file>` 从当前 Git 仓库启动 Git Leaf；
- 服务默认监听 `127.0.0.1:4317`，不向局域网暴露仓库内容；
- 浏览器前端从服务读取文件树、文档内容、渲染结果、Git 状态和仓库状态；
- 文件读写、Git 状态读取、图片资产写入和同步动作都在本机服务端执行；
- 前端不直接访问本机文件系统，也不暴露本机绝对路径给远程访问者。

同一个仓库已有 Git Leaf 服务运行时，新命令会复用已有进程，不重复启动。默认端口被占用时可以临时使用后续端口；
后续再次运行 CLI 入口时，服务会尽量回到 `4317`。

Git Leaf 适合长期运行。用户再次打开页面或 AI Agent 再次运行 CLI 入口时，服务会检查本地工具代码是否变化；
如果当前进程过期，会尽量先写回 Source / Live 中的待写内容，再软重启并刷新当前页面。

### 本机文档深链

桌面 App 注册 `git-leaf://`，供 AI Agent 和其他本机工具直接打开仓库文档：

```text
git-leaf://open
git-leaf://open?repo=<本机仓库绝对路径>&path=<仓库内 Markdown 或 MDX 相对路径>
git-leaf://open?repo=<GitHub owner/repo>&path=<仓库内 Markdown 或 MDX 相对路径>
git-leaf://open-worktree?repo=<GitHub owner/repo>&path=<相对路径>&worktree=<本机 worktree ID>
```

- 无参数的 `git-leaf://open` 只启动或聚焦 Git Leaf，不绑定任何仓库；
- 本机工具可以继续传本机仓库绝对路径；可分享链接使用小写 `owner/repo` 稳定身份，不暴露发送者的本机路径；
- Git Leaf 只在当前打开的仓库列表中按 GitHub `origin` 精确匹配稳定身份；匹配不到时提示用户先通过
  `Open Repository…` 打开并保留该仓库；
- `worktree` 是由本机 worktree 规范路径生成的 16 位 ID，不是分支名，也不暴露绝对路径；选中 worktree 后使用它当前实际 checkout 的分支或 Detached 状态；
- 不带 `worktree` 的链接是跨同事可传递的仓库级链接；带 `worktree` 的链接只用于创建链接的同一台机器；
- 指定的 worktree ID 不存在时必须明确失败，不允许静默回退到主目录或其他 worktree；
- worktree 精确链接使用独立的 `open-worktree` 协议入口；旧版 App 无法识别时会拒绝打开，不会忽略参数后误开主工作目录；
- 深链明确指定的文档优先于该仓库上次保存的活动 Tab；原有 Tab 保留，目标文档成为当前活动 Tab；
- `path` 必须是仓库内相对 `.md` / `.mdx` 路径；
- 路径在 URL 中必须进行百分号编码，不接受 `..` 越界或仓库外文件；
- 冷启动、已运行 App 的二次唤起和 macOS `open-url` 进入同一条打开仓库链路；
- Windows 包第一次运行时进入 `%LOCALAPPDATA%\GitLeaf\app` 的固定每用户位置，开始菜单与 `git-leaf://`
  始终指向该位置；`GIT_LEAF_PORTABLE=1` 仅保留无稳定深链承诺的开发模式；
- Windows 安装与更新使用单实例门禁、内部 staging、启动确认、原子版本记录和失败回滚，只有固定位置的新版成功创建主窗口后
  才提交切换并清理旧版；
- Windows 用户安装、更新、降级拦截和安全提示的操作说明只在
  [windows-portable-guide.md](windows-portable-guide.md) 维护，本文不复制完整流程。

### 桌面 App 更新状态机

macOS 与 Windows 使用同一套用户可见状态和意图边界：

- 启动、每小时、重新激活和休眠恢复只读取 `latest.json`，不得因此下载更新包；
- 发现新版本后，文件树左下角持续显示“新版本可用”和“更新”按钮；已发现版本写入本机配置，App 重启或临时离线时入口仍可恢复；
- 用户点击“更新”才持久化更新意图并开始下载、校验和准备；下载中退出时，下次启动继续尝试同一版本；
- 准备完成后显示“已准备好，退出后自动安装”和“立即重启”；普通退出与立即重启走同一条受控关闭链路；
- App 必须先保存窗口状态、关闭本地服务、销毁窗口并刷新遥测，再启动 Squirrel.Mac 或 Windows 更新进程，避免安装器与旧进程竞争；
- 下载、校验或准备失败时保留带版本号的“重试”入口，不把失败状态伪装成仍在下载；
- 新版成功启动并确认当前清单不再更新时，清除已发现版本、更新意图和旧版的“稍后／跳过”偏好；
- 开发版不读取或执行正式版更新意图，也不显示正式版更新入口。

本机协议不提供远程访问或权限模型。官方服务 上的
`https://gitleaf.mangofuture.com/open` 是仓库无关的 HTTPS 启动入口；需要定位文档时才附加
`repo=<owner/repo>&path=<relative.md>`。同一台机器上的精确预览可以再附加 `worktree=<id>`。
静态跳转页只把参数转换为本机深链，不读取仓库内容，也不保存本机路径。
跳转页不会按固定时间关闭，也不再用浏览器失焦或页面隐藏推断成功。官方服务 为每次打开生成短期有效的一次性 `handoff` ID；Git Leaf 完成目标仓库和文档打开后向固定确认接口提交该 ID，跳转页轮询到 `opened` 后才尝试自行关闭。APP 未启动、找不到仓库或文档打开失败时不会确认，页面继续保留；自动协议调用失败后，用户点击按钮仍复用同一个 handoff。目标仓库尚未出现在 Git Leaf 的本机仓库列表时，桌面端直接允许用户选择本机目录，核对 GitHub origin 和目标工作树后继续原链接，不要求用户退出当前流程再从菜单手工添加。桌面端把 `received`、`opened`、`confirmed`、`failed` 等事件写入用户数据目录的 `deep-link.log`，用于定位跨应用交接问题。浏览器只允许脚本关闭特定来源的标签页，因此确认成功但被 Safari、Chrome 等拦截时，页面保留明确的手动关闭提示。
浏览器不能直接判断本机是否已安装 Git Leaf，因此跳转页长期展示公开安装入口：macOS 指向
`releaseTrack=public` 的 stable `latest.json` 中的 DMG，Windows 指向对应的 ZIP；发布新版本后链接随清单
自动更新，不在页面中写死版本号。内部轨道制品即使为兼容旧客户端临时发布到 stable，也不得出现在公开下载页。
浏览器兼容验收以 macOS Chrome 为主、Safari 为辅；Windows 同时覆盖 Edge 和 Chrome。浏览器层只负责把同一个 `git-leaf://` URL 交给操作系统，文档优先级由 Git Leaf App 统一处理。

### 文档分享链接

页面右上角的“复制分享链接”使用独立的版本化协议：

```text
https://gitleaf.mangofuture.com/share?v=1&repo=<owner/repo>&path=<relative.md>&rev=<full-commit>&title=<title>
git-leaf://open-shared?v=1&repo=<owner/repo>&path=<relative.md>&rev=<full-commit>&handoff=<id>
```

- v1 只支持主 checkout 的 `main`，不分享 feature branch 或 linked worktree；
- `rev` 是最后一次修改当前文档、并且已经进入 `origin/main` 的完整 commit，是最低版本要求；接收端可以打开包含该 revision 的更新版 `main`，不会 checkout 到 Detached HEAD；
- 发送端从 `rev` 对应的文档内容读取预览标题，依次回退到 frontmatter `title`、首个一级标题和文件名；新生成的分享 URL 不读取或携带 `ai_snippet`；
- `title` 只附加在 HTTPS 分享链接中并限制为 100 个字符；转换后的 `git-leaf://open-shared` 不携带它；
- 接收服务 在 `/share` 首次响应中直接输出 `<title>`、description 和 Open Graph 元数据，让飞书等聊天客户端无需执行 JavaScript 或访问仓库即可生成卡片；新链接的 description 回退到仓库与文档路径，历史 `snippet` 参数仍按旧协议兼容；
- 发送端当前文档存在未提交或未发布修改时先询问用户；确认后执行全文件同步或重试已提交 main 的 push，重新 fetch 并确认目标 revision 已进入 `origin/main` 后才生成和复制链接；
- 分享发布失败时保留本地修改与已创建提交，明确显示失败原因并提供原地重试；不能把仅完成本地 commit 或仅收到 `git push` 成功退出当作分享完成；
- 接收端固定解析到主 checkout，不允许回退到当前 linked worktree；
- 当前位于同仓库 linked worktree 时，先明确询问是否“切换并打开”，取消或 `Esc` 不改变工作区；
- 本地 `main` 落后且干净时只允许 fast-forward；存在不重叠修改时经用户确认后保留修改并 fast-forward；
- 存在重叠本地修改时，经用户确认复用一键全文件 Git 同步；同步先 fetch，必要时再 commit、rebase 远端分支、push；
- 获取 `origin/main` 遇到瞬时网络中断时自动重试一次；仍失败时按网络、Git 凭据、本机 Git 可用性或权限给出
  可操作提示，并允许在当前对话框中重新尝试。获取失败不得使用可能过期的远端跟踪分支继续打开；
- 同步覆盖 Git 状态中的全部文件类型，包括图片、附件、代码和删除；不会自动 stash 或缩窄成仅当前 Markdown；
- 从分享失败提示确认后直接执行“同步并复制”或“发布并复制”，不再进入文件选择或提交说明面板；动作成功时分享链接已经写入剪贴板；
- 只有正确工作区、`main`、revision 和目标文档全部打开后才确认 handoff。

以下情况必须停止并解释原因，不得静默改动 Git 状态：目标仓库当前未打开、主 checkout 不在
`main`、`origin/main` 不包含分享 revision、本地 `main` ahead 或 diverged、目标文档不存在，以及
同步过程中出现冲突或工作区持续变化。接收服务 不访问 GitHub 或读取仓库正文，只转换链接、渲染链接中有长度上限的
标题与摘要元数据，并记录安全的 handoff 状态；分享链接不会授予 GitHub 权限。

正式桌面版还通过 官方服务 的 `/telemetry/v1/events` 上传基础使用统计。客户端只发送低频安装／更新生命周期事件和本机形成的
每日累计快照；逐次功能操作、操作顺序和仓库身份都不会上传。Renderer 只能向当前 localhost 工作台提交白名单计数，真正的
安装 ID、队列、版本和外网上传由 Electron 主进程管理。CLI、普通 Web、开发包和测试包不启用这个处理器。官方服务 将通过
schema 校验的事件按 UTC 日期追加为 JSONL；JSONL 是唯一事实源，需要时由脚本按 `event_id` 去重，并为同一
`summary_id` 选择最高 `revision`。每日累计快照用 `summary_date` 表示业务归属日，事件信封的 `local_date` 仍表示进入队列的发生日；
历史缺字段记录只能通过确定性的 `summary_id` 公式恢复。完整事件口径、逻辑关系、隐私、传输、存储和保留边界见
`docs/app-usage-analytics-spec.zh-CN.md`。

正式 App 打开即形成当日 DAU；时长或白名单功能动作形成独立的深度活跃口径。启动后约 2 秒尝试上传包含启动计数的最新累计快照，
运行期间仅在累计值变化时每分钟生成新 revision，正常退出再执行最长 1.5 秒的补传。所有网络操作仍为 best effort；失败或超时保留
本地队列，不阻塞正常功能，也不把逐分钟心跳或逐次动作发送到 接收服务。

AI Agent 不应自行拼接 worktree ID。Git Leaf 提供统一生成工具；从目标仓库或 worktree 执行：

```bash
node <git-leaf-repo>/scripts/generate-open-link.mjs \
  --repo-root "$(git rev-parse --show-toplevel)" \
  --file "<repo-relative.md>"
```

主工作目录生成的链接不带 `worktree`，可以跨同事传递；linked worktree 自动附加本机 ID，保证点击后回到同一个工作现场。

## 仓库模型

Git Leaf 的主仓库来自用户选择的本机 Git 仓库目录。

- 桌面版通过菜单或首次启动弹窗选择仓库；
- 启动参数 `--repo <path>` 可以显式指定仓库；
- CLI 入口从当前工作目录向上定位 Git 仓库根目录；
- 当前仓库可以是主工作目录或 linked worktree；
- 桌面版可以打开任意本机 Git 内容仓库，不要求 Git Leaf 代码放在内容仓库内部。

仓库没有可恢复的工作台会话且调用方未指定文档时，默认文档依次选择仓库根目录的 `AGENTS.md`、`README.md`
和 `CONTEXT.md`；都不存在时进入空工作台。这个顺序只决定首次内容入口，不改变文档权威性。

每个本地服务进程只维护当前打开的一个 worktree：

- 桌面版可以打开任意本机 Git 仓库，不再内置任何兄弟仓库列表；
- 用户切换仓库或 worktree 时，桌面壳关闭旧服务并为新工作目录启动本地服务；
- 关闭旧服务、启动新服务和恢复工作台期间始终显示与当前主题一致的仓库过渡页；仓库选择首页和未初始化的工作台骨架
  不属于切换过程，不应短暂暴露；
- 本机用户选择仓库后，桌面壳把选择写入 Electron `userData` 配置目录；
- 同一 Git 仓库的 worktree 优先通过 `git worktree list --porcelain -z` 发现；旧版 Git 不支持
  `-z` 时回退到 `git worktree list --porcelain`，不把命令能力差异误报成仓库目录错误。

### 外部命令状态契约

Git、GitHub CLI 和系统辅助命令都是运行时外部依赖。仓库、worktree、同步和分享路径通过统一命令入口调用
Git／GitHub CLI；其他系统辅助命令接入时遵循同一契约。Git Leaf 不根据版本号猜测参数是否可用，而是结合
进程启动结果、调用目录、退出码、signal、标准错误和成功输出的格式，把调用归入以下状态：

| 状态 | 含义 | 处理 |
| --- | --- | --- |
| `ok` | 命令成功，且输出符合当前调用的格式契约 | 继续当前流程 |
| `unavailable` | 命令不存在，或桌面进程的 PATH 找不到命令 | 停止依赖该命令的操作；环境页提示检查安装和 PATH |
| `permission_denied` | 命令不可执行、仓库不可读，或 Git 拒绝不安全的目录所有权 | 停止操作；提示检查命令和目录权限 |
| `unsupported` | 命令存在，但明确报告未知参数、子命令或不支持的能力 | 有经过测试的兼容路径时回退；否则只停止当前操作 |
| `invalid_context` | 调用目录不是 Git 仓库或工作区 | 仓库选择时显示“这个目录不在 Git 仓库中”，不展示命令 usage |
| `authentication_required` | 远端或 GitHub CLI 需要登录，或凭据验证失败 | 保留本地能力；停止需要远端身份的操作并提示检查凭据 |
| `network_unavailable` | DNS、连接、代理或 TLS 导致远端不可达 | 保留本地能力；停止当前远端操作并允许重试 |
| `interrupted` | 命令被 signal、取消或超时中断 | 停止当前操作，不把部分结果当成成功；允许重试 |
| `invalid_output` | 进程退出成功，但输出为空、格式错误或违反调用方契约 | 视为依赖异常并停止，不继续解析或修改仓库 |
| `failed` | 其余命令失败，包括仓库损坏和具体 Git 操作失败 | 保留简短技术信息，由当前功能决定恢复或交给 AI Agent |

非零退出码只有被具体命令定义为正常分支时才能降级。例如 `merge-base --is-ancestor` 的退出码 1 表示
“不是祖先”，`rev-parse -q --verify` 的退出码 1 表示 ref 不存在；其他异常必须继续上抛。
允许降级的可选信息也要在调用点明确声明，例如分享链接的标题预览读取失败可以退回文件名。

`git worktree list -z` 是 `unsupported` 的一个兼容实例：先尝试无歧义的 NUL 输出，只有 Git 明确报告
未知参数时才回退到旧版换行格式；退出码 129 但没有未知参数证据时不回退。环境页的版本展示、仓库根目录、
worktree 列表和 common dir 等关键输出都必须先验证格式，不能把“退出码 0”直接等同于结果有效。

编辑能力只开放给 localhost 访问者，正常分支不区分 `main` 或功能分支。Linked worktree 和主工作目录
具有相同的 Preview、Source、Live 和同步能力。

Detached worktree 可以阅读和进入编辑模式，但第一次实际写入前，服务端必须先创建形如
`git-leaf/detached-<commit>-<timestamp>` 的本地保护分支。保护分支创建失败时，本次写入失败，源文件保持不变。

桌面端的多仓库列表采用稳定的首次打开顺序：已有仓库切换时不重排，新仓库追加到末尾，关闭仓库后再次添加才作为新项进入末尾。
File 菜单和仓库快捷键共享该顺序，`Command+Option+1..9` 直达对应仓库，`Command+Option+Left/Right` 按该顺序循环切换。
关闭当前仓库时，如果固定列表仍有其他仓库，则优先打开原位置右侧的相邻项；关闭末项时回到左侧相邻项。只有关闭最后一个仓库
才进入仓库选择首页。

## Worktree 模型

仓库名称是稳定的顶层身份，worktree 是仓库内部的工作目录：

- 顶部标题栏继续显示仓库名称；
- 只有存在多个可用 worktree 时，侧边栏顶部才显示当前 worktree 目录名和分支名；
- 只有主工作目录时隐藏 worktree 选择器，不向普通用户暴露多余的 Git 概念；
- 下拉列表显示同一仓库的全部可用 worktree、分支和规范路径；
- Detached worktree 显示短 commit，并在首次写入后刷新为自动创建的保护分支；
- 每个 worktree 以规范路径派生的稳定 ID 保存独立 Tab、目录展开、滚动和焦点状态；默认目录树与“本地改动”
  视图分别保存目录展开状态，首次进入“本地改动”时自动展开全部匹配目录，之后只恢复该视图内的手动展开或折叠。

Tab 和目录树遵循稳定视野约束：切换 Tab 只更新当前文档和目录树中的活动标记，不自动展开目录、滚动目录树或抢占目录树焦点。
只有用户明确执行“在左侧目录中显示”时，才展开目标文件的父目录，并用 `nearest` 的最小位移让目标进入可视区域。Tab 右键菜单
始终作用于被右键的 Tab，不因打开菜单而切换正文；拖动只改变当前 worktree 会话内的 Tab 顺序，“关闭右侧标签页”按拖动后的视觉顺序计算。

Git Leaf 不提供分享 token、远程只读页面、SSO、账号系统或公网部署。浏览器 URL 只携带当前仓库和文档定位信息。

## 界面结构

Git Leaf 前端由四个稳定区域组成：

- 顶部栏：稳定显示当前仓库、文档 Tab、模式切换和文档动作；
- 左侧文件树：顶部切换 worktree，下面列出当前工作目录内文件并支持搜索和 frontmatter 筛选，底部固定“Agent 上下文”入口；
- 文档内导航：根据当前文档标题生成 outline，和正文滚动位置联动；
- 正文区域：根据模式显示 Preview、Source 或 Live。

短时操作反馈使用固定 toast，定位在标题栏下方并高于正文层级；不能被标题栏、滚动容器或正文内容遮挡。

左侧文件树、文档内导航和正文区域各自滚动，避免刷新或局部滚动时造成整页抖动。
文档内导航可以通过界面按钮或 `Command/Ctrl+Shift+B` 整体收起，状态作为自动恢复的布局偏好保存；它不是设置中心中的配置项。

“Agent 上下文”点击后在目录树位置向上展开临时浮窗，不改变正文宽度，也不占用新的右侧栏。焦点移出浮窗、点击浮窗外或按 `Esc`
时立即收起，只保留侧边栏底部入口和片段数量。浮窗中的 Basket 按当前仓库和 worktree 隔离，仅在当前窗口会话中保存；它记录
捕获时的仓库相对路径、源行号、原始 Markdown、分支和 revision，不长期沉淀仓库正文。复制结果使用通用 Markdown，不绑定
任何特定 AI Agent 产品。

新建文档只创建 Markdown 或 MDX，创建位置由入口上下文决定：目录右键在该目录创建，文件右键或顶部 `+` 与当前文件放在一起，
空工作台在仓库根目录创建。界面不要求普通用户选择或修改原始路径；服务端自动补扩展名、拒绝仓库外路径和同名覆盖。创建成功后，
文档在前台新 Tab 中以 Live 模式打开。文件树、Tab 和当前文档的操作菜单使用同一组面向内容工作的名称，但只展示该上下文真正适用的动作。

### 文件能力分层

服务端始终发现并返回 Git 已跟踪文件和未被 `.gitignore` 忽略的本地文件。左侧目录树只在渲染层应用全局个人偏好：

- “内容文件”默认显示 Markdown／MDX、HTML、图片和 PDF；HTML 作为原型、副文本输出和报表，与 PDF 一样属于常驻内容；
- “全部仓库文件”显示服务端返回的完整文件树；
- CSV、JSON、YAML、纯文本、代码、配置和未知类型默认隐藏；文件搜索、当前打开文件和“仅本地改动”可以临时显露这些路径，当前文档的引用关系不改变目录内容；
- Frontmatter 筛选启用时只保留匹配的 Markdown／MDX 文档；清除筛选后恢复当前目录树内容模式。

目录树内容偏好只改变呈现，不改变 Git 文件发现、状态统计、同步或提交范围，也不在侧边栏增加常驻模式切换器或隐藏文件计数。

- `.md` / `.mdx`：Preview、Source、Live，可编辑；
- 图片（AVIF、BMP、PNG、JPEG、GIF、WebP、SVG）、PDF、CSV、JSON、YAML、HTML 和纯文本：按现有查看器只读预览；
- 代码、配置和其他可识别 UTF-8 文本：只读代码预览，不提供编辑模式；
- 未知扩展名在目录树标为“检测”，打开时再判断为 UTF-8 只读文本或不支持预览；
- 其他二进制文件、符号链接和 Git submodule：仍显示并可打开 Tab，正文显示“此文件类型暂时不支持预览”，并直接提供“使用系统应用打开”；
- 普通 Deep Link、分享链接和行级定位仍只接受 Markdown / MDX，不因文件树扩展而扩大协议范围。

Git 文件列表以 `git ls-files` 为准。只有路径确实不在 Git 仓库中时才允许文件系统回退；Git 缺失、索引损坏或
其他仓库异常必须明确失败，不能静默显示 `.gitignore` 已忽略的另一套文件集合。

## 模式契约

Git Leaf 只有三个文档模式：`Preview`、`Source`、`Live`。模式名称在 UI 中保持英文。

### Preview

Preview 是阅读模式：

- 渲染 Markdown 和受控 MDX-lite；
- 自动刷新外部文件变化；
- 支持源行号显示、行选择、URL hash 定位和复制内容；

Preview 是 Git Leaf 的最稳定模式。涉及渲染、行号定位或阅读体验的改动，不能让 Preview 退化。

### Source

Source 是源码编辑模式：

- 使用 CodeMirror 6 编辑当前 `.md` / `.mdx` 源文本；
- 展示原始 Markdown / MDX；
- 和 Preview 共享同一套文件读取、写入、行号和定位模型；
- 采用实时写回磁盘，不提供保存按钮。

Source 适合需要精确控制 Markdown 源文本的编辑场景。

### Live

Live 是源码上的阅读态视觉层，不是第二套富文本存储模型：

- 底座仍然是同一个 CodeMirror 6 文本模型；
- 当前光标所在行或块保持源码态，方便编辑；
- 非当前编辑内容按阅读态显示部分 Markdown 语法；
- 表格、图片、链接和受控 MDX-lite 块可以在非编辑状态显示预览或工具栏；
- 标准 Markdown 图片、单行 HTML `<img>`、表格内图片与安全图片组共用 Preview 渲染器；任意原始 HTML 仍保持关闭；
- 所有修改最终仍写回原始 Markdown / MDX 源文件。

Live 的目标是降低非技术同事编辑 Markdown 的摩擦，而不是完整复制 Obsidian、Notion 或富文本编辑器。

## 写入与刷新

Source / Live 采用 realtime sync：

- 用户输入后通过短 debounce 写回当前仓库内文件；
- 没有保存按钮，也不维护长期独立草稿副本；
- Git Leaf 自己写盘产生的 watcher 事件按内容状态忽略，避免反复 reload；
- VSCode、AI Agent、Git 或其他进程改动当前文件后，Git Leaf 加载磁盘最新内容；
- 极端竞态下，尚未落盘的瞬时输入允许丢失，换取系统行为简单、可预期。

Git 冲突不是 Git Leaf 内的冲突。文件里出现 conflict markers 时，Source / Live 按普通文本展示；
如何解决冲突交给 Git、用户和 AI Agent。

## 渲染与定位

Git Leaf 渲染层需要同时服务人类阅读和 AI Agent 定位：

- Markdown 渲染使用 `markdown-it`；
- 受控 MDX-lite 在渲染前由 Git Leaf 自己解析为静态 HTML / SVG；
- 渲染块保留源文件行号；
- 行选择基于源文件行，不基于浏览器自动换行后的视觉行；
- 复制内容必须包含仓库相对路径、行号范围和原始 Markdown；
- Preview、Source、Live 共用同一套行选择和 Agent 上下文捕获语义；同一路径与行范围再次加入时更新已捕获内容，不重复堆叠；
- URL hash 使用 GitHub 风格的 `#L34-L42`，打开后应恢复高亮并滚动到目标行。

MDX-lite 在这里是渲染能力，不是任意 MDX runtime。具体组件、属性和数据格式只在
[mdx-lite-guide.zh-CN.md](mdx-lite-guide.zh-CN.md) 里维护，本文不重复列出。

## 编辑交互

Git Leaf 的编辑交互遵循“源文本仍可解释”的原则：

- Slash menu 只插入可读、可维护的 Markdown / MDX-lite 模板；
- `ai_snippet` 由 AI Agent 总结，不作为人工 slash 项；
- 在 `.md` 文件里插入 MDX-lite 前，先提示并确认改名为 `.mdx`；
- 粘贴 PNG、JPEG、GIF、WebP 或 AVIF 时写入当前文档旁的 `_assets/` 目录，并插入单行 HTML `<img>`；
- 图片和链接在 Live 中可以被选中并显示轻量工具栏，而不是立即落入源码编辑状态；
- 所有弹窗和确认 UI 使用应用内组件，不使用浏览器原生 `prompt` / `confirm`。

## Git 同步

Git Leaf 可以帮助非技术同事把本地仓库改动交给 Git 流程，但不替代 Git。

- 文件树显示全部文件类型的本地改动状态；
- 工具栏只提供显式的“同步”：一次处理 Git 状态中的全部改动，包括图片、附件、代码、重命名和删除；不要求用户选择文件或填写 commit message；
- 点击后只显示“正在同步…”进度；成功只提示“同步完成”，内部 fetch、重试和 commit 状态不作为需要用户理解的常驻状态；
- 有 upstream 时先 fetch 并比较本地与远端；远端未领先时提交后直接 push，仅落后时提交后 rebase 远端再 push；
- 本地和远端同时存在独有提交时视为分叉，在暂存前停止并交给 AI Agent，不自动改写本地提交；
- fetch 前记录 HEAD 和本次全部改动的内容指纹，暂存前再次检查；发生变化时重新准备一次，连续变化则不提交并请用户稍后重试；
- `git add` 后从 index 创建 commit，不再让 commit 命令重新读取活动 worktree；提交后如果出现新改动，允许在远端未领先时只推送已冻结的 commit，但禁止在脏 worktree 上自动 rebase；
- push 使用已经校验的 commit OID，而不是执行时再次解析可变化的 `HEAD`；首次发布分支后再显式建立 upstream；
- push 后重新 fetch 目标分支，并以 ancestry 检查确认远端分支实际包含已提交 revision；远端复核失败时同步和分享都不得报告成功；
- 仓库已有冲突、merge、rebase、cherry-pick 或 revert 时不开始同步；自动 rebase 失败后先尝试 `rebase --abort`，避免把仓库留在中间状态；
- 遇到冲突、检查失败或推送失败时，界面生成可复制的 AI Agent 提示词；
- 复杂判断交给用户选择的 AI Agent，而不是让 Git Leaf 在 UI 里自由决策。

`scripts/git-sync-snapshot-prototype.mjs` 只验证临时 index、`commit-tree` 和 `merge-tree` 的对象层快照能力，不接入正式同步。
它证明无需临时 worktree 也能冻结点击时内容，但完整发布器还必须解决“远端已经发布、活动分支／index 仍由用户或其他工具
继续修改”时的本地状态对齐；在真实统计证明并发漂移值得承担该复杂性前，正式路径保持上述 guarded live worktree 策略。

同步能力是工作台的一层辅助流程，不是第四个文档模式。

## 设置与帮助中心

设置与帮助中心是覆盖主窗口内容区的全屏二级页面，由 Electron 桌面壳持有，不依赖当前仓库服务存在。它包含五个栏目：

- 外观：界面语言、明暗模式、文档字体和文档字号；
- 文件与目录：目录树内容模式；
- 使用帮助：复用工作台的帮助数据和文件类型说明；左侧显示章节导航，右侧以一个连续文档呈现段落和文件类型表格；
- 快捷键：复用统一快捷键数据源，只读展示；
- 关于与状态：版本、更新、Git 环境、当前仓库、worktree、分支、文件数量和 Front Matter 规则状态。

当前只开放五个可配置偏好：`language`、`colorMode`、`documentFont`、`documentFontSize` 和 `fileTreeMode`。
`language` 只持久化 `system`、`en` 或 `zh-CN`；默认 `system` 按操作系统语言优先级选择英语或简体中文，
不支持的系统语言回退英语，派生出的生效语言不写回配置。它们都是
全局个人偏好；Tab、目录展开、滚动、焦点、侧边栏、文档内导航和分屏比例属于自动恢复的工作现场，Front Matter
字段属于仓库共享规则，版本、依赖和文件数量属于只读状态，三者都不进入普通设置。

macOS 使用 `Settings…`／`Command+,` 进入外观，Help 菜单使用 `Git Leaf Help…` 进入使用帮助，`Command+/`
直达快捷键；返回按钮或 `Esc` 关闭二级页面并恢复原工作台焦点。没有打开仓库时仍可使用外观、帮助、快捷键和 App 状态，
仓库状态显示为空。设置页面禁止任意导航，只允许受限 IPC 和明确的外部链接协议。

当前页面结构和偏好白名单由本节、`desktop/settings-center.mjs`、`desktop/settings/`、
`public/settings-preferences.js` 及其测试共同约束，不维护第二份功能规范。

## 桌面偏好同步

桌面偏好同时服务于工作台、Settings 和 Desktop Home，但持久化成功不等于每个视图都需要收到广播：

- 工作台 renderer 通过本地服务保存偏好时，桌面主进程更新持久化状态和当前 server 快照，但不把结果回声给同一个 renderer；
- Settings、Desktop Home 或其他桌面视图修改偏好时，主进程可以向工作台广播已规范化并持久化的完整结果；
- 工作台收到广播后增量应用外观。颜色模式、字体和字号不得重建目录树；只有 `fileTreeMode` 实际变化时才允许执行一次
  `renderTree()`；生效语言变化时先完成当前编辑保存和工作现场持久化，再安全重载工作台，以统一替换静态、动态和
  可访问性文案；
- 目录树重建后的焦点和 viewport 恢复属于状态恢复，不得再次保存未变化的 workbench session；
- 任一链路都不得形成“渲染 → 保存会话 → 保存偏好 → 广播 → 再渲染”的反馈环。偏好同步测试必须同时覆盖来源 renderer
  不回声、跨视图广播一次、非目录偏好不重建和目录模式变化只重建一次。

这组约束属于桌面壳与工作台之间的协议。浮窗、焦点或滚动出现固定周期异常时，应先检查整个目录树是否被后台事件替换，
再检查组件自己的 pointer／scroll 处理。

## 模块边界

主要源码分布：

| 模块 | 责任 |
| --- | --- |
| `desktop/main.mjs` | Electron 窗口、精简菜单、仓库选择、设置入口和桌面启动流程 |
| `desktop/preference-sync.mjs` | 桌面偏好持久化、server 快照更新与 renderer 广播的可测试同步边界 |
| `desktop/settings-center.mjs`、`desktop/settings/` | 全屏设置与帮助中心、受限 IPC、页面导航和偏好交互 |
| `src/desktop-config.mjs` | 桌面仓库、窗口、工作台状态和全局个人偏好的串行、原子持久化；保留最近有效备份，损坏且无法恢复时拒绝覆盖 |
| `src/desktop-user-data.mjs` | 正式、人工开发检查和 Agent smoke 三类配置目录的隔离边界 |
| `src/desktop-server.mjs` | 桌面版本机服务启动和端口回退 |
| `src/cli.mjs` | CLI 入口、端口复用、服务启动 |
| `src/server.mjs` | localhost HTTP API、文档读写、Git Leaf 页面服务 |
| `src/repositories.mjs` | 当前仓库和 worktree 元数据、分支状态、读写能力判断 |
| `src/external-command.mjs` | 外部命令执行、调用目录校验、状态分类、预期退出码与成功输出异常 |
| `src/git-worktrees.mjs` | worktree 列表解析、稳定 ID 和 Detached 保护分支 |
| `src/git-leaf-open-link.mjs` | 本机打开链接与发送端分享资格检查、链接生成 |
| `src/git-share-publish.mjs` | 发送端分享的全文件同步、已提交 main 重试发布与链接生成编排 |
| `src/git-share-open.mjs` | 接收端主 checkout 解析、revision 与本地 Git 状态判断 |
| `src/desktop-deep-link.mjs` | 本机 Deep Link 和跨设备 Share Link 协议解析 |
| `src/markdown.mjs` | Markdown 渲染、链接和图片路径处理、源行号绑定 |
| `src/mdx-lite.mjs` | 受控 MDX-lite 解析与静态渲染 |
| `src/client/source-editor.mjs` | Source / Live CodeMirror 编辑器、实时写回、编辑交互 |
| `src/git-sync.mjs` | 全文件 Git 同步流程和失败提示词 |
| `src/frontmatter-facets.mjs` | frontmatter 筛选数据 |
| `src/table-complexity.mjs` | 表格复杂度策略 |
| `src/table-layout.mjs` | 表格自动布局策略 |
| `src/tool-version.mjs` | 长期运行进程的工具版本检测和软重启依据 |

模块边界的核心要求是：渲染、编辑、仓库权限、桌面壳和 Git 同步不要互相偷职责。

## 非目标

Git Leaf 当前不做：

- 多用户协同编辑；
- 云端账户、SSO、权限系统或公网文档站；
- 任意 MDX runtime、任意 JSX 或文档内脚本执行；
- 复杂 BI、地图、钻取、关系网络或多页面报表；
- 完整 Obsidian 插件生态；
- 替代 Git 分支、提交、review 和冲突处理流程。

## 架构不变量

以下约束不能通过局部 UI 改动或普通设置绕过：

- MDX-lite 组件细节只在 [mdx-lite-guide.zh-CN.md](mdx-lite-guide.zh-CN.md) 维护，不复制进本文；
- 不为 Live 引入第二套富文本存储模型；
- 不重新引入远程分享或 token 权限模型；
- 不限制正常功能分支的编辑能力；
- 不允许任何写入口绕过 Detached 保护分支；
- 不把表格、图片、链接或 MDX-lite 的局部交互做成无法从源文本解释的私有状态。

Agent 的阅读顺序、测试命令、开发配置安全和交付流程只在 [AGENTS.md](../AGENTS.md) 维护，本文不复制执行说明。
