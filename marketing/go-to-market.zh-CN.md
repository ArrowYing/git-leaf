---
last_updated: 2026-07-26
---

# 对外传播

[Marketing index](README.zh-CN.md) | 简体中文

## 信息层级

### 产品类别

> A desktop app for Git-based knowledge bases.
>
> 面向 Git 知识库的桌面应用。

这句话用于 README、GitHub description、下载页和通用介绍，不能加入 `company`、`team` 或 `AI-native company`，
也不能把 Git Leaf 写成知识库本身。

### 首要问题

> Open and maintain your knowledge base without working directly in Git or Markdown.
>
> 无需直接操作 Git 或 Markdown，即可打开并维护知识库。

它明确服务普通用户：用户无须先成为开发者，也无须理解产品内部怎样使用 Git。

### 核心价值

> Anyone can use Git Leaf, while AI agents work with the same files directly in Git.
>
> 任何人都可以使用 Git Leaf，AI Agent 则直接使用 Git 中的同一份文件。

这里突出人机协作，但不暗示 Git Leaf 内置 Agent Chat。当前能够证明的是：人通过 App 维护文件，Agent 直接使用
同一仓库，双方改动都能回到 Git Leaf 中阅读和继续编辑。

### 场景型 campaign

> The human interface for your AI-native knowledge base.
>
> AI-native 知识库的人类界面。

这句保留给 AI-native 公司、Agent 工程和组织知识主题的 campaign、文章或 landing page。它不提升为全局类别，
因为个人用户、开源项目和没有自称 AI-native 的团队也能自然使用产品。

## 目标用户

### 日常用户

- 不熟悉 Git 和 Markdown、但需要维护知识库的普通人；
- 维护个人 Git 知识库，希望减少源码与命令行操作的人；
- 阅读和修改开源项目文档、规则或决策记录的贡献者；
- 共享小团队手册、产品资料和运行规则的成员；
- 阅读、检查和继续编辑 AI Agent 文档改动的人。

### 采用者

- 已经在 Git 中维护 Markdown／MDX 知识的个人、维护者和团队负责人；
- 希望多种 AI Agent 与人共用普通文件的技术负责人；
- 正在建设 AI-native 工作方式的公司创始人、技术负责人和 AI 平台负责人。

### 首要组织 ICP

AI-native 小团队和公司仍是首要组织 ICP：他们已有明确的 Git 知识事实源、Agent 直接访问需求，以及普通成员参与
困难。对这个 ICP 的内容可以直接讲公司知识和员工，但必须呈现为具体场景，不能反向覆盖全局产品定义。

## README 第一屏

第一屏按以下顺序组织：

1. 产品名称与中英文切换。
2. 产品类别、首要问题、核心价值三层文案。
3. macOS 主按钮、Windows Preview 次级入口、从源码运行文本入口。
4. 一张完整真实产品截图。
5. CI 与 Apache 2.0 两枚低调徽章。

不使用 `Platform` 徽章：macOS 和 Windows 状态已经由转化入口更清楚地表达；额外徽章会重复信息。CI 和 License
放在截图下方，作为信任信号而不是视觉主角。Windows 的 unsigned Preview 状态必须同时出现在入口文案、下载页和
平台指南中。

## 产品截图

README 主图必须来自真实 Git Leaf App 和隔离的虚构知识库，不能使用概念图、设计稿、私有公司内容或开发 fixture
冒充日常产品。

截图应同时证明：

- 完整桌面窗口和真实仓库身份；
- 左侧知识库目录，以及 All／Favorites／Sync 中至少一个有意义的状态；
- 中间以 Live 或 Preview 展示一篇普通人可读的文档；
- 明确可见的一两个本地改动和同步入口；
- Agent 上下文入口或已收集条目，但不暗示内置聊天；
- 没有错误、调试信息、私人路径、敏感内容或只有开发者才懂的操作。

样例内容使用中性的 `Project handbook`、`Decision record`、`Release playbook` 等知识，不把公司场景硬编码进产品主图。
图像保持完整窗口比例，使截图既证明产品真实性，也让普通用户一眼看出这是可直接使用的桌面 App。

## 30～60 秒演示主线

推荐时长约 55 秒，只讲一个完整循环：

