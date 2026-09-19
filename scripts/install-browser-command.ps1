param(
  [string]$WrapperPath = 'D:\Apps\npm-global\dsh.cmd'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$browserHost = (Resolve-Path (Join-Path $projectRoot '.browser-host')).Path
$browserDsh = Join-Path $browserHost 'node_modules\@deepseek-ai\dsh\lib\bin.js'
$wrapper = [IO.Path]::GetFullPath($WrapperPath)
if (-not (Test-Path -LiteralPath $browserDsh)) { throw "Browser Host is not prepared: $browserDsh" }
if (-not (Test-Path -LiteralPath $wrapper)) { throw "dsh wrapper does not exist: $wrapper" }
if ((& (Join-Path $browserHost 'dsh.cmd') --version 2>&1 | Out-String).Trim() -ne '0.1.6-alpha.2') {
  throw 'Refusing cutover: Browser Host is not exact dsh 0.1.6-alpha.2'
}

$backup = "$wrapper.pre-0.2.0"
if (-not (Test-Path -LiteralPath $backup)) {
  Copy-Item -LiteralPath $wrapper -Destination $backup
}
$escapedBin = $browserDsh.Replace('%', '%%')
$next = @"
@echo off
rem dsh - DeepSeek Harness CLI (dsh-tui 0.2.1 isolated Browser Host).
rem Bare invocation opens the installed dsh-tui profile in the current workspace.
rem Any explicit argument keeps the upstream CLI behavior unchanged.
if "%~1"=="" (
  node "$escapedBin" --profile tui
) else (
  node "$escapedBin" %*
)
"@
[IO.File]::WriteAllText($wrapper, $next, [Text.UTF8Encoding]::new($false))
Write-Output "Installed dsh-tui 0.2.1 launcher: $wrapper"
Write-Output "0.2.0 rollback backup: $backup"
