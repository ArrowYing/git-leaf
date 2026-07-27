param(
  [string]$AppRoot = "dist/Git Leaf-win32-x64",
  [string]$RepoRoot = (Get-Location).Path,
  [string]$ScreenshotPath = "dist/windows-smoke/home.png",
  [string]$LogPath = "dist/windows-smoke/windows-smoke.log",
  [int]$TimeoutSeconds = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-SmokePath {
  param([string]$PathValue)

  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return $PathValue
  }
  return Join-Path (Get-Location).Path $PathValue
}

$appRootPath = Resolve-SmokePath $AppRoot
$repoRootPath = Resolve-SmokePath $RepoRoot
$screenshotPathValue = Resolve-SmokePath $ScreenshotPath
$logPathValue = Resolve-SmokePath $LogPath
$smokeDir = Split-Path -Parent $logPathValue
New-Item -ItemType Directory -Force -Path $smokeDir | Out-Null

function Write-SmokeLog {
  param([string]$Message)

  $line = "{0} {1}" -f (Get-Date -Format "o"), $Message
  $line | Tee-Object -FilePath $logPathValue -Append
}

function Save-DesktopScreenshot {
  param([string]$PathValue)

  $screenshotDir = Split-Path -Parent $PathValue
  New-Item -ItemType Directory -Force -Path $screenshotDir | Out-Null

  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save($PathValue, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Wait-GitLeafHealth {
  param(
    [int]$TimeoutSecondsValue,
    [string]$ExpectedInitialFile = ""
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSecondsValue)
  $lastError = ""
  while ((Get-Date) -lt $deadline) {
    foreach ($port in 4317..4336) {
      $url = "http://127.0.0.1:$port/api/health"
      try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 10
        $payload = $response.Content | ConvertFrom-Json
        if (
          $response.StatusCode -eq 200 -and
          (!$ExpectedInitialFile -or $payload.initialFile -eq $ExpectedInitialFile)
        ) {
          Write-SmokeLog "Health check passed at $url"
          return $url
        }
      } catch {
        $lastError = $_.Exception.Message
      }
    }
    Start-Sleep -Seconds 1
  }

  throw "Timed out waiting for Git Leaf health check. ExpectedInitialFile=$ExpectedInitialFile LastError=$lastError"
}

function Wait-GitLeafActiveDocument {
  param(
    [string]$ConfigPath,
    [string]$ExpectedPath,
    [int]$TimeoutSecondsValue
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSecondsValue)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $ConfigPath) {
      $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
      if ($config.preferences -and $config.preferences.workbenchSessions) {
        $activePaths = @(
          $config.preferences.workbenchSessions.PSObject.Properties |
            ForEach-Object { $_.Value.activeTabPath }
        )
        if ($activePaths -contains $ExpectedPath) {
          Write-SmokeLog "Workbench active document: $ExpectedPath"
          return
        }
      }
    }
    Start-Sleep -Milliseconds 250
  }

  throw "Timed out waiting for workbench activeTabPath=$ExpectedPath"
}

$exePath = Join-Path $appRootPath "Git Leaf.exe"
$installedRoot = Join-Path $env:LOCALAPPDATA "GitLeaf\app"
$installedExe = Join-Path $installedRoot "Git Leaf.exe"
$installedState = Join-Path $env:LOCALAPPDATA "GitLeaf\install-state.json"
$desktopConfig = Join-Path $env:APPDATA "git-leaf\desktop-config.json"
$protocolCommandKey = "Registry::HKEY_CURRENT_USER\Software\Classes\git-leaf\shell\open\command"
if (!(Test-Path -LiteralPath $exePath)) {
  throw "Missing packaged executable: $exePath"
}
if (!(Test-Path -LiteralPath $repoRootPath)) {
  throw "Missing smoke repository root: $repoRootPath"
}

