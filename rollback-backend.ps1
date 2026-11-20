# Points the live web app back at an earlier backend version, instantly. Nothing is pushed or changed in the
# code: Apps Script keeps every deployed version, and this just re-aims the live deployment at one of them.
#
#   clasp versions                          # lists the versions (and what each one was)
#   .\rollback-backend.ps1 -Version <n>     # go back to version n
#
# Versions are numbered per Apps Script project: this one (.clasp.json) started again at 1 when the backend moved to a
# new project on 2026-11-20, so the version numbers in older notes belong to the first project.
# The /exec URL stays the same, so the website keeps working. Roll the website back separately with
# "git revert -m 1 <merge commit>" if the page itself needs to go back too.
param(
  [Parameter(Mandatory = $true)][int]$Version,
  [string]$DeploymentId   # default: the live web app deployment, the one whose /exec URL is in app.js
)

$ErrorActionPreference = 'Stop'
if (-not $DeploymentId) {
  $DeploymentId = [regex]::Match([IO.File]::ReadAllText("$PSScriptRoot\app.js"), "APPS_SCRIPT_EXEC_URL = 'https://script\.google\.com/macros/s/([\w-]+)/exec'").Groups[1].Value
  if (-not $DeploymentId) { throw 'Could not find APPS_SCRIPT_EXEC_URL in app.js. Nothing was changed.' }
}
Push-Location $PSScriptRoot
try {
  clasp deploy --deploymentId $DeploymentId --versionNumber $Version --description "Rollback to version $Version"
  if ($LASTEXITCODE -ne 0) { throw 'clasp deploy failed' }
  Write-Host "Live web app now serves backend version $Version."
} finally { Pop-Location }
