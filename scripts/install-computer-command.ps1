param(
  [string]$WrapperPath = 'D:\Apps\npm-global\dsh.cmd'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$computerHost = (Resolve-Path (Join-Path $projectRoot '.computer-host')).Path
$computerDsh = Join-Path $computerHost 'node_modules\@deepseek-ai\dsh\lib\bin.js'
$driver = Join-Path $env:LOCALAPPDATA 'Programs\Cua\cua-driver\bin\cua-driver.exe'
$wrapper = [IO.Path]::GetFullPath($WrapperPath)
if (-not (Test-Path -LiteralPath $computerDsh)) { throw "Computer Host is not prepared: $computerDsh" }
if (-not (Test-Path -LiteralPath $driver)) { throw "Cua Driver is not installed: $driver" }
if (-not (Test-Path -LiteralPath $wrapper)) { throw "dsh wrapper does not exist: $wrapper" }
if ((& (Join-Path $computerHost 'dsh.cmd') --version 2>&1 | Out-String).Trim() -ne '0.1.6-alpha.2') {
  throw 'Refusing cutover: Computer Host is not exact dsh 0.1.6-alpha.2'
}
if ((& $driver --version 2>&1 | Out-String).Trim() -ne 'cua-driver 0.28.2') {
  throw 'Refusing cutover: Cua Driver is not exactly 0.28.2'
}

$backup = "$wrapper.pre-0.2.1"
if (-not (Test-Path -LiteralPath $backup)) {
  Copy-Item -LiteralPath $wrapper -Destination $backup
}
$escapedBin = $computerDsh.Replace('%', '%%')
$next = @"
@echo off
rem dsh - DeepSeek Harness CLI (dsh-tui 0.2.2 isolated Computer Host).
rem Bare invocation opens the installed dsh-tui profile in the current workspace.
rem Any explicit argument keeps the upstream CLI behavior unchanged.
if "%~1"=="" (
  node "$escapedBin" --profile tui-computer
) else (
  node "$escapedBin" %*
)
"@
[IO.File]::WriteAllText($wrapper, $next, [Text.UTF8Encoding]::new($false))
Write-Output "Installed dsh-tui 0.2.2 launcher: $wrapper"
Write-Output "0.2.1 rollback backup: $backup"