| 时间 | 画面 | 叙事 |
| --- | --- | --- |
| 0～8 秒 | Git Leaf 打开 `Project handbook`，Live 模式阅读 | 这是一套存放在 Git 中的知识库，但用户看到的是普通文档界面 |
| 8～18 秒 | 人直接修改一条项目规则 | 无须编辑 Markdown，也无须进入终端 |
| 18～27 秒 | 切到 Sync，确认改动并执行同步 | 人的修改安全进入同一 Git 仓库 |
| 27～40 秒 | 外部 Codex／Claude 读取仓库，并依据新规则修改 `Release playbook` | Agent 不需要通过 Git Leaf，直接使用相同文件 |
| 40～53 秒 | 回到 Git Leaf，在 Sync 和文档中看到 Agent 的修改并阅读检查 | 人可以重新接管、检查和继续编辑 |
| 53～60 秒 | 产品类别、三层文案和下载入口 | Git Leaf 让 Git 知识库同时适合普通人和 AI Agent |

演示不做功能拼盘，不展示虚构的内置 AI 对话、多人实时协作或 Git diff 审批。Agent 上下文可以作为另一个短演示，
用于说明 Agent 无法直接访问仓库时如何精确移交内容。

## 下载页

### 信息架构

`https://gitleaf.mangofuture.com/download` 是普通访问者的产品／下载落地页，不触发 `git-leaf://`。它根据浏览器
语言显示英语或简体中文，也提供手动语言切换。

页面顺序：

1. 与 README 一致的产品类别、首要问题和人机协作价值；
2. 最新公开版本状态；
3. macOS 下载卡：版本、Developer ID 签名与 Apple 公证、文件大小、SHA-256；
4. Windows Preview 卡：版本、未签名警告、文件大小、SHA-256；
5. GitHub 源码与从源码运行入口；
6. “只展示明确标记为 public 的 stable 版本”说明。

`/open` 只负责启动或定位本机 Git Leaf，`/share` 只负责分享中转；两者不再承担安装包发现。README、GitHub
Homepage 和通用传播只指向 `/download`。

### 公开发布边界

下载页只读取 `stable` 中显式包含 `releaseTrack: public` 的 manifest，并验证 channel、platform、HTTPS URL、
SHA-256 和大小。它不兼容缺失轨道的旧 manifest，不读取 `internal-stable`，也不因为公开构建暂缺而回退到内部
安装包。当前没有合格公开版本时，页面应明确显示暂不可用，并保留源码入口。

## 视觉资产

现有可复用资产：

- `assets/icons/git-leaf.png`／`.icns`：App 和后续宣传物料的产品识别；
- 真实 App 的目录树、Live 编辑、Sync、Agent 上下文等现有 UI；
- `docs/mdx-lite-components-demo.zh-CN.mdx`：只用于开发和视觉回归，不作为 README 产品主图。

需要新制作：

- `marketing/assets/git-leaf-product.png`：隔离虚构知识库的 README 主图；
- 依据上述脚本录制的 30～60 秒产品演示，真正开始渠道传播时再根据渠道输出 MP4／WebM 或短 GIF；
- 如未来为 AI-native 公司制作独立 landing page，再从同一真实演示拆分公司场景版本。

## 传播原则

- 从普通用户的工作问题出发，不从功能清单或 Git 术语出发。
- 优先展示真实产品和完整工作流，不用概念图代替可试用结果。
- 针对不同渠道重新组织内容，避免原文批量复制到多个社区。
- 明确 Git Leaf 的适用边界，不制造“替代所有文档工具”的预期。
- 每项功能、数据和用户结论都关联可核验的证据。
- GitHub Stars、浏览量和点赞只作为渠道信号，最终关注真实安装、首次成功使用和持续使用。

## 开源方式

公司继续作为 Git Leaf 的维护者和官方发行者：

- 官方 macOS／Windows 安装包通过明确的公开 release track 发布；
- 公司内部构建使用独立 `internal-stable`，不进入公开下载页；
- 公司维护者身份、签名证书中的公开身份、下载域名和更新地址不属于需要隐藏的信息；
- 证书私钥、发布凭据、服务器管理权限、内部文档、个人信息和不必要的基础设施细节不得进入公开仓库；
- 本地源码构建和第三方构建必须与公司签名的官方稳定构建明确区分，不能冒充官方发行版。

Git Leaf 开源初期继续使用当前 GitHub Organization。只有项目形成真实外部参与，且 Organization 名称开始妨碍
产品认知或社区发展时，再评估迁移。即使暂时没有外部用户，公开源码仍然能够服务个人、团队和公司内部使用，并提供
代码透明度和未来的公开发行入口。
