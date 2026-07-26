---
name: git-leaf-release
description: Executes and diagnoses Git Leaf development installs, source packages, and formal public or internal releases. Use when packaging, publishing, updating, re-releasing, changing the release version, inspecting release status, or verifying a final macOS packaged-App update.
---

# Git Leaf Release

1. Resolve the active Git Leaf repository with `git rev-parse --show-toplevel`.
2. Read the repository `AGENTS.md` and `docs/release.md` completely before changing, packaging, or publishing anything.
3. Treat `docs/release.md` as the sole release policy and `scripts/release-worktree.mjs` as the formal state machine. Do not duplicate their procedure in this skill.

## Route the request

- Human development install: use the development-install route in `AGENTS.md` and preserve the real Profile.
- Agent UI verification: use the isolated smoke route in `AGENTS.md`.
- Source package: use the source-package section of `docs/release.md`; never describe it as an official release.
- Formal public or internal release: follow `docs/release.md` through the controller, using only an explicitly supplied or environment-specific approved profile.
- Status or diagnosis: inspect controller state without mutating a release channel.

## Guard execution

- Apply only the authorization and pause conditions defined in `docs/release.md`.
- Resume failures from recorded controller state. Never bypass a gate or reconstruct release and update steps by hand.
- Run the packaged-App update harness only when the frozen controller requires it; never substitute privileged Helper, password, or manual ShipIt actions.
- Report the controller-backed state and distinguish development, source, candidate, and completed stable outcomes.
