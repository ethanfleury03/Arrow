$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$out = Join-Path $dist 'RIP-UI-Prototype-Setup.exe'
@"
RIP UI Prototype placeholder executable.
Milestone: M1 scaffold only.
Replace with real packaged binary in M4.
"@ | Set-Content -Path $out -Encoding UTF8
Write-Host "Generated placeholder artifact: $out"
