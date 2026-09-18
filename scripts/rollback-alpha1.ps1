$ErrorActionPreference = 'Stop'

$wrapper = 'D:\Apps\npm-global\dsh.cmd'
$wrapperBackup = 'D:\Apps\npm-global\dsh.cmd.pre-0.1.6-alpha.2'
$dshHome = Join-Path $env:USERPROFILE '.dsh'
$profile = Join-Path $dshHome 'profiles\tui'
$profileBackup = Join-Path $dshHome 'backups\tui.pre-0.2.0-manifest'
$credential = Join-Path $dshHome '.credentials.yaml'
$credentialBackup = Join-Path $dshHome '.credentials.yaml.pre-0.2.0'

foreach ($required in @($wrapperBackup, $profileBackup, $credentialBackup)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Rollback backup is missing: $required" }
}

Copy-Item -LiteralPath $wrapperBackup -Destination $wrapper -Force
foreach ($name in @('package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-lock.yaml', 'pnpm-workspace.yaml')) {
  $source = Join-Path $profileBackup $name
  if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $profile $name) -Force }
}
Copy-Item -LiteralPath $credentialBackup -Destination $credential -Force

$version = (& $wrapper --version 2>&1 | Out-String).Trim()
if ($version -ne '0.1.6-alpha.1') { throw "Rollback wrapper reports '$version', expected 0.1.6-alpha.1" }
Write-Output "Restored alpha.1 wrapper, tui Profile manifests, and credentials. dsh $version"
