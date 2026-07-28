---
last_updated: 2026-07-28
---

# Why Git Leaf instead of VS Code or Obsidian?

[Marketing index](README.md)

## Start with the obvious alternatives

When a team uses a Git repository as the knowledge and context base for AI agents, the obvious human
interfaces are VS Code and Obsidian. Git Leaf has to justify why a separate app should be another
option.

The answer cannot be that other tools are unable to open Markdown or work with Git:

- VS Code has built-in graphical Git support for diffs, staging, commits, branches, conflicts, remotes,
  and worktrees. It is already the stronger interface when a person wants complete repository control.
  See the official [VS Code source-control documentation](https://code.visualstudio.com/docs/sourcecontrol/overview).
- Obsidian stores a Vault as ordinary Markdown files in a local folder, accepts an existing folder, and
  reloads external file changes. See [How Obsidian stores data](https://obsidian.md/help/Files%2Band%2Bfolders/How%2BObsidian%2Bstores%2Bdata).
  The community [Obsidian Git plugin](https://community.obsidian.md/plugins/obsidian-git) can also pull,
  push, commit, show history, and display diffs.

Git Leaf therefore should not claim that Obsidian cannot use Git, that VS Code requires a terminal, or
that ordinary files alone make Git Leaf unique. A Git-backed Markdown repository can work in either
tool.

## The missing role

The product becomes meaningful when the repository is not primarily a software project or a personal
note garden. It is durable shared context that agents, developers, and automation use directly:

- instructions and skills that guide agent work;
- decisions, plans, product context, and operating rules;
- knowledge and reference material;
- playbooks and checklists that people and agents are expected to follow.

The people responsible for the correctness of this context are often product managers, operators,
researchers, policy owners, managers, or other domain experts. They need to understand and correct what
an agent relies on or has changed, but their job is not to operate a developer environment.

This creates the product gap:

> Agents and developers can work directly in Git. The rest of the team needs a readable, focused way
> to inspect and correct the same repository.

The repository does not depend on Git Leaf. Agents do not need to pass through Git Leaf. Git Leaf exists
so that the people accountable for the context can participate without adopting the interface and
working model of a developer.

## When each tool is the right choice

### Choose VS Code

Use VS Code when the people maintaining the repository are comfortable with developer tools and want
direct control of diffs, staging, commits, branches, conflicts, code, terminals, and agent extensions.
Git Leaf should not compete for this job. Reducing the available controls would be a disadvantage for
these users.

### Choose Obsidian

Use Obsidian when the Vault is the center of the work: people primarily capture and author notes,
organize links, use backlinks and graph exploration, and extend the system through plugins. The Vault
can itself be stored in Git, and doing so does not inherently create a second copy of the Markdown
content.

Git Leaf should not compete as a more general note-taking or personal-knowledge tool. Obsidian is the
more natural choice when Git is mainly a way to sync or back up a human-centered Vault.

### Choose Git Leaf

Use Git Leaf when all of the following are true:

1. A Git repository is the durable shared context source for a team and its agents.
2. Agents, developers, and automation need to keep using the repository directly.
3. The people responsible for its meaning and correctness do not all use developer tools.
4. Their primary job is to read, inspect, hand back exact context, and make focused corrections rather
   than build a note system or control Git history.
5. The team wants one deliberate human path for synchronization and publication instead of assembling
   a Vault, plugins, and Git conventions for every participant.

Git Leaf is not mandatory in every Git-backed context workflow. It is a justified option when this role
split is real.

## Why a dedicated app changes the workflow

### Role-specific defaults

VS Code opens a repository as a development environment. Obsidian opens a folder as a Vault. Git Leaf
opens the repository as readable team and agent context.

The first visible actions are therefore a directory tree, search, readable Preview, changed files, and
focused editing. Staging areas, commit-message fields, terminals, extension marketplaces, backlinks,
and graph views do not define the daily task.

### One source, several interfaces

Git Leaf does not ask agents or developers to adopt a new content service. They continue to use the
same paths, files, branches, revisions, and repository instructions through their existing tools.
People use a different interface without introducing a second authoritative copy.

Obsidian can also preserve ordinary files, so file portability alone is not the distinction. The
difference is the center of gravity: Git Leaf treats the existing repository and its external agent
activity as primary rather than asking the repository to become a Vault-centered knowledge system.

### A source-backed human-agent handoff

A person can read a rendered document, select exact source-backed lines, and export repository-relative
Agent Context. An external agent can then work from those paths and lines in the original repository.
The human return path stays attached to the source rather than becoming a pasted excerpt in a separate
knowledge product.

### Constrained publication

Git Leaf does not try to expose every Git operation. It can bring in remote changes conservatively,
preserve unfinished local edits, and keep publication intentional. The daily user should not need to
choose a staging strategy, write a commit message, or resolve history from inside the document
interface. When Git cannot proceed safely, the app stops instead of hiding the underlying problem.

This constraint is part of the product value. It gives non-developers an expected path rather than a
smaller imitation of a full Git client.

### A team default rather than a personal assembly

Obsidian plus a Git plugin can cover much of the same technical territory. The organizational
difference is whether every participant is expected to configure and understand that assembly, or
whether the team offers one purpose-built interface with the same synchronization and publication
semantics for its non-developer members.

Git Leaf currently simplifies daily repository participation; it does not eliminate initial repository
checkout, Git installation, authentication, or maintainer setup. Marketing must not describe it as a
zero-configuration collaboration service.

## The product proof

The current product supports important parts of this argument:

- a familiar repository tree and search instead of a developer project surface;
- readable Preview and source-backed Source and Live modes;
- external tools changing the same ordinary files;
- exact line selections exported as portable Agent Context;
- Sync showing changed files and remote state;
- deliberate synchronization and publication.

The central loop is:

1. an agent changes repository context;
2. a person returns to Git Leaf and reads the affected document;
3. the person makes a focused correction or hands exact context back to the agent;
4. the agent updates the same files;
5. the person returns again and intentionally publishes any human change.

## The most important unfinished proof

Git Leaf does not yet provide a formal diff-review or approval system, agent attribution, or run
history. Sync identifies affected files and remote state, but the app still needs a clearer
human-readable way to understand exactly what changed in a context document.

This matters because VS Code already has a strong diff workflow, and the Obsidian Git plugin also
offers diffs and history. If Git Leaf cannot make the human return path clearer than opening the final
document and finding the change manually, it remains a convenient simplified reader rather than a
compelling third option.

The highest-value product direction is therefore not broader editing. It is readable change
inspection:

- enter an affected document from Sync at the relevant section;
- understand before and after without reading a code-oriented diff;
- preserve paths, lines, and revisions so a concern can be handed back precisely;
- keep publication explicit after the person understands the result.

This does not require claiming agent authorship or building a GitHub-style approval system. It requires
making “the agent changed context; a responsible person came back to understand it” the clearest path
through the product.

## Audience meaning

`For ordinary people` should not mean every person who keeps personal notes. In this positioning it
means ordinary members of a repository-native team: people with domain responsibility who should not
need professional Git, Markdown, or IDE skills for their daily participation.

The adopter may still be a technical leader or repository maintainer. The daily user can be a product,
operations, research, policy, support, or management colleague. This adopter-user distinction is
essential to both product design and distribution.

## Message to carry forward

The concise reason to choose Git Leaf is:

> Keep agent context in Git, and let the rest of the team inspect and correct it.

The longer comparison is:

> Use VS Code when everyone working in the repository is comfortable with developer tools. Use
> Obsidian when the Vault and its note-taking system are the center of the work. Use Git Leaf when the
> team's shared agent context already lives in Git, but the people responsible for it need a readable,
> focused way to inspect and correct the same files.

This argument should appear in articles, launch material, and the explanatory part of the website. The
README should carry only the short choice boundary rather than reproducing the full case.
