param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $SkipBuild) {
  & npm --prefix $projectRoot run build
  if ($LASTEXITCODE -ne 0) { throw 'dsh-tui build failed' }
}

$dshCommand = Get-Command dsh -CommandType Application -ErrorAction Stop
& $dshCommand.Source plugin --profile tui add $projectRoot
if ($LASTEXITCODE -ne 0) { throw 'dsh-tui profile installation failed' }

$wrapperPath = $dshCommand.Source
if ([IO.Path]::GetExtension($wrapperPath) -ne '.cmd') {
  throw "Expected a Windows .cmd dsh wrapper, got $wrapperPath"
}
$current = [IO.File]::ReadAllText($wrapperPath)
$marker = 'Bare invocation opens the installed dsh-tui profile'
if ($current.Contains($marker)) {
  Write-Output "dsh already defaults to the tui profile: $wrapperPath"
  exit 0
}

$launcher = ($current -split "`r?`n" | Where-Object { $_ -match '^\s*node\s+.+bin\.js.+%\*\s*$' } | Select-Object -Last 1)
if ($null -eq $launcher) {
  throw "Cannot identify the upstream node launcher line in $wrapperPath; no changes were made"
}
$baseLauncher = $launcher -replace '\s+%\*\s*$', ''
$backupPath = "$wrapperPath.pre-dsh-tui"
if (-not (Test-Path -LiteralPath $backupPath)) {
  Copy-Item -LiteralPath $wrapperPath -Destination $backupPath
}
$next = @"
@echo off
rem dsh - DeepSeek Harness CLI.
rem Bare invocation opens the installed dsh-tui profile in the current workspace.
rem Any explicit argument keeps the upstream CLI behavior unchanged.
if "%~1"=="" (
  $baseLauncher --profile tui
) else (
  $baseLauncher %*
)
"@
[IO.File]::WriteAllText($wrapperPath, $next, [Text.UTF8Encoding]::new($false))
Write-Output "Installed bare dsh -> --profile tui routing: $wrapperPath"
Write-Output "Backup: $backupPath"
