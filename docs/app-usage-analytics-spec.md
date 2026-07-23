---
last_updated: 2026-07-22
status: normative
---

# Git Leaf App 使用统计规范

## 文档权威性

本文是 Git Leaf 正式桌面版使用统计的唯一口径文档，明确：

- 允许记录的事件和统计数据项；
- 事件的真实产品语义；
- 事件之间可验证的逻辑关系、连接键和先后顺序；
- 标准报表、数据质量门禁和禁止推断项；
- 客户端、官方服务、汇总脚本和日常分析必须共同遵守的变更流程。

本文同时定义采集、隐私、传输、存储和保留边界，不再维护第二份统计方案文档。代码实现、自动化测试、heartbeat 和临时分析
不得自行发明本文之外的统计口径。

新增或修改事件、属性、枚举、逻辑关系或指标时，必须先更新本文，再同步修改客户端校验、服务端校验、汇总脚本和测试。原始数据无法
支持的指标必须明确标为“不可计算”，不得用相邻指标替代。

设计原则是优先保证新能力边界之后的数据可验证、可重复且语义准确，不以最大化历史数据利用率为目标。旧数据语义或字段能力不充分时，
宁可输出 `N/A`／`legacy_unknown` 并保留原始绝对事实，也不得回填语义、近似替代或让旧记录冒充新契约结果。

## 适用范围

- 仅适用于正式打包、`stable` channel、非开发构建的 macOS 与 Windows 桌面 App。
- 不适用于本地开发版、CI 包、CLI、纯 Web 入口或测试注入事件。
- 原始事实源是 官方服务 的 `events/` 和 `downloads/` JSONL／JSONL.GZ。
- 本文只定义产品使用统计，不用于员工绩效、用户画像、广告归因或内容分析。
- 不得为增强统计而上传仓库、文档、搜索词、Git 数据或用户身份。

## 采集、隐私与存储边界

### 客户端标识与本地计算

- App 第一次正式启动时生成随机 UUID `install_id`，保存在 Electron `userData` 的遥测状态中；App 更新不改变该 ID，删除用户数据后
  会生成新的 ID。同一台电脑的不同系统用户拥有不同的 `userData`，因此属于不同安装实例。
- 设备名称只允许出现在 `git_leaf.installation.observed` 的低频事件中，可缺省；它不参与去重、关联或唯一性判断，也不得复制到每日
  汇总或更新事件。
- 客户端生成随机 `repo_secret`，使用
  `repo_local_key = HMAC-SHA256(repo_secret, canonical_git_common_dir)` 在本机计算不同仓库数。服务器不得收到
  `repo_local_key`、仓库路径、remote 或 Git common dir。
- 启动、活跃分钟、仓库数量、模式分钟和功能动作只在本地按日累计；服务器只接收每日汇总，不接收逐次点击、每分钟心跳或每次键入。
- Renderer 只能向 Electron 主进程提交白名单计数；安装 ID、版本、队列和外网上传由主进程补充并再次校验。
- 遥测始终是 best effort。初始化、持久化、上传或服务端失败不得阻塞启动、打开仓库、编辑、同步或更新；退出时只允许执行有明确
  超时上限的补传，超时后立即保留本地队列并继续退出，不得无限等待网络。

### 强制禁止数据

客户端遥测事件的字段名和值都不得承载以下数据或同义数据：

```text
repo, repository, repo_root, remote, path, file, filename, document_title,
branch, worktree_id, target_commit, query, content, source, diff, clipboard,
frontmatter_key, frontmatter_value, url, email, username, serial_number, mac_address
```

`git_leaf.distribution.downloaded` 中由 接收服务 写入的固定 `source=download_page` 是唯一例外，不开放为客户端属性。错误只记录白名单
`error_code` 和阶段，不记录 exception message、stack、stderr 或服务返回正文。未来如果需要诊断上传，必须作为独立功能单独同意、
单独存储并采用独立保留策略，不得复用产品统计事件。

### 启用范围、本地队列与传输

- 只有已打包、`stable` channel、非开发构建启用；dev-local、测试、CI、未打包 Electron、CLI 和普通 Web 入口关闭。
- 正式版统一启用本文规定的基础统计，不增加用户开关或设备名称配置；Help 必须固定说明采集范围和禁止采集的信息。
- 本地 `telemetry-state.json` 保存安装 ID、版本、设备标签、匿名仓库状态和每日累计检查点；待上传队列只包含低频生命周期事件和
  每日汇总快照。已形成持久化队列的每日状态只保留计算最近 30 日所需的窗口，不能无限增长；尚未安全进入队列的状态不得提前删除。
- 单批最多 100 个事件、压缩前 JSON 最多 64 KiB。启动记录形成后约 2 秒排队并尝试首次上传；运行期间有新增累计值时每分钟排队
  最新 revision 并尝试上传。没有新增累计值时不得生成空 revision。
- 网络失败采用指数退避，最长 6 小时；队列最多保留 30 天或 1 MiB，同一 `summary_id` 的待上传旧修订可以被新修订替换。
- 正常退出时先将最新快照写入本地队列，再执行最长 1.5 秒的 best-effort 补传；超时或失败必须保留队列，不能阻止退出。客户端可以
  重试同一 `event_id`，汇总端必须幂等去重。

### 接收服务与原始存储

