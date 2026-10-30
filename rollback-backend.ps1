# Points the live web app back at an earlier backend version, instantly. Nothing is pushed or changed in the
# code: Apps Script keeps every deployed version, and this just re-aims the live deployment at one of them.
#
#   clasp versions                          # lists the versions (and what each one was)
#   .\rollback-backend.ps1 -Version 26      # go back to version 26 (the last release before fingerprint sign-in)
#
# The /exec URL stays the same, so the website keeps working. Roll the website back separately with
# "git revert -m 1 <merge commit>" if the page itself needs to go back too.
param(
  [Parameter(Mandatory = $true)][int]$Version,
  # The live "Github Hosted" deployment.
  [string]$DeploymentId = 'AKfycbwiuLsruSCA-k2EeMn8bH6AZygi0ISA2WDTB_UJmetDOJdU6S4qLE21WmjyJK1ktCMrUA'
)

$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
  clasp deploy --deploymentId $DeploymentId --versionNumber $Version --description "Rollback to version $Version"
  if ($LASTEXITCODE -ne 0) { throw 'clasp deploy failed' }
  Write-Host "Live web app now serves backend version $Version."
} finally { Pop-Location }
