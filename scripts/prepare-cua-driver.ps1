param(
  [string]$InstallerPath,
  [string]$ModulePath,
  [string]$ArchivePath
)

$ErrorActionPreference = 'Stop'
$expectedVersion = '0.28.2'
$installerUri = 'https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.28.2/install.ps1'
$installerSha256 = '3e770fa8c351b80db99ae6b080f696a22f844534498bf44d45816cbd05eb0c3f'
$moduleUri = 'https://raw.githubusercontent.com/trycua/cua/cua-driver-rs-v0.28.2/libs/cua-driver/scripts/_install-common.psm1'
$moduleSha256 = '324bca98ad19f0487d4afd36a9e2d06478fcfb8e1e20225cdd8ec8ef5150e720'
$archiveSha256 = '3c1fcf10ff9513b94e4af78ad6a216ab62aa95b2c9a3b70dfbdba9f04e021533'
$downloadHelper = (Resolve-Path (Join-Path $PSScriptRoot 'download-url.mjs')).Path
$driver = Join-Path $env:LOCALAPPDATA 'Programs\Cua\cua-driver\bin\cua-driver.exe'
if (-not (Test-Path -LiteralPath $driver)) { throw "Existing Cua Driver was not found: $driver" }

$beforeVersion = (& $driver --version 2>&1 | Out-String).Trim()
$beforeAutostart = (& $driver autostart status 2>&1 | Out-String).Trim()
$beforeTelemetry = (& $driver telemetry status 2>&1 | Out-String).Trim()
$beforeStatus = (& $driver status 2>&1 | Out-String).Trim()
$beforeDaemonPid = $null
if ($beforeStatus -match '(?im)^\s*pid:\s*(\d+)\s*$') {
  $beforeDaemonPid = [int]$Matches[1]
}
$wasRegistered = $beforeAutostart -match '(?im)^registered\b'
$wasRunning = $beforeAutostart -match '(?im)\brunning\b'
$wasTelemetryEnabled = $beforeTelemetry -match '(?im)^Telemetry:\s*enabled\b'
$wasTelemetryDisabled = $beforeTelemetry -match '(?im)^Telemetry:\s*disabled\b'