- 客户端事件只通过 HTTPS `POST /telemetry/v1/events` 提交。接收服务对事件名、feature ID、属性、枚举、字符串长度和数值范围执行
  allowlist 校验；未知字段整批拒绝，不静默保存。
- 接收服务补充 `received_at` 并按请求来源与 `install_id` 做基础限流。客户端时间、计数和版本都不是可信服务端事实，分析时必须
  保留接收时间和数据质量检查。
- 客户端事件写入独立 `events/` 目录；下载页完整响应写入独立 `downloads/` 目录，不进入客户端事件接口，也不与更新制品目录混放。
- 每批事件全部校验通过后才按 UTC 接收日期逐行追加。写入失败时整批失败，由客户端稍后重试。
- `events/` 和 `downloads/` 下的 JSONL／JSONL.GZ 是唯一事实源，不建设依赖数据库状态的统计口径。所有报告都必须能够从原始日志
  按本文的数据处理顺序重新生成。

标准目录结构：

```text
/var/lib/git-leaf/telemetry/
  events/YYYY/MM/DD.jsonl
  downloads/YYYY/MM/DD.jsonl
  reports/
```

### 数据保留与产品说明

- 当天 JSONL 保持未压缩；7 天后可以 gzip 压缩；原始 JSONL／JSONL.GZ 保留 12 个月。
- 按需生成的 JSON／Markdown 报告按实际需要保留；反向代理访问日志最多保留 7 天，且不得写入产品统计 JSONL。
- 到期日志按日期文件清理。保留规则发生变化时必须先更新本文和对应运维配置。
- Help 中的说明必须表达：Git Leaf 会发送匿名安装、版本、使用时长和功能使用统计；不会发送仓库名、文件名、文档内容、搜索词或
  Git 数据；设备名称只用于内部设备清单，不作为用户身份或行为事件属性。

## 统计术语与最小单位

| 术语 | 唯一键或单位 | 可以表达 | 不可以表达 |
| --- | --- | --- | --- |
| 事件 | `event_id` | 一次客户端状态记录 | 一个用户或一次唯一操作 |
| 安装实例 | `install_id` | 一份仍保留本地遥测状态的 App 数据目录 | 自然人、物理设备或一次下载安装 |
| 下载请求 | `download_id` | 下载页发起并被 接收服务 记录的一次正式安装包 GET | 唯一用户、唯一设备或安装成功 |
| 每日汇总 | `summary_id`＋最高 `revision` | 一个安装实例在 `summary_date` 的最新累计快照 | 不可变增量事件 |
| 更新状态组 | `install_id`＋`to_version` | 一个安装实例对一个目标版本的可观察状态集合 | 一次严格的更新事务或用户转化漏斗 |
| 活跃安装实例 | `install_id` | 在口径内发生有效活跃或有效功能动作的安装实例 | 登录用户或团队成员 |

所有对外描述优先使用“安装实例”，不得简写为“用户”。`reason=first_observed` 必须描述为“首次观察安装实例”，不得描述为
“新增安装”“新用户”或“完成安装”。

## 数据处理顺序

标准汇总必须按以下顺序处理：

1. 读取 `events/` 与 `downloads/` 下所有 `.jsonl` 和 `.jsonl.gz`；
2. 按 `schema_version` 和 App 版本能力边界拒绝无法解析、缺少主键或不满足对应契约的记录；
3. 客户端事件按 `event_id` 分组，下载记录按 `download_id` 分组：内容相同的重试只保留一条；同一主键出现不同内容时，按唯一冲突主键
   计数并隔离该主键的全部记录，禁止任意保留第一条；
4. 每日汇总先恢复 legacy `summary_date`；恢复失败的记录排除，不得回退到 envelope 日期；
5. 生命周期／更新事件按 `local_date` 过滤，每日汇总按已恢复的 `summary_date` 过滤，下载记录按 `occurred_at` 的 UTC 日期过滤；
6. 每个 `summary_id` 在平台和 App 版本切片之前先全局选择最高 `revision`；最高 revision 冲突或身份冲突时隔离整个汇总组；
7. 只对第 6 步形成的最终每日快照应用平台和 App 版本切片，禁止筛选条件把已被更高 revision 覆盖的旧快照重新带回指标；
8. 再计算安装实例数、更新路径、活跃、功能计数和数据质量指标；
9. 输出时同时给出数据窗口、生成时间、最新 `received_at`、文件数和数据质量警告。

CLI 未显式传入 `--from`／`--to` 时，标准日报默认使用 Asia/Shanghai 的昨天作为结束日期，并取此前 29 日，共 30 个完整自然日；
库函数只有在调用方显式不传日期时才保留全历史分析能力。今天的数据必须单列为“当日未完成数据”，不得与完整日基线混算。
如果原始日志覆盖不足 7 个完整日期，仍可输出绝对数，但不得给出七日趋势结论。

## 事件目录

### `git_leaf.distribution.downloaded`

由 官方服务 记录，不由客户端上传。

