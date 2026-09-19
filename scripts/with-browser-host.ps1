param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Command
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$hostDir = Join-Path $root '.browser-host'
$dshCmd = Join-Path $hostDir 'dsh.cmd'
if (-not (Test-Path -LiteralPath $dshCmd)) {
  throw @"
Isolated browser-control host is missing at $hostDir.
Copy the existing pinned alpha.2 host into it; do not download dsh again.
"@
}

$env:PATH = "$hostDir;$env:PATH"
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue
Remove-Item Env:FORCE_COLOR -ErrorAction SilentlyContinue

$version = (& $dshCmd --version 2>&1 | Out-String).Trim()
if ($version -ne '0.1.6-alpha.2') {
  throw "Expected isolated host 0.1.6-alpha.2, got '$version'"
}

if ($Command.Count -eq 0) {
  Write-Output $version
  exit 0
}

Set-Location $root
& $Command[0] @($Command | Select-Object -Skip 1)
exit $LASTEXITCODE
