# Changelog

Git Leaf follows Semantic Versioning for its shared app version. Git tags identify source revisions;
official public artifacts, signatures, checksums, and platform availability are authoritative only on
the [Git Leaf download page](https://gitleaf.mangofuture.com/download).

## 1.13.0 — 2026-07-27

### Added

- English architecture, MDX-lite, analytics, and marketing documentation as the single maintainer-facing
  source.
- A concise build-from-source guide for Community Builds.
- Bilingual disclosure for the metadata sent through Mango Future hosted `/open` and `/share` handoff
  services.
- A bilingual Windows Preview installation and security guide.
- A public example knowledge repository for first-run evaluation.

### Changed

- Community packages now use `org.gitleaf.community` on macOS and `Git Leaf Community` publisher metadata
  on Windows instead of Mango Future's official package identity.
- Non-official packages are labeled `Community build` in the app.

### Security

- Updated the development dependency lock to resolve the high-severity `brace-expansion` denial-of-
  service advisory. Production dependencies were not affected.

## 1.12.3 — 2026-07-26

- Removed the privileged macOS update-helper path and enforced direct application-content replacement.
- Added release verification for the signed package, nonprivileged policy, and Profile/ShipIt cleanup.
- Improved sidebar views, Favorites, Sync guidance, keyboard shortcuts, per-tab navigation, tooltips, and
  English/Simplified Chinese UI.
- Compatibility: preserves the existing Git Leaf Profile and repository/workbench state. Official
  public availability remains separate from the source tag.

## 1.11.4 — 2026-07-24

- Strengthened document sharing, remote revision verification, fetch recovery, and navigation behavior.
- Added stronger Windows GitHub Actions evidence and retained-artifact gates to the formal release flow.
- Compatibility: an official internal-track release; no GitHub binary release is attached to the tag.

## 1.11.3 — 2026-07-24

- Introduced the explicit internal release track and the one-time compatibility bridge for earlier
  official installations.
- Compatibility: migration release for official `1.11.2` installations; not a public Community Build.

## Verification and compatibility

- macOS official packages are Developer ID signed and notarized; verify the status and SHA-256 on the
  download page.
- Windows is an unsigned Preview; verify SHA-256 before running it.
- Community Builds are unsigned, do not use official update feeds, and must not be presented as Mango
  Future releases.
- App updates preserve repository configuration and workbench state unless a release note explicitly
  states a migration boundary.
