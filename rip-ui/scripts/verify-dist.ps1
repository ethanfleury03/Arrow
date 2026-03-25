$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'

if (-not (Test-Path $dist)) {
  throw "dist folder not found: $dist"
}

$exe = Get-ChildItem -Path $dist -Recurse -Filter '*.exe' | Select-Object -First 1
if (-not $exe) {
  throw 'No .exe artifact found in dist.'
}

$report = Join-Path $dist 'BUILD_REPORT.txt'
@"
Build verification timestamp: $(Get-Date -Format o)
Verified artifact: $($exe.FullName)
Artifact size (bytes): $($exe.Length)
Verification status: PASS
"@ | Set-Content -Path $report -Encoding UTF8

Write-Host "Verified EXE artifact: $($exe.FullName)"
Write-Host "Wrote report: $report"
