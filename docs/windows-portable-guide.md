# Git Leaf Windows Preview

Git Leaf for Windows is currently distributed as an unsigned self-installing ZIP. It does not use Microsoft Store, MSI, or MSIX, and it does not require administrator access.

Because the executable is not Authenticode-signed, Windows can show an unknown publisher or SmartScreen warning. Download it only from the official Git Leaf page, verify the published SHA-256, and do not bypass a warning for a file received through another channel.

## Requirements

- Windows 10 or Windows 11;
- Git available through `git --version`;
- a local clone of the Git repository you want to open.

## Install

1. Open `https://gitleaf.mangofuture.com/download#windows`.
2. Download `GitLeaf-<version>-public-win32-x64.zip`.
3. Compare the ZIP's SHA-256 with the checksum published for that release.
4. Fully exit an older Git Leaf process.
5. Extract the whole ZIP. Do not run the executable from the archive preview.
6. Open `Git Leaf-win32-x64` and run `Git Leaf.exe`.
7. Git Leaf copies the complete app into `%LOCALAPPDATA%\GitLeaf\app`, creates the Start Menu shortcut, and relaunches from the fixed location.
8. Choose a local Git repository.

Electron applications require the complete directory. Do not copy only `Git Leaf.exe`.

## Updates

Only Mango Future official builds connect to the official update service. Public builds follow `stable`; company-internal builds follow `internal-stable`. A packaged build trusts its embedded track, so an environment variable cannot move it between the two. A source build shows its source identity in Settings and does not query or download from that service.

An official Windows build checks for metadata but does not download an update until the user selects Update. The app verifies the ZIP's file size and SHA-256, prepares the next version in a temporary directory, waits for the current process to exit, then atomically switches the fixed install directory. If the new version cannot start and confirm readiness, the installer attempts to restore the previous version.

Updates do not change an existing local `usageAnalyticsEnabled` setting.

## Source build

From a checkout with Node.js 22 or newer:

```powershell
npm ci
npm run package:win
```

The resulting package is a `source` distribution. It is unsigned, does not use official updates, and starts with usage analytics disabled.

## Deep links

Git Leaf registers the `git-leaf://` protocol from its fixed installation:

```powershell
Start-Process 'git-leaf://open'
Start-Process 'git-leaf://open?repo=C%3A%5CUsers%5Cexample%5CProjects%5Ccompany-docs&path=docs%2Fstrategy.md'
```

`repo` is a URL-encoded local repository path. `path` is a repository-relative Markdown or MDX path. HTTPS share links use a GitHub `owner/repo` identity and do not transmit a recipient's local path or document content.

## Uninstall

Exit Git Leaf, then remove:

- `%LOCALAPPDATA%\GitLeaf`;
- the Git Leaf shortcut under the current user's Start Menu.

User preferences are stored separately under Electron userData. Back them up or remove them according to your own data-retention needs.

## Reporting problems

For security issues, follow [SECURITY.md](../SECURITY.md). For ordinary bugs, open a GitHub issue and include the Git Leaf version, build identity, Windows version, installation source, and minimal reproduction steps. Do not attach private repository content or personal paths.
