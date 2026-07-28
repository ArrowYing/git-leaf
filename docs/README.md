# Git Leaf documentation

The repository root contains the standard open-source entry points: `README.md`, `LICENSE`,
`CONTRIBUTING.md`, `SECURITY.md`, and `CHANGELOG.md`. Maintainer-facing technical documents use English
as their single source. End-user documents may add a `.zh-CN` counterpart where a second language
materially improves installation, privacy, or product use.

## Documentation map

| Topic | Document | Audience and authority |
| --- | --- | --- |
| Product overview | [README](../README.md) · [简体中文](../README.zh-CN.md) | User-facing product entry |
| Changes and compatibility | [Changelog](../CHANGELOG.md) | Version changes, verification, compatibility |
| Build from source | [Community Build guide](build-from-source.md) | Contributors and third-party builders |
| System architecture | [Architecture](architecture.md) | Cross-module behavior and invariants |
| MDX-lite reference | [Reference](mdx-lite-guide.md) | Syntax, allowlist, and renderer contract |
| MDX-lite demo | [Demo](mdx-lite-components-demo.mdx) | Development and visual regression fixture |
| Public example context repository | [Lighthouse Garden](https://github.com/MangoFuture1210/git-leaf-example-knowledge-base) | User-facing first-run content |
| Hosted link privacy | [Hosted links](hosted-links.md) · [简体中文](hosted-links.zh-CN.md) | End-user metadata disclosure |
| Windows Preview | [English](windows-portable-guide.md) · [简体中文](windows-portable-guide.zh-CN.md) | Installation and security guidance |
| Usage analytics | [Specification](app-usage-analytics-spec.md) | Normative event, privacy, and metric contract |
| Official release | [Release process](release.md) | Mango Future maintainer workflow |

Repository-specific agent rules remain in [AGENTS.md](../AGENTS.md). Contribution and vulnerability
reporting guidance remain in [CONTRIBUTING.md](../CONTRIBUTING.md) and
[SECURITY.md](../SECURITY.md).

The public example repository and this source repository are intentionally complementary. User-facing
sample content belongs in the example repository; technical contracts, release schemas, and executable
test fixtures stay here. Do not mirror the complete MDX-lite reference or regression fixture into the
example context repository.
