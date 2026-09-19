param(
  [switch]$SkipBuild,
  [switch]$SkipProfileInstall
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourceHost = (Resolve-Path (Join-Path $projectRoot '.alpha2-host')).Path
$browserHost = [IO.Path]::GetFullPath((Join-Path $projectRoot '.browser-host'))
$prefix = $projectRoot + [IO.Path]::DirectorySeparatorChar
if (-not $sourceHost.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Source Host escaped the project: $sourceHost"
}
if (-not $browserHost.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Browser Host escaped the project: $browserHost"
}

if (-not (Test-Path -LiteralPath $browserHost)) {
  Write-Output "Copying the existing alpha.2 Host; dsh will not be downloaded again..."
  Copy-Item -LiteralPath $sourceHost -Destination $browserHost -Recurse
}

$dshCmd = Join-Path $browserHost 'dsh.cmd'
$dshPackage = Join-Path $browserHost 'node_modules\@deepseek-ai\dsh'
if (-not (Test-Path -LiteralPath $dshCmd) -or -not (Test-Path -LiteralPath (Join-Path $dshPackage 'package.json'))) {
  throw "Browser Host is incomplete: $browserHost"
}
if ((& $dshCmd --version 2>&1 | Out-String).Trim() -ne '0.1.6-alpha.2') {
  throw 'Browser Host must remain exactly dsh 0.1.6-alpha.2'
}

$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
& npm install --prefix $dshPackage --no-save --package-lock=false `
  '@deepseek-ai/dsh-browser-use@0.1.6-alpha.2' `
  '@deepseek-ai/dsh-experimental-browser-use-runtime@0.1.6-alpha.2' `
  '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp@0.1.6-alpha.2'
if ($LASTEXITCODE -ne 0) { throw 'Pinned Browser Use dependency installation failed' }

$providerPackage = Get-Content -LiteralPath (Join-Path $dshPackage 'node_modules\@deepseek-ai\dsh-experimental-browser-use-playwright-mcp\package.json') -Raw | ConvertFrom-Json
$mcpPackage = Get-Content -LiteralPath (Join-Path $dshPackage 'node_modules\@playwright\mcp\package.json') -Raw | ConvertFrom-Json
if ($providerPackage.version -ne '0.1.6-alpha.2' -or $mcpPackage.version -ne '0.0.80') {
  throw "Unexpected Browser Host versions: provider=$($providerPackage.version), playwright-mcp=$($mcpPackage.version)"
}

if (-not $SkipBuild) {
  & npm --prefix $projectRoot run build
  if ($LASTEXITCODE -ne 0) { throw 'dsh-tui build failed' }
}

if (-not $SkipProfileInstall) {
  $env:PATH = "$browserHost;$env:PATH"
  & $dshCmd plugin --profile tui add $projectRoot
  if ($LASTEXITCODE -ne 0) { throw 'dsh-tui profile installation failed' }
}

Write-Output "Prepared isolated Browser Host: $browserHost"
Write-Output 'No Chromium or second dsh package was downloaded.'
