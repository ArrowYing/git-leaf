---
last_updated: 2026-07-27
---

# Go to market

[Marketing index](README.md)

## Message hierarchy

### Category

> A desktop app for Git-based knowledge bases.

Use this in the README, GitHub description, download page, and general introductions. Do not add
`company`, `team`, or `AI-native company`, and do not describe Git Leaf as the knowledge base itself.

### Primary problem

> Open and maintain your knowledge base without working directly in Git or Markdown.

This makes the ordinary-user audience explicit: adoption does not require becoming a developer or
understanding the implementation.

### Core value

> Anyone can use Git Leaf, while AI agents work with the same files directly in Git.

This highlights collaboration without implying an embedded agent chat. The current product proves that
people maintain files through the app, agents use the same repository, and both kinds of change reopen
in Git Leaf.

### Scenario campaign

> The human interface for your AI-native knowledge base.

Reserve this for campaigns, articles, and landing pages about AI-native teams, agent engineering, and
organizational knowledge. It is not the global category because personal users, open-source projects,
and teams that do not call themselves AI-native remain natural users.

## Audience

Daily users:

- people who maintain knowledge without knowing Git or Markdown;
- personal Git knowledge-base owners who want less source and terminal work;
- open-source contributors reading and updating documentation;
- small-team members sharing handbooks and operating knowledge;
- people reviewing and continuing documents changed by agents.

Adopters:

- individuals and maintainers already storing Markdown/MDX in Git;
- technical leaders who want several agents and people to share ordinary files;
- founders and platform leads developing AI-native ways of working.

AI-native small teams and companies are the lead organizational ICP because they already have a Git
knowledge source, direct agent access, and ordinary-member participation friction. Company language
belongs in scenario content, not the global definition.

## README hero

Order:

1. Product name.
2. Category, primary problem, and core value.
3. Primary macOS download, secondary Windows Preview, tertiary build-from-source link.
4. One complete real product screenshot.
5. Quiet CI and Apache 2.0 badges.

A Platform badge is redundant with the conversion links. Windows's unsigned Preview state appears at
the CTA, download page, and platform guide.

## Product screenshot

The hero visual comes from a real isolated Git Leaf app with a fictitious knowledge repository, never a
concept mockup, private company content, or development fixture.

It should prove:

- a complete desktop app and real repository identity;
- a meaningful knowledge tree and All/Favorites/Sync state;
- a readable document in Preview or Live;
- one or two local changes and the Sync action;
- Agent Context without implying embedded chat;
- no errors, debug data, personal paths, or sensitive content.

Use neutral content such as Project handbook, Decision record, and Release playbook. Keep the full-window
ratio so ordinary viewers immediately recognize a usable desktop app.

## 30–60 second demo

Use one 55-second loop, not a feature montage:

| Time | Image | Story |
| --- | --- | --- |
| 0–8 s | Open Project handbook in Git Leaf | The knowledge base is in Git, but the person sees a normal document interface |
| 8–18 s | Edit one project rule | No Markdown or terminal work |
| 18–27 s | Open Sync and synchronize | The human change enters the shared Git repository |
| 27–40 s | An external agent reads the repository and updates Release playbook | The agent uses the same files without going through Git Leaf |
| 40–53 s | Return to Git Leaf and inspect the changed document | The person can retake control and continue editing |
| 53–60 s | Category, value, and download entry | Git knowledge works for ordinary people and agents |

Do not show fictional built-in chat, real-time collaboration, or an invented diff-approval product.
Agent Context can be a separate short demonstration for handing exact source to an agent that cannot
access the repository.

## Download page

`https://gitleaf.mangofuture.com/download` is a normal product/download page and never launches
`git-leaf://`. It uses browser language with an explicit English/Simplified Chinese switch.

Order:

1. Category, primary problem, and human-agent value.
2. Latest public release status.
3. macOS version, signature/notarization, size, SHA-256, and download.
4. Windows unsigned Preview warning, version, size, SHA-256, and download.
5. Source and build-from-source entry.
6. Statement that only explicit public stable builds appear.

`/open` only launches or locates local Git Leaf; `/share` only hands off a shared document. They are
Mango Future hosted services and their metadata boundary is public documentation, not hidden product
infrastructure.

The download page accepts only `stable` manifests with explicit `releaseTrack: public` and self-
consistent channel, platform, HTTPS URL, SHA-256, size, and artifact. It never falls back to internal,
legacy, or missing-track artifacts. When no public build qualifies, it says so and keeps the source
entry.

## Assets

Reusable:

- `assets/icons/git-leaf.png` and `.icns`;
- real file tree, Live, Sync, and Agent Context UI;
- `marketing/assets/git-leaf-product.png`;
- the public [Lighthouse Garden knowledge base](https://github.com/MangoFuture1210/git-leaf-example-knowledge-base)
  for ordinary-user first-run and workflow demonstrations;
- `docs/mdx-lite-components-demo.mdx` for development and visual regression only.

Create when campaign execution begins:

- a 30–60 second MP4/WebM or short GIF following the workflow above;
- an AI-native-company cut of the same real workflow if a dedicated landing page is justified.

## Communication principles

- Begin with the ordinary user's work, not a feature list or Git vocabulary.
- Show the real product and a complete workflow.
- Adapt content to each channel rather than copy-pasting one post.
- State where Git Leaf fits and does not fit.
- Tie capabilities, metrics, and audience claims to verifiable evidence.
- Treat stars, views, and likes as channel signals; prioritize real installation and continued use.

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