if ($beforeVersion -eq "cua-driver $expectedVersion") {
  Write-Output "Cua Driver is already exactly $expectedVersion"
  exit 0
}

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$installerDir = Join-Path $tempRoot ("dsh-cua-installer-$([Guid]::NewGuid().ToString('N'))")
New-Item -ItemType Directory -Path $installerDir | Out-Null
$installerFile = [IO.FileInfo]::new((Join-Path $installerDir 'install.ps1'))
$moduleFile = [IO.FileInfo]::new((Join-Path $installerDir '_install-common.psm1'))
try {
  # Node uses its own TLS stack; this avoids intermittent Windows PowerShell
  # Schannel EOFs while preserving the hash check below as the trust boundary.
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
    & $node $downloadHelper $installerUri $installerFile.FullName
    if ($LASTEXITCODE -ne 0) { throw "Pinned installer download failed with Node exit code $LASTEXITCODE" }
  } else {
    $resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
    Copy-Item -LiteralPath $resolvedInstaller -Destination $installerFile.FullName
  }
  $actualHash = (Get-FileHash -LiteralPath $installerFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $installerSha256) {
    throw "Pinned installer hash mismatch: expected $installerSha256, got $actualHash"
  }

  if ([string]::IsNullOrWhiteSpace($ModulePath)) {
    & $node $downloadHelper $moduleUri $moduleFile.FullName
    if ($LASTEXITCODE -ne 0) { throw "Pinned installer module download failed with Node exit code $LASTEXITCODE" }
  } else {
    $resolvedModule = (Resolve-Path -LiteralPath $ModulePath).Path
    Copy-Item -LiteralPath $resolvedModule -Destination $moduleFile.FullName
  }
  $actualModuleHash = (Get-FileHash -LiteralPath $moduleFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualModuleHash -ne $moduleSha256) {
    throw "Pinned installer module hash mismatch: expected $moduleSha256, got $actualModuleHash"
  }

  # The verified official installer uses Windows PowerShell's Schannel-backed
  # Invoke-WebRequest for the release ZIP. On this host that transport can hang
  # forever at zero bytes. Replace exactly that one transport statement; all
  # official version resolution, archive verification, daemon cleanup, junction
  # switching, autostart registration and rollback retention remain unchanged.
  $installerText = [IO.File]::ReadAllText($installerFile.FullName)
  $downloadNeedle = 'Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing'
  if (($installerText.Split(@($downloadNeedle), [StringSplitOptions]::None).Length - 1) -ne 1) {
    throw 'Verified installer download seam changed; refusing to patch or execute it'
  }
  $escapedHelper = $downloadHelper.Replace("'", "''")
  # The official installer already owns a three-attempt retry loop, so its
  # transport helper performs exactly one streaming attempt per outer attempt.
  $downloadReplacement = "if (`$env:DSH_TUI_CUA_ARCHIVE) { Copy-Item -LiteralPath `$env:DSH_TUI_CUA_ARCHIVE -Destination `$zipPath } else { & node.exe '$escapedHelper' `$url `$zipPath 1; if (`$LASTEXITCODE -ne 0) { throw 'Node TLS release download failed' } }"
  $installerText = $installerText.Replace($downloadNeedle, $downloadReplacement)
  [IO.File]::WriteAllText($installerFile.FullName, $installerText, [Text.UTF8Encoding]::new($false))

  $savedVersion = $env:CUA_DRIVER_RS_VERSION
  $savedKeep = $env:CUA_DRIVER_RS_KEEP_VERSIONS
  $savedArchive = $env:DSH_TUI_CUA_ARCHIVE
  try {
    $env:CUA_DRIVER_RS_VERSION = $expectedVersion
    # Zero disables installer GC, retaining the existing 0.17.0 release for rollback.
    $env:CUA_DRIVER_RS_KEEP_VERSIONS = '0'
    if ([string]::IsNullOrWhiteSpace($ArchivePath)) {
      Remove-Item Env:DSH_TUI_CUA_ARCHIVE -ErrorAction SilentlyContinue
    } else {
      $resolvedArchive = (Resolve-Path -LiteralPath $ArchivePath).Path
      $actualArchiveHash = (Get-FileHash -LiteralPath $resolvedArchive -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actualArchiveHash -ne $archiveSha256) {
        throw "Pinned release archive hash mismatch: expected $archiveSha256, got $actualArchiveHash"
      }
      $env:DSH_TUI_CUA_ARCHIVE = $resolvedArchive
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installerFile.FullName
    if ($LASTEXITCODE -ne 0) { throw "Official Cua Driver installer exited with $LASTEXITCODE" }
  } finally {
    if ($null -eq $savedVersion) { Remove-Item Env:CUA_DRIVER_RS_VERSION -ErrorAction SilentlyContinue } else { $env:CUA_DRIVER_RS_VERSION = $savedVersion }
    if ($null -eq $savedKeep) { Remove-Item Env:CUA_DRIVER_RS_KEEP_VERSIONS -ErrorAction SilentlyContinue } else { $env:CUA_DRIVER_RS_KEEP_VERSIONS = $savedKeep }
    if ($null -eq $savedArchive) { Remove-Item Env:DSH_TUI_CUA_ARCHIVE -ErrorAction SilentlyContinue } else { $env:DSH_TUI_CUA_ARCHIVE = $savedArchive }
  }
} finally {
  if (Test-Path -LiteralPath $installerFile.FullName) { Remove-Item -LiteralPath $installerFile.FullName -Force }
  if (Test-Path -LiteralPath $moduleFile.FullName) { Remove-Item -LiteralPath $moduleFile.FullName -Force }
  if (Test-Path -LiteralPath $installerDir) { Remove-Item -LiteralPath $installerDir -Force }
}

$afterVersion = (& $driver --version 2>&1 | Out-String).Trim()
if ($afterVersion -ne "cua-driver $expectedVersion") { throw "Expected cua-driver $expectedVersion after install, got '$afterVersion'" }

