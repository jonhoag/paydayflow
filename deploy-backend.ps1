# Pushes the Apps Script backend (Code.js + Index.html) and redeploys the live web app.
# GitHub Pages publishes index.html separately: commit and merge to main for that.
#
# Usage:
#   .\deploy-backend.ps1 -Description "Fix budget rollover"            # push + redeploy live
#   .\deploy-backend.ps1 -Description "test" -StageOnly                # build staging folder only
param(
  [Parameter(Mandatory = $true)][string]$Description,
  [switch]$StageOnly
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
# "Github Hosted V12" deployment; its /exec URL is hard-coded in index.html, so redeploy in place.
$deploymentId = 'AKfycbwiuLsruSCA-k2EeMn8bH6AZygi0ISA2WDTB_UJmetDOJdU6S4qLE21WmjyJK1ktCMrUA'

# Apps Script expects the page to be named "Index" (doGet loads it), but GitHub Pages needs
# lowercase index.html, so stage a copy with the right name and push from there.
$stage = Join-Path ([IO.Path]::GetTempPath()) ('paydayflow-gas-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  Copy-Item "$root\Code.js", "$root\appsscript.json", "$root\.clasp.json" $stage
  Copy-Item "$root\index.html" "$stage\Index.html"

  if ($StageOnly) {
    Write-Host "Staged files (not pushed):"
    Get-ChildItem $stage -Force | Select-Object Name, Length
    return
  }

  Push-Location $stage
  try {
    clasp push --force
    if ($LASTEXITCODE -ne 0) { throw 'clasp push failed' }
    clasp deploy --deploymentId $deploymentId --description $Description
    if ($LASTEXITCODE -ne 0) { throw 'clasp deploy failed' }
  } finally { Pop-Location }
} finally {
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}