| 字段 | 允许值或格式 | 语义 |
| --- | --- | --- |
| `download_id` | 随机短标识 | 单次日志主键 |
| `occurred_at` | UTC ISO 时间 | 接收服务 完成请求处理的时间 |
| `channel` | `stable` | 正式分发渠道 |
| `platform` | `darwin-universal`、`darwin-arm64`、`win32-x64` | 安装包平台 |
| `version` | 语义版本 | 被请求制品版本 |
| `artifact` | macOS 为 `dmg`，Windows 为 `zip` | 安装包类型 |
| `source` | `download_page` | 仅统计下载页带固定来源标记的请求 |
| `bytes` | 非负整数 | 接收服务 对目标制品文件执行 `stat()` 得到的文件大小，不等于实际网络传输字节 |

只允许把它解释为“下载页安装包请求趋势”。自动更新包、直接制品 URL、复制已有安装包、代理缓存、无来源标记请求均不在该口径内。
下载日志文件不存在表示“数据源未形成”，与“已确认请求数为 0”不同。

### `git_leaf.installation.observed`

| 属性 | 允许值 | 语义 |
| --- | --- | --- |
| `reason` | `first_observed` | 当前 `install_id` 第一次进入遥测系统 |
| `reason` | `device_name_changed` | 同一安装实例的设备标签发生变化 |
| `device_name` | 最多 120 字符，可缺省 | 内部设备清单标签，不参与统计主键 |

`first_observed` 可能来自新安装、旧版本升级后首次启用遥测、清空用户数据或复制／重建配置。下载请求和首次观察安装实例必须作为两条
独立趋势展示，禁止相除得到“下载转安装率”。

“已观察安装实例”和所有首次观察切片都只使用每个 `install_id` 最早的合法 `reason=first_observed` 记录。默认无日期、平台或版本筛选时，
指标是事实源内存在合法首次观察记录的去重安装实例数；切片时使用这条最早记录的 `local_date`、`app.platform` 和 `app.version`。
后续 `device_name_changed` 不得把安装实例带入新的版本、平台或日期切片；只有设备名称变化而缺少合法 `first_observed` 的孤立记录也不进入该指标。

### `git_leaf.update.state_changed`

公共属性：

| 属性 | 允许值 | 解释规则 |
| --- | --- | --- |
| `state` | 见下表 | 当前记录的更新状态 |
| `trigger` | `automatic`、`manual`、`windows_bootstrap` | 触发当前代码路径的方式，不等于用户意图来源 |
| `from_version` | 语义版本 | 事件发生时运行的 App 版本 |
| `to_version` | 语义版本或 `null` | 当前发现或准备的目标版本 |
| `error_code` | 固定错误枚举 | 只在失败时解释，不包含原始错误正文 |
| `stage` | `check`、`download`、`prepare`、`install`、`launch`、`unknown` | 仅 `failed` 使用；缺失必须归入 `legacy_unknown` |

状态语义：

| `state` | 事实语义 | 分析时的限制 |
| --- | --- | --- |
| `check_started` | 开始一次更新检查 | 当前没有 `attempt_id`，只能做聚合平衡检查 |
| `current` | manifest 版本不高于运行版本 | `to_version < from_version` 必须另记为 `feed_behind`，不能解释为版本相同 |
| `available` | 发现高于运行版本的 manifest | 可重复出现，不等于用户看见或点击更新 |
| `downloaded` | 客户端报告目标包已下载并准备 | 可因重试重复，不等于安装已开始 |
| `install_started` | 退出／切换安装前调用了安装入口 | 缺失不能反推安装没有发生，旧版本可能未完整埋点 |
| `completed` | 本地状态观察到运行版本发生变化 | 当前实现不能证明由 App 内更新完成；报表必须显示为“观察到版本变化” |
| `failed` | 更新流程记录了稳定错误码 | 必须按 `stage` 与 App 版本拆分；缺失阶段不得猜测 |
| `skipped` | 保留状态 | 当前没有稳定用户入口，不进入核心统计 |

`trigger=automatic` 只表示事件由自动检查或恢复路径产生。用户此前点击并持久化的更新意图可能在下一次自动检查中恢复，因此不得用
`trigger` 推断“用户是否主动更新”。当前 `completed` 固定使用 `automatic`，不得把它解释为自动更新归因。

字段完整性必须按状态校验：

| 状态 | 当前客户端必须提供 | 当前客户端必须省略 |
| --- | --- | --- |
| `check_started` | `trigger`、有效 `from_version` | `to_version`、`error_code`、`stage` |
| `current`、`available`、`downloaded`、`install_started`、`completed`、`skipped` | `trigger`、有效 `from_version`、有效 `to_version` | `error_code`、`stage` |
| `failed` 且 `stage=check` | `trigger`、有效 `from_version`、`error_code`、`stage` | 无；`to_version` 可省略 |
| 其他 `failed` | `trigger`、有效 `from_version`、有效 `to_version`、`error_code`、`stage` | 无 |

版本字段使用 SemVer 核心版本，可带合法 prerelease 或 build metadata，不接受任意非空字符串。从 App `1.10.0` 起执行上述完整性约束；
更早 App 可能产生缺少 `stage`、`error_code` 或目标版本的旧记录。接收服务 必须按 `app.version` 兼容接收这些旧客户端，汇总器必须将
缺失能力显示为 `legacy_unknown`，但不得让旧记录满足新契约的数据质量门禁。

