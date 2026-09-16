param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Command
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$hostDir = Join-Path $root '.alpha-host'
$dshCmd = Join-Path $hostDir 'dsh.cmd'
if (-not (Test-Path -LiteralPath $dshCmd)) {
  throw @"
Isolated 0.1.6-alpha.1 host is missing at $hostDir.
Install it without touching the global launcher:
  npm install --global --prefix `"$hostDir`" @deepseek-ai/dsh@0.1.6-alpha.1
"@
}

$env:PATH = "$hostDir;$env:PATH"
Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue
Remove-Item Env:FORCE_COLOR -ErrorAction SilentlyContinue

$version = (& $dshCmd --version 2>&1 | Out-String).Trim()
if ($version -ne '0.1.6-alpha.1') {
  throw "Expected isolated host 0.1.6-alpha.1, got '$version'"
}

if ($Command.Count -eq 0) {
  Write-Output $version
  exit 0
}

Set-Location $root
& $Command[0] @($Command | Select-Object -Skip 1)
exit $LASTEXITCODE
