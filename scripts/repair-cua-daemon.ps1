param(
  [Parameter(Mandatory = $true)]
  [int]$ExpectedPid
)

$ErrorActionPreference = 'Stop'
$driver = Join-Path $env:LOCALAPPDATA 'Programs\Cua\cua-driver\bin\cua-driver.exe'
if (-not (Test-Path -LiteralPath $driver)) { throw "Cua Driver is not installed: $driver" }
$status = (& $driver status 2>&1 | Out-String)
if ($status -notmatch "(?m)^\s*pid:\s*$ExpectedPid\s*$") {
  throw "Refusing to stop PID $ExpectedPid because it is not the daemon reported by Cua Driver"
}
$process = Get-Process -Id $ExpectedPid -ErrorAction Stop
if ($process.ProcessName -ne 'cua-driver') {
  throw "Refusing to stop PID $ExpectedPid because its process name is $($process.ProcessName)"
}
Stop-Process -Id $ExpectedPid -Force -ErrorAction Stop
& schtasks.exe /Run /TN 'cua-driver-serve' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to start cua-driver-serve (schtasks exit $LASTEXITCODE)" }