强语义更新指标的 capability scope 固定为 `app.version >= 1.10.0`。更新检查平衡、去重状态组、状态前序关系、失败阶段／错误码完整性和
由这些字段形成的完整性结论都只使用通过当前严格契约的记录。App `<1.10.0` 只保留各 `state` 的可观察事件数和安装实例绝对数；缺失目标
版本、失败阶段或错误码等合法旧契约中的能力缺口进入 `legacy_unknown`。非 `failed` 状态携带 `error_code`／`stage` 属于契约矛盾，
客户端、接收服务 和汇总器都必须按 invalid contract 拒绝，不能归入 `legacy_unknown`。即使旧记录恰好带有某个字段，也不得据此宣称它满足
新契约、补齐检查结果或建立完整更新路径。

### `git_leaf.daily.summary`

每日汇总是累计快照。以下字段是允许的统计数据项：

| 字段 | 单位 | 指标用途 |
| --- | --- | --- |
| `summary_date` | 本地自然日 | 该累计快照实际归属的业务日期；不同于事件进入队列的日期 |
| `launch_count` | 次 | 当日 App 进程启动次数 |
| `launch_counts_by_entry_kind` | 次 | `manual`、`deep_link`、`update_restart`、`windows_bootstrap`、`unknown` 分布 |
| `active_minutes` | 整分钟 | 满足窗口可见、有焦点、未锁屏、非空闲和非更新退出条件的分钟数 |
| `repository_open_count` | 次 | 成功打开仓库次数 |
| `repository_switch_count` | 次 | 仓库之间切换次数 |
| `distinct_repository_count` | 仓库数 | 当日本机去重仓库数 |
| `rolling_30d_distinct_repository_count` | 仓库数 | 截至该本地日期最近 30 日去重仓库数 |
| `worktree_switch_count` | 次 | 同一仓库内 worktree 切换次数 |
| `mode_minutes.preview` | 整分钟 | Preview 有效活跃分钟 |
| `mode_minutes.source` | 整分钟 | Source 有效活跃分钟 |
| `mode_minutes.live` | 整分钟 | Live 有效活跃分钟 |
| `feature_counts` | 次 | 预定义功能及低基数维度的当日累计次数 |

`summary_id` 必须等于
`SHA256(install_id + ":" + summary_date)` 十六进制值按 `summary_id` 长度取得的前缀；当前客户端固定使用前 32 位。`occurred_at`、顶层 `local_date` 和
`timezone_offset_minutes` 仍描述快照进入本地队列的真实时间；跨日补排时，顶层 `local_date` 可以晚于 `summary_date`，两者不得混用。
显式 `summary_date` 不得晚于顶层 `local_date`，但不设置向前回补天数下界；查询窗口自然按 `summary_date` 过滤。
当前客户端生成的每日汇总必须显式写入 `summary_date`。历史 schema v1 记录可能缺少该字段；汇总器只允许在原始 `summary_id` 能按上述
确定性公式唯一恢复日期时兼容。候选范围从 envelope `local_date` 当日开始向前，到按日历减去 12 个月所得日期（含边界）；不得搜索
envelope 次日，也不得用固定 367 日近似自然月边界。恢复失败必须排除并计入数据质量，不得用 envelope 日期、最早 revision 日期或接收日期猜测。

允许的 `feature_id`、计数单位与维度：

| `feature_id` | 加 1 的唯一时机 | 允许维度 |
| --- | --- | --- |
| `navigation.file_search` | 文件筛选从空查询进入非空查询；清空后再次输入才开始下一次 | 无 |
| `navigation.document_search` | 一次搜索面板会话中首次形成非空查询；关闭或清空后才开始下一次 | 无 |
| `navigation.frontmatter_filter` | 一项筛选成功应用或成功移除 | `action`、`filter_count_bucket` |
| `navigation.worktree_switch` | 一次非当前 worktree 切换请求形成终态 | `result` |
| `navigation.deep_link` | 一次包含仓库身份的 Deep Link 形成打开终态；不得同时计作进程启动 | `type`、`result`、`failure_reason` |
| `editing.activity` | Source／Live 成功写回后记录一次，同一 Renderer 会话最多每 5 分钟一次 | `mode` |
| `editing.slash_command` | Slash 命令已通过前置检查并实际进入插入流程 | `command_category` |
| `editing.frontmatter` | 一次 add／edit／delete 请求形成终态 | `action`、`result` |
| `editing.image_paste` | 一次粘贴图片保存请求形成终态 | `result` |
| `editing.markdown_to_mdx` | 一次 Markdown 转 MDX 请求形成终态 | `result` |
| `output.pdf_export` | 一次 PDF 导出请求形成终态 | `result` |
| `git.sync` | 一次 Git 同步提交形成终态 | `strategy`、`result`、`file_count_bucket`、`error_code`、`drift_kind`、`retry_bucket`、`duration_bucket` |
| `github.open` | 一次打开 GitHub 请求形成终态 | `result` |
| `line_reference.copy` | 定位引用成功写入剪贴板 | `line_count_bucket` |

`navigation.deep_link.failure_reason` 只在 `result=error` 时出现，固定枚举为
`repository_not_known`、`worktree_not_found`、`repository_selection_invalid`、`repository_identity_mismatch`、
`repository_open_failed`、`main_worktree_check_failed`、`main_worktree_unavailable`、`primary_not_main`、
`fetch_failed`、`revision_missing`、`main_ahead`、`main_diverged`、`sync_failed`、`safe_update_failed`、
`document_open_failed`、`unknown`。它回答“Deep Link 最终未打开时停在哪一类可操作失败”，统计单位仍是相同
`feature_id`、`type`、`result`、`failure_reason` 组合的每日累计次数，不新增逐次事件或连接键。历史客户端产生的
`result=error` 可以缺少该维度，报表必须显示为 `legacy_unknown`，不得从本机日志、错误正文或相邻事件补原因；
`success`／`cancel` 携带该维度属于无效契约。

