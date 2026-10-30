# Pushes the Apps Script backend (Code.js + Passkeys.js + Index.html) and redeploys the live web app.
# GitHub Pages publishes index.html separately: commit and merge to main for that.
#
# Usage:
#   .\deploy-backend.ps1 -Description "Fix budget rollover"            # push + redeploy live
#   .\deploy-backend.ps1 -Description "test" -StageOnly                # build staging folder only
#
# To rehearse against a copy of the sheet instead of the live script, pass that copy's script ID,
# its test deployment ID, and -PrivateManifest (web app limited to you):
#   .\deploy-backend.ps1 -Description "try it" -ScriptId <copy script id> -DeploymentId <copy deployment id> -PrivateManifest
param(
  [Parameter(Mandatory = $true)][string]$Description,
  [switch]$StageOnly,
  [string]$ScriptId,
  # Default: the "Github Hosted V12" deployment; its /exec URL is hard-coded in index.html, so redeploy in place.
  [string]$DeploymentId = 'AKfycbwiuLsruSCA-k2EeMn8bH6AZygi0ISA2WDTB_UJmetDOJdU6S4qLE21WmjyJK1ktCMrUA',
  [switch]$PrivateManifest
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# Fail early if the pre-built stylesheet doesn't match index.html's classes.
$ErrorActionPreference = 'Continue'   # native tools write notices to stderr; judge them by exit code instead
node "$root\build-css.js" --check
$cssOk = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = 'Stop'
if (-not $cssOk) { throw 'tailwind.css is out of date: run "node build-css.js" and commit the result.' }

# Apps Script expects the page to be named "Index" (doGet loads it), but GitHub Pages needs
# lowercase index.html, so stage a copy with the right name and push from there.
$stage = Join-Path ([IO.Path]::GetTempPath()) ('paydayflow-gas-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  Copy-Item "$root\Code.js", "$root\Passkeys.js", "$root\appsscript.json", "$root\.clasp.json" $stage

  # Apps Script serves only this one HTML file, so tailwind.css can't be fetched separately there:
  # inline the stylesheet into the staged copy.
  $html = [IO.File]::ReadAllText("$root\index.html")
  $css = [IO.File]::ReadAllText("$root\tailwind.css")
  $linkRe = '<link rel="stylesheet" href="tailwind\.css[^"]*"[^>]*>'
  if ($html -notmatch $linkRe) { throw 'index.html has no tailwind.css link to inline.' }
  $html = [regex]::Replace($html, $linkRe, { param($m) '<style>' + $css + '</style>' })
  [IO.File]::WriteAllText("$stage\Index.html", $html, $utf8NoBom)

  if ($ScriptId) {
    [IO.File]::WriteAllText("$stage\.clasp.json", ('{"scriptId":"' + $ScriptId + '","rootDir":""}'), $utf8NoBom)
  }
  if ($PrivateManifest) {
    [IO.File]::WriteAllText("$stage\appsscript.json",
      '{"timeZone":"Europe/London","dependencies":{},"exceptionLogging":"STACKDRIVER","runtimeVersion":"V8","webapp":{"executeAs":"USER_ACCESSING","access":"MYSELF"}}', $utf8NoBom)
  }

  if ($StageOnly) {
    Write-Host "Staged files (not pushed):"
    Get-ChildItem $stage -Force | Select-Object Name, Length
    return
  }

  Push-Location $stage
  try {
    clasp push --force
    if ($LASTEXITCODE -ne 0) { throw 'clasp push failed' }
    clasp deploy --deploymentId $DeploymentId --description $Description
    if ($LASTEXITCODE -ne 0) { throw 'clasp deploy failed' }
  } finally { Pop-Location }
} finally {
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}
