param(
  [switch]$SkipBuild,
  [switch]$SkipProfileInstall
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourceHost = (Resolve-Path (Join-Path $projectRoot '.alpha2-host')).Path
$computerHost = [IO.Path]::GetFullPath((Join-Path $projectRoot '.computer-host'))
$prefix = $projectRoot + [IO.Path]::DirectorySeparatorChar
if (-not $sourceHost.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Source Host escaped the project: $sourceHost"
}
if (-not $computerHost.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Computer Host escaped the project: $computerHost"
}

if (-not (Test-Path -LiteralPath $computerHost)) {
  Write-Output 'Copying the existing alpha.2 Host; dsh will not be downloaded again...'
  Copy-Item -LiteralPath $sourceHost -Destination $computerHost -Recurse
}

$dshCmd = Join-Path $computerHost 'dsh.cmd'
$dshPackage = Join-Path $computerHost 'node_modules\@deepseek-ai\dsh'
if (-not (Test-Path -LiteralPath $dshCmd) -or -not (Test-Path -LiteralPath (Join-Path $dshPackage 'package.json'))) {
  throw "Computer Host is incomplete: $computerHost"
}
if ((& $dshCmd --version 2>&1 | Out-String).Trim() -ne '0.1.6-alpha.2') {
  throw 'Computer Host must remain exactly dsh 0.1.6-alpha.2'
}

& npm install --prefix $dshPackage --no-save --package-lock=false `
  '@deepseek-ai/dsh-computer-use@0.1.6-alpha.2' `
  '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp@0.1.6-alpha.2'
if ($LASTEXITCODE -ne 0) { throw 'Pinned Computer Use dependency installation failed' }

$domainPackage = Get-Content -LiteralPath (Join-Path $dshPackage 'node_modules\@deepseek-ai\dsh-computer-use\package.json') -Raw | ConvertFrom-Json
$providerPackage = Get-Content -LiteralPath (Join-Path $dshPackage 'node_modules\@deepseek-ai\dsh-experimental-computer-use-cua-driver-mcp\package.json') -Raw | ConvertFrom-Json
if ($domainPackage.version -ne '0.1.6-alpha.2' -or $providerPackage.version -ne '0.1.6-alpha.2') {
  throw "Unexpected Computer Host versions: domain=$($domainPackage.version), provider=$($providerPackage.version)"
}

if (-not $SkipBuild) {
  & npm --prefix $projectRoot run build
  if ($LASTEXITCODE -ne 0) { throw 'dsh-tui build failed' }
}

if (-not $SkipProfileInstall) {
  $env:PATH = "$computerHost;$env:PATH"
  & $dshCmd plugin --profile tui-computer add $projectRoot
  if ($LASTEXITCODE -ne 0) { throw 'dsh-tui profile installation failed' }
}

Write-Output "Prepared isolated Computer Host: $computerHost"
Write-Output 'Prepared the separate tui-computer profile; the existing tui profile was not replaced.'
Write-Output 'The existing alpha.2 Host was copied; dsh was not downloaded again.'
