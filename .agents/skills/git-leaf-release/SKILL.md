---
name: git-leaf-release
description: Executes and diagnoses Git Leaf development installs, source packages, and formal public or internal releases. Use when packaging, publishing, updating, re-releasing, changing the release version, inspecting release status, or verifying a final macOS packaged-App update.
---

# Git Leaf Release

## Load repository authority

1. Resolve the active Git Leaf repository with `git rev-parse --show-toplevel`.
2. Read the repository `AGENTS.md` and `docs/release.md` completely before changing, packaging, or publishing anything.
3. Treat `docs/release.md` as policy and `scripts/release-worktree.mjs` as the formal release state machine. Keep command details in those sources instead of copying their catalog into this skill.
4. Treat the frozen commit and profile, signed artifacts, published manifests, workflow evidence, required local macOS harness evidence, remote tag, and retained release receipt as delivery authority.

This repository-owned skill is a public orchestration entry point. Machine-specific extensions may locate an approved release profile or verify local prerequisites, but they must not override repository policy, controller gates, or evidence requirements.

## Classify the request

- For a development install used by a person, follow the repository development-install command and preserve the real human Profile.
- For Agent-driven UI verification, use the isolated development smoke defined by `AGENTS.md`; never automate the production Profile.
- For an unsigned source package, use the ordinary platform package command and identify the result as a source build, not an official release.
- For a formal public or internal release, use the frozen release controller from preparation through candidate, stable, tag, and finish.
- For status or diagnosis, inspect controller state and immutable evidence without mutating release channels.

Source builds and development installs do not require company-private release inputs. A formal official release requires an absolute profile path supplied by the maintainer or an environment-specific extension. Validate that profile through the repository controller; do not invent a replacement, search unrelated private locations, or copy private configuration into this repository.

## Execute a formal release

1. Synchronize clean `main` with `origin/main` and apply the requested semantic-version scope from `docs/release.md`.
2. Use `release:prepare` to freeze the track, version, commit, build identity, and approved profile before building.
3. Run build, candidate publication, verification, stable publication, tag, and finish stages only through `scripts/release-worktree.mjs`.
4. After a failure, use controller status to resume from recorded state. Do not bypass a gate, reconstruct state from memory, or substitute manually assembled publishing commands.
5. Treat an explicit request for a formal release as standing authorization for the documented workflow. Pause only for an ambiguity or action outside the authorization boundary defined in `docs/release.md`.

Keep ordinary packaging detail inside the existing scripts. Expand the diagnosis only when a concrete failure requires it.

## Run the macOS update gate only when required

The controller's frozen risk assessment decides whether update regression is required. This gate verifies installation mechanics and cleanup; it is not a feature-by-feature UI regression and must not run after every release.

When required:

1. Complete and verify candidate publication first.
2. Ensure the installed Git Leaf App is closed before starting the harness.
3. Run `npm run release:verify-update:mac` inside the frozen worktree with its frozen track, version, and commit.
4. Let the harness own its temporary App, HOME, Profile, ShipIt state, and `finally` cleanup. Do not recreate those steps by hand.
5. Record only the generated JSON through the controller's `verify-macos-update-regression --evidence FILE` command.
6. Require proof that the final signed package installed under a non-writable parent, preserved the App directory inode, carried the nonprivileged-only updater policy, created no privileged ShipIt job, and left the real Profile and real ShipIt cache unchanged.

Never launch or authorize a privileged upgrade Helper, request an account password for the regression, or boot out an unrelated ShipIt job. Never use a removed manual evidence marker.

## Finish and report

Finish only after the stable manifests and artifacts, required Windows workflow evidence, any required local macOS update evidence, remote tag, and retained release receipt all agree with the frozen commit.

Report the version, track, commit, stable channels, tag, retained receipt, and any gate that genuinely blocked completion. Do not report a development install, source package, candidate publication, or observed notarization progress as a completed formal release.
