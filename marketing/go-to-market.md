---
last_updated: 2026-07-28
---

# Go to market

[Marketing index](README.md)

## Message hierarchy

### Category

> A desktop interface for Git repositories used as shared context by teams and AI agents.

Use the descriptive sentence in the README, GitHub description, download page, and general
introductions. It says what Git Leaf is without claiming to be the repository, an agent runtime, or a
hosted context service.

### Tagline

> One repository for agents. A familiar interface for people.

This is the shortest expression of the product model. Do not use it alone on a surface where the Git
repository and shared-context meaning have not yet been introduced.

### Primary problem

> Agents can work directly in the repository, but the rest of the team needs a readable and safe way to
> participate.

This is not a generic Markdown-editing problem. It appears when repository-native agent work becomes
important while domain experts, operators, product owners, or managers should not need an IDE or Git
commands.

### Competitive question

> If a Git repository is already the knowledge and context base for AI agents, why not use VS Code or
> Obsidian?

This question should be answered directly rather than through a feature checklist:

- VS Code is the better choice when everyone responsible for the repository is comfortable with
  developer tools and wants complete Git control.
- Obsidian is the better choice when a Vault and its human note-taking, linking, and plugin system are
  the center of the work, even if Git is used for synchronization.
- Git Leaf is the option when agents work directly in the repository but the people responsible for
  its meaning and correctness need a readable, focused way to inspect and correct the same files.

The campaign argument is not that VS Code or Obsidian lack Git capabilities. It is that neither tool
defaults to the role Git Leaf serves: the non-developer human return path into a repository maintained
with agents.

Use the short expression:

> Keep agent context in Git, and let the rest of the team inspect and correct it.

The complete competitive reasoning and the current product gap are in
[Why Git Leaf instead of VS Code or Obsidian?](why-git-leaf.md).

### Core value

> AI agents work directly in Git. People use Git Leaf to read, inspect, and make focused edits.

This preserves the division of work. `Inspect` means opening and understanding affected files; it does
not imply formal diff review, approval, or agent attribution.

### Campaign tagline

> The human interface for the repository your agents work from.

Use this in agent-native articles, launch material, and focused landing pages after the descriptive
category sentence has established the product boundary.

### GitHub description

> Human interface for Git repositories used as shared context by teams and AI agents.

## Audience

Adopters:

- technical leaders establishing repository-native agent workflows;
- AI-platform and automation leads who want durable context outside one agent client;
- repository maintainers responsible for instructions, architecture, decisions, and operating rules;
- project leaders who need non-developers to inspect and correct agent-facing context.

Daily users:

- domain experts reading a document that an agent relies on or changed;
- product, operations, research, policy, and management staff;
- small-team and open-source contributors using the repository through a document interface;
- knowledge owners handing precise corrections back to an external agent.

The primary ICP is a team of any size whose agents already read or modify a Git repository and whose
human participants do not all work in developer tools. AI-native teams are the clearest campaign
segment, but `company` and `AI-native company` are scenario language rather than the global category.

## README hero

Order:

1. Product name.
2. Category sentence, tagline, and one supporting value sentence.
3. Primary macOS download, secondary Windows Preview, tertiary build-from-source link.
4. One complete real product screenshot showing the shared context repository from the human side.
5. Quiet CI and Apache 2.0 badges.

The first screen should make three facts visible without requiring the reader to infer them:

- the source of truth is a Git repository;
- agents use that repository directly;
- Git Leaf is the readable human interface.

## Product screenshot

Use a real isolated Git Leaf app with a fictitious shared context repository, never a concept mockup,
private company content, or development fixture.

The complete window should show:

- a repository name that reads as shared project context rather than a note garden;
- visible paths such as `AGENTS.md`, `context/`, `decisions/`, `playbooks/`, and `projects/`;
- Preview as the active mode on a readable context document;
- one or two local changes in Sync;
- Agent Context with one exact selection;
- no fictional chat, agent attribution, diff approval, errors, personal paths, or sensitive content.

The document itself should explain what the team and its agents need to know. This proves the positioning
more directly than a generic handbook screenshot.

