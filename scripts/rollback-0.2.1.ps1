param(
  [string]$WrapperPath = 'D:\Apps\npm-global\dsh.cmd'
)

$ErrorActionPreference = 'Stop'
$wrapper = [IO.Path]::GetFullPath($WrapperPath)
$backup = "$wrapper.pre-0.2.1"
if (-not (Test-Path -LiteralPath $backup)) { throw "0.2.1 wrapper backup is missing: $backup" }
Copy-Item -LiteralPath $backup -Destination $wrapper -Force
Write-Output "Restored dsh-tui 0.2.1 launcher: $wrapper"
