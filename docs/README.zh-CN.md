# Git Leaf 文档

[English](README.md) | 简体中文

按照开源项目的常见结构，仓库根目录只保留需要第一时间看到的社区入口和治理文件：
`README.md`、`LICENSE`、`CONTRIBUTING.md` 与 `SECURITY.md`。详细架构、操作指南、参考资料和规范统一放在
本目录。

## 语言约定

- 无语言后缀的文件名只用于英文版，例如 `release.md`。
- 简体中文在扩展名前使用 `.zh-CN`，例如 `architecture.zh-CN.md`。
- 已有翻译的入口文档需要互相提供语言切换链接。
- 只有一个语言版本时，非英文文档仍保留明确的语言后缀，不把它伪装成英文默认版。
- 翻译不得改变原文的权威性、安全边界和验收门槛。

这套约定保证 GitHub 和安装包的默认入口使用英文，同时如实呈现尚未提供英文翻译的规范文档。

## 文档地图

| 主题 | English | 简体中文 | 权威边界 |
| --- | --- | --- | --- |
| 项目概览 | [README](../README.md) | [README](../README.zh-CN.md) | 用户可见的产品入口 |
| 系统架构 | — | [系统架构](architecture.zh-CN.md) | 跨模块行为与架构不变量 |
| MDX-lite 参考 | — | [渲染器参考](mdx-lite-guide.zh-CN.md) | 语法、白名单和渲染契约 |
| MDX-lite Demo | — | [组件 Demo](mdx-lite-components-demo.zh-CN.mdx) | 开发和视觉回归 fixture |
| 发布流程 | [Release process](release.md) | — | 正式发布流程 |
| Windows Preview | [Windows Preview](windows-portable-guide.md) | — | 安装、更新和安全说明 |
| 使用统计 | — | [使用统计规范](app-usage-analytics-spec.zh-CN.md) | 事件、隐私和指标唯一口径 |

Agent 的仓库规则继续维护在 [AGENTS.md](../AGENTS.md)；贡献和漏洞报告说明继续维护在
[CONTRIBUTING.md](../CONTRIBUTING.md) 与 [SECURITY.md](../SECURITY.md)。