## 30–60 second demo

Use one agent-first loop, not a feature montage:

| Time | Image | Story |
| --- | --- | --- |
| 0–8 s | An external agent opens the repository and follows its context entry point | The repository exists for agent work |
| 8–18 s | The agent updates a decision or playbook | The agent changes ordinary Git files directly |
| 18–30 s | A team member opens the affected document in Git Leaf Preview | The human side is readable and does not require an IDE |
| 30–40 s | The person selects exact lines and copies Agent Context | Human judgment returns to the external agent with a precise source location |
| 40–50 s | The external agent updates the same file | No content is imported or copied into another knowledge system |
| 50–57 s | The person returns, inspects the result, and makes one focused Live edit | Git Leaf is the human continuation surface |
| 57–60 s | Category, tagline, and download entry | One repository for agents; a familiar interface for people |

Do not show fictional built-in chat, automatic model-context injection, real-time collaboration, agent
authorship, or a formal approval workflow.

## Download page

`https://gitleaf.mangofuture.com/download` remains a normal product/download page and never launches
`git-leaf://`. It uses browser language with an explicit English/Simplified Chinese switch.

Order:

1. Category, tagline, and human-interface value.
2. Latest public release status.
3. macOS version, signature/notarization, size, SHA-256, and download.
4. Windows unsigned Preview warning, version, size, SHA-256, and download.
5. Source and build-from-source entry.
6. Statement that only explicit public stable builds appear.

`/open` only launches or locates local Git Leaf; `/share` only hands off a shared document. They are
Mango Future-hosted services and their metadata boundary remains public documentation.

The download page accepts only `stable` manifests with explicit `releaseTrack: public` and
self-consistent channel, platform, HTTPS URL, SHA-256, size, and artifact. It never falls back to
internal, legacy, or missing-track artifacts.

## Public example repository

The public example should demonstrate a fictitious team context repository rather than a generic note
collection. Its primary path should contain:

- a short `AGENTS.md` that routes agents to deeper context;
- a human-readable README explaining the same repository;
- product or project context;
- decisions and playbooks;
- one structured visual document as a secondary capability proof.

The example repository owns this natural first-run content. The main Git Leaf repository retains only
development fixtures, schemas, and product documentation; the two repositories should remain
complementary rather than mirrored.

## Assets

Reusable:

- `assets/icons/git-leaf.png` and `.icns`;
- the real file tree, Preview, Live, Sync, and Agent Context UI;
- `marketing/assets/git-leaf-product.png`, captured from an isolated real workspace with `team-context`,
  two local changes, and one source-backed Agent Context selection;
- `marketing/assets/git-leaf-mdx-chart.png` as a secondary proof that agent-readable text can remain
  visually readable for people;
- `docs/mdx-lite-components-demo.mdx` for development and visual regression only.

Create when campaign execution begins:

- a 30–60 second MP4/WebM or short GIF following the agent-first workflow;
- channel-specific cuts that begin with the role relevant to that audience.

## Communication principles

- Begin with the shared repository and human-agent division of work, not a feature list.
- Answer why a separate app is useful without understating what VS Code or Obsidian can already do.
- Show real agent use outside Git Leaf and real human use inside Git Leaf.
- Use `read`, `inspect`, `hand back context`, and `focused edit` for the human role.
- Do not call Git Leaf a knowledge base, context engine, agent runtime, or review system.
- State current boundaries wherever an audience might otherwise infer retrieval, MCP, chat, or approval.
- Tie capabilities and audience claims to real product evidence.

## Open-source distribution

Mango Future remains the maintainer and official publisher:

- official packages use explicit public or internal release tracks;
- internal builds never appear on the public download page;
- the public maintainer name, certificate identity, download domain, and update domain are not secrets;
- credentials, private keys, server administration, internal documents, personal data, and unnecessary
  infrastructure details stay outside the public repository;
- Community Builds and third-party packages use a distinct package identity and cannot impersonate a
  Mango Future official build.

Continue using the current GitHub organization until real external participation demonstrates that the
organization name impedes product recognition or community development.