该维度只上传固定低基数枚举，不上传仓库身份、路径、文件名、Git 错误正文或用户选择内容，不能据此推断具体仓库、
文档、用户旅程或失败后的恢复结果。需要下线时先停止客户端写入，接收服务 与汇总器在最长 30 日队列和数据保留窗口内
继续兼容历史枚举，窗口结束后再共同移除 allowlist，不能先移除服务端接收能力导致合法旧队列被拒绝。

枚举值以客户端与服务端共同 allowlist 为准；新增维度前必须在本文补充分析问题、统计单位、逻辑关系、隐私风险和下线方式。

`git.sync` 的并发与耗时维度用于回答“显式同步期间，活动工作区是否发生了足以影响当前 Git 事务的变化”以及
“同步是否落在产品设定的三秒体验预算内”：

- `drift_kind` 固定为 `none`、`content_changed`、`head_changed` 或 `post_commit_changed`；它只描述客户端在同步保护点
  观察到的状态类别，不证明修改来源是用户、某个 AI Agent 或其他工具；
- `strategy` 当前固定为 `guarded_live_v1`，用于把新保护路径与缺少该维度的历史客户端分开；不得根据 App 版本猜补；
- `retry_bucket` 固定为 `0`、`1` 或 `2_plus`，记录该次终态前因保护点变化而重新准备同步的次数区间；
- `duration_bucket` 固定为 `under_1s`、`1_3s`、`3_10s` 或 `over_10s`，包含本地 Git 与网络时间，不能单独归因于
  电脑性能、仓库规模或远端网络；
- `workspace_changed` 与 `head_changed` 是允许的 `error_code`，只表示同步因相应保护门禁停止，不上传原始 Git 输出。

这些维度仍按安装实例的每日累计 feature counter 上传，不增加逐次事务 ID、仓库连接键或文件标识。报表可以计算各枚举的
聚合次数和占比，但不得将 `drift_kind` 解释为 AI Agent 使用率，也不得把 `duration_bucket` 跨网络环境直接解释为设备性能。

对象层不可变发布器的升级判断采用预先登记的观察窗口：至少覆盖 30 个完整自然日、200 次带
`strategy=guarded_live_v1` 的同步终态，并覆盖至少 10 个活跃安装实例。在达到样本门槛后，满足任一条件才进入正式实现评审：

- `content_changed`、`head_changed`、`post_commit_changed` 合计占比达到 3%；
- `workspace_changed` 或 `head_changed` 导致的失败合计达到 1%；
- 同期收到至少 3 个能够复现的“同步批次混入／遗漏并发修改”案例。

阈值只触发评审，不自动切换策略；评审还必须验证活动分支、真实 index、继续编辑内容与已发布远端 commit 的无损对齐。
未达到样本门槛时报告“证据不足”，不得把 0 次观测写成 0% 风险。`duration_bucket` 用于验证三秒体验预算，但因其包含网络耗时，
不能单独支持或否定对象层发布器。

## 事件关系与逻辑一致性

本文不建设用户行为漏斗。事件关系只用于保证统计项语义准确、结果能够互相解释，并发现漏记、重复、旧版本能力缺失或窗口截断。

### 下载与首次观察：两项独立统计

```text
下载页安装包请求 ──┐
                    ├── 没有共同主键，不建立前后关系
首次观察安装实例 ──┘
```

两条数据没有共同匿名主键。标准报表可以按日期、平台和版本并排显示，但不得声称请求来自同一安装实例。

### 每日汇总内部平衡

每个最新每日汇总必须满足：

```text
launch_count = sum(launch_counts_by_entry_kind)
active_minutes = preview_minutes + source_minutes + live_minutes
distinct_repository_count <= repository_open_count
distinct_repository_count <= rolling_30d_distinct_repository_count
深度活跃安装实例 <= DAU
DAU <= WAU <= MAU（同一目标日期、同一数据覆盖范围）
```

不满足时必须计入数据质量异常，并将该每日汇总从所有 daily-derived 指标中排除；报表同时给出排除数量和受影响日期，不能一边报告
异常一边继续展示由异常记录贡献的“准确”结果。通过检查的其他汇总仍按有效子集计算，并标记 `partial_quality`；单条异常不得把其他
日期或整个窗口的合法统计全部抹成不可用。某日没有任何通过检查的每日汇总时，该日 daily-derived 指标才显示“不可计算”。功能计数必须
为正整数，未知 `feature_id` 或维度不得进入汇总。

最高 revision 内容冲突或汇总身份冲突与内部平衡异常使用同一质量传播规则：受影响日期必须保留在质量元数据中；同日仍有其他合法最终
快照时，DAU、功能、模式、仓库及滚动活跃只展示有效子集并标记 `partial_quality`；同日只有冲突／异常而没有合法最终快照时标记
`unavailable_quality`，不得显示 0。WAU／MAU 的日期覆盖只能由完成 `summary_date` 恢复、revision 选择和冲突隔离后的每日汇总业务日期证明；
安装、更新或其他生命周期事件的日期不能补齐 daily coverage。冲突／异常日期必须另列为 `quality_affected_dates`，不能伪装成普通缺失日。