$expectedVersion = (Get-Content -LiteralPath "package.json" -Raw | ConvertFrom-Json).version
$process = $null
$blockedUpgradeProcess = $null
try {
  $installParent = Split-Path -Parent $installedRoot
  if (Test-Path -LiteralPath $installParent) {
    Remove-Item -LiteralPath $installParent -Recurse -Force
  }
  Write-SmokeLog "Starting Git Leaf from $exePath"
  Write-SmokeLog "Smoke repository root: $repoRootPath"
  $process = Start-Process -FilePath $exePath -ArgumentList @("--repo", "`"$repoRootPath`"") -PassThru
  Write-SmokeLog "Started Git Leaf process: $($process.Id)"

  $healthUrl = Wait-GitLeafHealth -TimeoutSecondsValue $TimeoutSeconds
  if (!(Test-Path -LiteralPath $installedExe)) {
    throw "Git Leaf did not bootstrap to the stable per-user path: $installedExe"
  }
  if (!(Test-Path -LiteralPath $installedState)) {
    throw "Git Leaf did not write the installed version state: $installedState"
  }
  $installedVersion = (Get-Content -LiteralPath $installedState -Raw | ConvertFrom-Json).version
  if ($installedVersion -ne $expectedVersion) {
    throw "Installed version state mismatch: expected=$expectedVersion actual=$installedVersion"
  }
  if (!(Test-Path -LiteralPath $protocolCommandKey)) {
    throw "Git Leaf did not register the git-leaf protocol"
  }
  $protocolCommand = (Get-Item -LiteralPath $protocolCommandKey).GetValue("")
  if (!$protocolCommand.Contains($installedExe)) {
    throw "git-leaf protocol does not point to the stable executable: $protocolCommand"
  }
  Write-SmokeLog "Stable executable: $installedExe"
  Write-SmokeLog "Installed version: $installedVersion"
  Write-SmokeLog "Protocol command: $protocolCommand"

  $stableHashBefore = (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash
  @{ version = "0.0.0"; installedAt = (Get-Date -Format "o") } |
    ConvertTo-Json |
    Set-Content -LiteralPath $installedState -Encoding utf8
  Write-SmokeLog "Verifying that a running app blocks a manual cross-version replacement"
  $blockedUpgradeProcess = Start-Process -FilePath $exePath -PassThru
  Start-Sleep -Seconds 3
  $blockedUpgradeProcess.Refresh()
  if ($blockedUpgradeProcess.HasExited) {
    throw "The manual upgrade process exited before the running-app guard was observed"
  }
  $guardedVersion = (Get-Content -LiteralPath $installedState -Raw | ConvertFrom-Json).version
  if ($guardedVersion -ne "0.0.0") {
    throw "Manual cross-version replacement modified install state while the app was running"
  }
  $stableHashAfter = (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash
  if ($stableHashAfter -ne $stableHashBefore) {
    throw "Manual cross-version replacement modified the running stable executable"
  }
  Stop-Process -Id $blockedUpgradeProcess.Id -Force -ErrorAction SilentlyContinue
  $blockedUpgradeProcess.WaitForExit(5000) | Out-Null
  $blockedUpgradeProcess = $null
  @{ version = $expectedVersion; installedAt = (Get-Date -Format "o") } |
    ConvertTo-Json |
    Set-Content -LiteralPath $installedState -Encoding utf8
  Write-SmokeLog "Manual cross-version replacement left the stable executable unchanged"

  $deepLinkPath = "docs/notes.md"
  $encodedRepoRoot = [Uri]::EscapeDataString($repoRootPath)
  $deepLink = "git-leaf://open?repo=$encodedRepoRoot&path=docs%2Fnotes.md"
  Write-SmokeLog "Opening registered protocol deep link: $deepLinkPath"
  Start-Process -FilePath $deepLink
  $healthUrl = Wait-GitLeafHealth `
    -TimeoutSecondsValue $TimeoutSeconds `
    -ExpectedInitialFile $deepLinkPath
  Wait-GitLeafActiveDocument `
    -ConfigPath $desktopConfig `
    -ExpectedPath $deepLinkPath `
    -TimeoutSecondsValue $TimeoutSeconds
  Write-SmokeLog "Deep link opened requested document: $deepLinkPath"

  Write-SmokeLog "Starting the same package again to verify stable-app redirect"
  $redirectProcess = Start-Process -FilePath $exePath -ArgumentList @("--repo", "`"$repoRootPath`"") -PassThru
  if (!$redirectProcess.WaitForExit(15000)) {
    throw "Same-version package did not redirect to the stable app"
  }
  if ($redirectProcess.ExitCode -ne 0) {
    throw "Same-version redirect failed. ExitCode=$($redirectProcess.ExitCode)"
  }
  Write-SmokeLog "Same-version package redirected to the stable app"

  @{ version = "999.0.0"; installedAt = (Get-Date -Format "o") } |
    ConvertTo-Json |
    Set-Content -LiteralPath $installedState -Encoding utf8
  Write-SmokeLog "Starting the package with a newer installed-version marker to verify downgrade blocking"
  $outdatedProcess = Start-Process -FilePath $exePath -ArgumentList @("--repo", "`"$repoRootPath`"") -PassThru
  if (!$outdatedProcess.WaitForExit(15000)) {
    throw "Outdated package did not hand off to the newer stable app"
  }
  if ($outdatedProcess.ExitCode -ne 0) {
    throw "Outdated package handoff failed. ExitCode=$($outdatedProcess.ExitCode)"
  }
  @{ version = $expectedVersion; installedAt = (Get-Date -Format "o") } |
    ConvertTo-Json |
    Set-Content -LiteralPath $installedState -Encoding utf8
  Write-SmokeLog "Outdated package was blocked from downgrading the stable app"
  Start-Sleep -Seconds 2
  Save-DesktopScreenshot -PathValue $screenshotPathValue
  Write-SmokeLog "Saved screenshot: $screenshotPathValue"
  Write-SmokeLog "Windows smoke passed: $healthUrl"
} catch {
  Write-SmokeLog "Windows smoke failed: $_"
  try {
    Save-DesktopScreenshot -PathValue $screenshotPathValue
    Write-SmokeLog "Saved failure screenshot: $screenshotPathValue"
  } catch {
    Write-SmokeLog "Could not save failure screenshot: $_"
  }
  throw
} finally {
  if ($blockedUpgradeProcess -and !$blockedUpgradeProcess.HasExited) {
    Stop-Process -Id $blockedUpgradeProcess.Id -Force -ErrorAction SilentlyContinue
    $blockedUpgradeProcess.WaitForExit(5000) | Out-Null
  }
  if (Test-Path -LiteralPath $installedState) {
    @{ version = $expectedVersion; installedAt = (Get-Date -Format "o") } |
      ConvertTo-Json |
      Set-Content -LiteralPath $installedState -Encoding utf8
  }
  if ($process -and !$process.HasExited) {
    Write-SmokeLog "Stopping Git Leaf process: $($process.Id)"
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    $process.WaitForExit(5000) | Out-Null
  }
  Get-CimInstance Win32_Process |
    Where-Object { $_.ExecutablePath -eq $installedExe } |
    ForEach-Object {
      Write-SmokeLog "Stopping installed Git Leaf process: $($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}
