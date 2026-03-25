$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host 'npm not found. Falling back to placeholder build.'
  & "$PSScriptRoot/build-windows-placeholder.ps1"
  exit 0
}

if (-not (Test-Path "$root/node_modules")) {
  npm install
}

npm run build:win
& "$PSScriptRoot/verify-dist.ps1"
Write-Host 'Windows build completed + verified.'