### 更新检查结果平衡

```text
check_started
├── current_exact      ：current 且 to_version = from_version
├── feed_behind        ：current 且 to_version < from_version
├── available          ：to_version > from_version
└── failed_check       ：failed 且 stage = check
```

该公式仅适用于 App `>=1.10.0` strict capability。旧版本的检查、结果或缺失字段只进入 state 绝对事实和 `legacy_unknown`，不得进入公式；
不得把它、`current_other` 或其他阶段失败放进检查结果分母以抵消平衡差。
聚合数量相等可以说明检查主账整体自洽；因为没有 `attempt_id`，不得据此
把某一条失败强行连接到某一条 `check_started`。平衡差不为 0 时，必须按 App 版本、平台和日期查找漏记或多记。

### 更新状态先后关系

```text
available → downloaded → install_started → completed（观察到版本变化）
```

连接键为 `(install_id, to_version)`，同一状态重复出现时取最早 `occurred_at`，且“先有／更早”一律使用严格 `<`，相同时间戳不算
前序。该关系仅对 App `>=1.10.0` strict capability 计算。所有七项关系都按去重状态组计数，包括 `completed`，不得按重复事件条数增加。
旧版记录即使存在目标版本，也不用于宣称有／无完整前序。标准汇总输出以下绝对数量，不默认计算转化率：

| 统计项 | 定义 | 逻辑用途 |
| --- | --- | --- |
| `available_paths` | 出现 `available` 的去重状态组数 | 观察到的目标版本机会数 |
| `downloaded_with_prior_available` | 先有 `available`、后有 `downloaded` 的状态组数 | 检查下载状态是否能被前序解释 |
| `downloaded_without_prior_available` | 没有更早 `available` 的 `downloaded` 状态组数 | 识别窗口截断、恢复状态或漏记 |
| `install_started_with_prior_downloaded` | 先有 `downloaded`、后有 `install_started` 的状态组数 | 检查安装入口记录是否有前序 |
| `install_started_without_prior_downloaded` | 没有更早 `downloaded` 的 `install_started` 状态组数 | 识别旧版本、恢复状态或漏记 |
| `completed_with_prior_lifecycle` | 更早出现 `available`、`downloaded` 或 `install_started` 的 `completed` 数 | 表示版本变化有可观察前序 |
| `completed_without_prior_lifecycle` | 没有上述前序的 `completed` 数 | 不能归因为 App 内更新 |

以上关系只用于解释状态是否有逻辑前序，不构成用户漏斗。原因包括：

- `available` 不等于 UI 被用户看到；
- 当前没有用户意图或严格下载开始记录；
- `completed` 只证明版本变化，不证明安装方式；
- 查询窗口可能截断上游或下游事件；
- 不同 App 版本可能具有不同的埋点能力。

如果针对具体问题临时计算比例，必须同时展示绝对分子、分母和查询窗口；分母小于 10 时标注“小样本”。标准 heartbeat 以绝对数量和
逻辑异常为主，不把这些关系包装为转化率。

### 当前不可建立的关系

| 想回答的问题 | 当前缺失 | 结论 |
| --- | --- | --- |
| 下载页请求 → 安装成功 | 下载与安装实例没有共同主键 | 不可计算 |
| 发现更新 → 用户点击更新 | 缺少 `update_requested` | 不可计算 |
| 用户点击 → 下载开始 | 缺少 `download_started` 和持久化意图来源 | 不可计算 |
| 下载开始 → 下载成功 | 缺少严格更新事务 ID | 不可计算 |
| App 内安装开始 → App 内安装完成 | `completed` 没有严格安装事务标记 | 不可计算 |
| D1／D3／D7／D14 真正升级完成率 | 无法证明安装方式，且存在右截断 | 不可计算 |

只有未来确实需要严格回答这些问题时，才考虑引入隐私安全的随机更新事务标记和意图状态。在此之前，报表不得用现有字段近似替代。

## 指标字典

### 安装与分发

| 指标 | 公式 | 允许切片 |
| --- | --- | --- |
| 下载页安装包请求数 | 去重 `download_id` 数 | UTC 日期、平台、版本、制品类型 |
| 制品文件大小合计 | `bytes` 求和 | UTC 日期、平台、版本；来自制品文件 `stat()`，名称不得写成声明大小或实际传输流量 |
| 已观察安装实例 | 最早合法 `first_observed` 的去重 `install_id` 数 | 以首次观察记录的平台、App 版本和本地日期切片 |
| 首次观察安装实例数 | `reason=first_observed` 的去重 `install_id` 数 | 本地日期、平台、App 版本 |

### 活跃与版本

