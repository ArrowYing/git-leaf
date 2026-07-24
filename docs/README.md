# Git Leaf documentation

English | [简体中文](README.zh-CN.md)

The repository root contains the files people expect to find immediately in an open-source project:
`README.md`, `LICENSE`, `CONTRIBUTING.md`, and `SECURITY.md`. Detailed architecture, operating guides,
reference material, and normative specifications live in this directory.

## Language convention

- The unsuffixed file name is reserved for the English version, for example `release.md`.
- Simplified Chinese uses `.zh-CN` before the extension, for example `architecture.zh-CN.md`.
- Every translated entry page links to the other available language.
- A document that is available in only one language keeps an explicit locale suffix unless it is English.
- A translation must preserve the source document's authority, security boundaries, and acceptance gates.

This convention makes English the default GitHub and package entry point without implying that an
English translation already exists for every normative document.

## Documentation map

| Topic | English | 简体中文 | Authority |
| --- | --- | --- | --- |
| Project overview | [README](../README.md) | [README](../README.zh-CN.md) | User-facing product entry point |
| System architecture | — | [Architecture](architecture.zh-CN.md) | Cross-module behavior and invariants |
| MDX-lite reference | — | [Reference](mdx-lite-guide.zh-CN.md) | Syntax, whitelist, and rendering contract |
| MDX-lite demo | — | [Demo](mdx-lite-components-demo.zh-CN.mdx) | Development and visual regression fixture |
| Release process | [Release process](release.md) | — | Official release workflow |
| Windows Preview | [Windows Preview](windows-portable-guide.md) | — | Installation, update, and security guidance |
| Usage analytics | — | [Specification](app-usage-analytics-spec.zh-CN.md) | Normative event, privacy, and metric contract |

Repository-specific agent rules remain in [AGENTS.md](../AGENTS.md). Contribution and vulnerability
reporting guidance remain in [CONTRIBUTING.md](../CONTRIBUTING.md) and [SECURITY.md](../SECURITY.md).