$afterAutostart = (& $driver autostart status 2>&1 | Out-String).Trim()
$isRegistered = $afterAutostart -match '(?im)^registered\b'
if ($wasRegistered -and -not $isRegistered) { & $driver autostart enable }
if (-not $wasRegistered -and $isRegistered) { & $driver autostart disable }
if ($LASTEXITCODE -ne 0) { throw 'Failed to restore the previous autostart setting' }

$afterTelemetry = (& $driver telemetry status 2>&1 | Out-String).Trim()
$isTelemetryEnabled = $afterTelemetry -match '(?im)^Telemetry:\s*enabled\b'
if ($wasTelemetryDisabled -and $isTelemetryEnabled) { & $driver telemetry disable }
if ($wasTelemetryEnabled -and -not $isTelemetryEnabled) { & $driver telemetry enable }
if ($LASTEXITCODE -ne 0) { throw 'Failed to restore the previous telemetry setting' }

if ($wasRunning) {
  & $driver autostart kick
  if ($LASTEXITCODE -ne 0) { throw 'Failed to restore the previous running daemon state' }

  # An elevated pre-upgrade daemon can survive the official junction switch and
  # continue serving the old binary. Only stop the exact PID still reported by
  # Cua Driver, then let the existing autostart task launch the pinned release.
  $afterKickStatus = (& $driver status 2>&1 | Out-String).Trim()
  $afterKickPid = $null
  if ($afterKickStatus -match '(?im)^\s*pid:\s*(\d+)\s*$') {
    $afterKickPid = [int]$Matches[1]
  }
  if ($null -ne $beforeDaemonPid -and $afterKickPid -eq $beforeDaemonPid) {
    $repairScript = (Resolve-Path (Join-Path $PSScriptRoot 'repair-cua-daemon.ps1')).Path
    $repairArgs = @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', ('"{0}"' -f $repairScript),
      '-ExpectedPid', $beforeDaemonPid
    )
    $repair = Start-Process -FilePath 'powershell.exe' -ArgumentList $repairArgs -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    if ($repair.ExitCode -ne 0) { throw "Elevated Cua Driver daemon replacement failed with exit code $($repair.ExitCode)" }

    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
      Start-Sleep -Milliseconds 250
      $replacementStatus = (& $driver status 2>&1 | Out-String).Trim()
      $replacementPid = $null
      if ($replacementStatus -match '(?im)^\s*pid:\s*(\d+)\s*$') {
        $replacementPid = [int]$Matches[1]
      }
    } while (($null -eq $replacementPid -or $replacementPid -eq $beforeDaemonPid) -and [DateTime]::UtcNow -lt $deadline)
    if ($null -eq $replacementPid -or $replacementPid -eq $beforeDaemonPid) {
      throw "Cua Driver daemon did not change from pre-upgrade PID $beforeDaemonPid"
    }
  }
}

$finalStatus = (& $driver status 2>&1 | Out-String).Trim()
if ($wasRunning -and $finalStatus -notmatch '(?im)^Cua Driver daemon is running\s*$') {
  throw "Cua Driver daemon is not running after upgrade:`n$finalStatus"
}
if ($wasRunning -and $finalStatus -notmatch '(?im)^\s*permission mode:\s*standard\b') {
  throw "Cua Driver daemon is not in standard mode after upgrade:`n$finalStatus"
}
$doctor = (& $driver doctor 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $doctor -match '(?im)^\[(?:fail|error)\b') {
  throw "Cua Driver doctor failed after upgrade:`n$doctor"
}

$releaseRoot = Join-Path $env:USERPROFILE '.cua-driver\packages\releases'
$oldRelease = Get-ChildItem -LiteralPath $releaseRoot -Directory -ErrorAction SilentlyContinue | Where-Object Name -Like '0.17.0-*'
if ($null -eq $oldRelease) { throw 'The retained Cua Driver 0.17.0 rollback release was not found' }
Write-Output "Upgraded Cua Driver: $beforeVersion -> $afterVersion"
Write-Output "Retained rollback release: $($oldRelease.FullName -join ', ')"
Write-Output 'Autostart, running-state intent and telemetry state were restored.'