| 指标 | 公式 | 说明 |
| --- | --- | --- |
| DAU | 当日本地最新汇总中 `launch_count > 0`、`active_minutes > 0` 或任一有效 `feature_count > 0` 的去重 `install_id` | 打开正式 App 即计入；不是自然人数量 |
| 深度活跃安装实例 | 当日本地最新汇总中 `active_minutes > 0` 或任一有效 `feature_count > 0` 的去重 `install_id` | 保留原有交互／时长口径，与 DAU 分开展示 |
| WAU | 截至目标本地日期最近 7 日有效最终每日汇总的 DAU 安装实例并集 | 需要完整 daily-summary 业务日期覆盖；其他事件日期不能补齐 |
| MAU | 截至目标本地日期最近 30 日有效最终每日汇总的 DAU 安装实例并集 | 覆盖不足 30 日时必须标记 `partial` 并注明实际起始日，不得显示成完整 MAU |
| 有效活跃分钟 | 最新每日汇总 `active_minutes` 求和 | 不等于工作时长 |
| 启动次数 | 最新每日汇总 `launch_count` 求和 | 不等于活跃实例 |
| 活跃版本分布 | 窗口内满足活跃条件的去重 `install_id`，按 `app.version` 分组 | 同一实例跨版本可进入多个版本组 |

DAU／WAU／MAU 的报表契约版本固定输出为 `launch_based_v2`。该版本可以用历史每日汇总中的 `launch_count` 重算，不要求客户端事件
schema 升级；使用旧公式生成的活跃基线与 `launch_based_v2` 不可直接比较。深度活跃安装实例继续使用旧公式，只用于区分“打开 App”与
“产生可观察时长或功能动作”，不得改名为用户参与度、留存或工作效率。

日报中的昨天固定标记为 `provisional_late_arrivals`，今天标记为 `incomplete_today`，更早日期标记为 `historical`。该标记只表达
迟到队列仍可能补传，不声称已知应上报安装实例的完整分母。查询范围内缺少最终每日汇总的业务日期必须在 `activity.by_date` 中显式输出
`active_installations=null`、`engaged_installations=null`、`active_minutes=null`、`launches=null` 和
`status=unavailable_coverage`，不得通过省略日期让下游误读成 0。

### 仓库、模式与功能

| 指标 | 公式 | 说明 |
| --- | --- | --- |
| 每日不同仓库分布 | 最新每日汇总的 `distinct_repository_count` 分布 | 不上传仓库身份 |
| 最近 30 日不同仓库数 | `rolling_30d_distinct_repository_count` 分布 | 由客户端本地 HMAC 去重 |
| 模式分钟 | `mode_minutes` 按模式求和 | 三种模式分钟可与总活跃分钟核对 |
| 功能使用次数 | 相同 `feature_id`＋维度组合的 `count` 求和 | 是聚合次数，不是逐次事件 |
| 功能使用安装实例 | 对出现该功能计数的 `install_id` 去重 | 可按平台和 App 版本切片 |
| 功能采用率 | 功能使用安装实例／同窗口、同切片的活跃安装实例 | 分母必须与分子使用相同日期、平台和版本 |

### 更新与可靠性

| 指标 | 公式 | 解释边界 |
| --- | --- | --- |
| 更新状态事件数 | 各 `state` 的事件条数 | 可包含同一路径重试 |
| 更新状态安装实例数 | 各 `state` 的去重 `install_id` | 不等于去重更新机会 |
| 去重更新状态组数 | strict capability 各 `state` 的 `(install_id,to_version)` 去重数 | 仅 App `>=1.10.0`，用于状态先后关系检查 |
| 更新检查平衡差 | strict capability 的 `check_started - current_exact - feed_behind - available - failed_check` | 仅 App `>=1.10.0` 作聚合数据质量诊断 |
| 失败事件／实例 | strict capability 的 `failed` 按 `stage`、`error_code`、App 版本分组 | legacy 缺失能力只进入 `legacy_unknown` |
| 状态先后关系 | strict capability 按上一节七项绝对数量 | 仅 App `>=1.10.0`，用于识别可解释前序、窗口截断和漏记 |

### 数据质量

标准输出至少包含：

- 事件文件数、下载日志文件数和实际覆盖日期；
- 最新 `received_at` 与报告生成时间的差值；
- 无效事件行、无效下载行；
- 重复 `event_id`、重复 `download_id`；
- 内容冲突的唯一 `event_id`、`download_id` 及因此隔离的全部记录；
- 被更高 `revision` 覆盖的每日汇总数；
- 缺少显式 `summary_date` 但已确定性恢复、恢复失败，以及 envelope 日期晚于汇总日期的每日汇总数；
- 更新检查平衡差；
- 缺少 `stage` 的失败事件数及 App 版本；
- `current` 中 `to_version < from_version` 的事件数；
- 没有先前 `available`／`downloaded`／`install_started` 的 `completed` 数；
- 查询窗口是否可能截断更新路径。

事件与下载数据源分别使用以下状态，不能把缺失信息改写成 0：

| 状态 | 含义 | 指标显示 |
| --- | --- | --- |
| `not_configured` | 调用时没有提供数据源 | `N/A` |
| `missing` | 指定路径不存在 | `N/A` 并报告错误 |
| `empty` | 路径存在但没有 JSONL／JSONL.GZ | “尚未形成日志文件” |
| `read_error` | `stat`／`readdir` 失败，或任一 JSONL／GZIP 文件读取、解压中途失败 | `N/A` 并报告读取失败；不得输出已读部分的数值 |
| `present` | 存在日志文件 | 筛选后没有合法记录时才显示 0 |

当状态不是 `present` 时，该数据源派生的 JSON 指标必须为 `null` 并带 `unavailable_source` 状态；Markdown 显示 `N/A`、
“尚未形成日志文件”或“读取失败”。文件数等来源元数据可以保留已知值，但安装、下载、更新、活跃、功能及相应质量计数不得伪装成 0。

WAU 的目标窗口缺少任一有效最终每日汇总业务日时显示“不可计算”；MAU 覆盖不足 30 个有效最终每日汇总业务日时只能输出带 `partial`
标记的安装实例并集。冲突／异常造成的日期质量缺口按 `partial_quality`／`unavailable_quality` 传播，不得当作普通完整覆盖。
标准输出必须给出所需起始日、实际起始日和缺失日期，不能只给一个数值。业务日期存在至少一份最终每日汇总只能证明该日期已有可用
记录，不能证明所有打开过 App 的安装实例都已完成上传；昨天必须保留迟到数据暂定标记。

## 标准日报格式

日报按以下顺序输出：

1. 数据源健康：接收服务 服务、事件目录、下载目录、数据源状态、日志覆盖、最新接收时间及其距生成时间的差值；
2. 数据窗口：最近 30 个完整自然日、昨天，以及单列的今天未完成数据；
3. 安装与分发：下载页请求、首次观察安装实例，两者明确不可相除；
4. 更新检查：明确 App `>=1.10.0` strict capability，输出 `current_exact`、`feed_behind`、`available`、`failed_check` 和平衡差，
   legacy 只列 state 绝对数与 `legacy_unknown`；
5. 更新状态关系：仅 strict capability 的有前序／无前序绝对数量，以及窗口截断说明；
6. 失败：strict capability 按阶段、错误码、平台和 App 版本；legacy 缺字段单列；
7. 活跃与功能：`launch_based_v2` DAU／WAU／MAU、深度活跃安装实例、迟到数据状态、分钟、模式、核心功能；Deep Link 的 `error` 按 `failure_reason` 列出，
   缺少原因的历史错误单列 `legacy_unknown`；
8. 数据质量与解释边界；
9. 与上一份同口径报告相比的绝对增量；没有可比基线时明确写“无可比基线”，避免把未完成日与完整日直接比较。

日志目录存在但没有文件时写“尚未形成日志文件”；存在文件且筛选后无记录时才写“口径内为 0”。任何比例必须同时展示分子和分母。

## 禁止推断

以下说法在当前数据契约下禁止出现：

- “下载了 N 个用户”或“新增 N 个用户”；
- “首次观察安装实例就是当天新安装”；
- “下载页请求到安装的转化率”；
- “Windows 更新转化为 0，所以 Windows 更新失败”；
- “`completed` 全部来自 App 内自动更新”；
- “`trigger=automatic` 表示用户没有点击”；
- “没有 `install_started` 表示没有安装”；
- “缺失 `stage` 的网络错误一定发生在下载阶段”；
- “当日未完成数据下降代表真实使用下降”；
- “事件数等于安装实例数或独立更新机会数”。
- “DAU 等于自然人数量”；
- “DAU 大于 0 但活跃分钟为 0 属于数据矛盾”（打开 App 或功能动作本身可以形成 DAU）。

## 契约变更门禁

任何统计变更必须同时完成：

1. 在本文写明分析问题、事件事实语义、统计单位、连接键、逻辑关系和禁止推断项；
2. 更新 `src/telemetry.mjs` 的客户端 allowlist 与状态持久化；
3. 更新 `scripts/gitleaf-update-server.py` 的服务端校验或分发日志；
4. 更新 `scripts/summarize-telemetry.mjs` 的汇总公式和标准 Markdown 文案；
5. 添加正常、重复、缺失、乱序、跨版本和窗口截断测试；
6. 如果改变应用架构、接收服务 部署或发布边界，同步更新 `architecture.md` 或 `release.md`；
7. 发布后按 App 版本标记新旧契约能力，旧数据不得冒充新口径。

事件 `schema_version` 只有在事件信封或字段兼容性改变时才递增；可选字段逐步发布也必须提供独立的统计契约版本或按 App 版本建立
能力边界。汇总脚本必须兼容旧记录，并把缺失能力显示为 `legacy_unknown`，不得静默补值。

`daily_summary_explicit_date` 是 schema v1 的兼容能力，以每日汇总是否包含 `summary_date` 识别；已有 App `1.10.0` 日志中同时存在发布前后
构建，不能仅凭 App 版本推断该字段。缺字段记录只能使用上一节的确定性摘要 ID 公式恢复并标记为 legacy。

## 实现映射

| 责任 | 实现位置 |
| --- | --- |
| 客户端事件、安装 ID、每日汇总和属性校验 | `src/telemetry.mjs` |
| 更新状态产生 | `desktop/updates.mjs`、`desktop/main.mjs` |
| 活跃分钟 | `src/telemetry-activity.mjs` |
| Renderer 功能计数 | `public/telemetry.js`、`public/app.js`、`src/client/source-editor.mjs` |
| 服务端事件校验与下载日志 | `scripts/gitleaf-update-server.py` |
| 标准汇总与 Markdown 日报 | `scripts/summarize-telemetry.mjs` |
| 统计契约、隐私、传输、存储和保留边界 | 本文 |
| 应用架构与发布流程 | `architecture.md`、`release.md` |
