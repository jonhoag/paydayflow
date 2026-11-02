# Pushes the Apps Script backend (Code.js + Passkeys.js + Index.html) and redeploys the live web app.
# GitHub Pages publishes index.html separately: commit and merge to main for that.
#
# Usage:
#   .\deploy-backend.ps1 -Description "Fix budget rollover"            # checks, push + redeploy live
#   .\deploy-backend.ps1 -Description "test" -StageOnly                # build staging folder only
#   .\deploy-backend.ps1 -CheckLiveOnly                                # is live still what this PC last deployed?
#   .\deploy-backend.ps1 -AcceptLiveAsBaseline                         # record live as "last deployed" (once you've checked it)
#
# Before pushing, the quick automated checks must pass, and for live, the live script must still be exactly what
# this PC last deployed (so a change made elsewhere, e.g. in the Apps Script editor, is never overwritten unseen).
# After a live deploy, what was pushed is recorded in .deployed-backend.json and Code.js/Passkeys.js are committed to
# .backend-history (a local Git repository, never pushed anywhere) so backend changes can be compared later.
#
# To rehearse against a copy of the sheet instead of the live script, pass that copy's script ID,
# its test deployment ID, and -PrivateManifest (web app limited to you):
#   .\deploy-backend.ps1 -Description "try it" -ScriptId <copy script id> -DeploymentId <copy deployment id> -PrivateManifest
param(
  [string]$Description,
  [switch]$StageOnly,
  [string]$ScriptId,
  # Default: the "Github Hosted V12" deployment; its /exec URL is hard-coded in index.html, so redeploy in place.
  [string]$DeploymentId = 'AKfycbwiuLsruSCA-k2EeMn8bH6AZygi0ISA2WDTB_UJmetDOJdU6S4qLE21WmjyJK1ktCMrUA',
  [switch]$PrivateManifest,
  [switch]$CheckLiveOnly,
  [switch]$AcceptLiveAsBaseline
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$liveScriptId = (Get-Content "$root\.clasp.json" -Raw | ConvertFrom-Json).scriptId
$recordFile = Join-Path $root '.deployed-backend.json'
$pushedFiles = @('Code.js', 'Passkeys.js', 'Index.html', 'appsscript.json')

# A file's fingerprint as Apps Script keeps it (it stores line endings as LF).
function Get-Fingerprint([string]$path) {
  if (-not (Test-Path $path)) { return '(missing)' }
  $text = [IO.File]::ReadAllText($path) -replace "`r`n", "`n"
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($utf8NoBom.GetBytes($text))) -replace '-', '').ToLower() }
  finally { $sha.Dispose() }
}
function Get-Fingerprints([string]$dir) {
  $out = [ordered]@{}
  foreach ($f in $pushedFiles) { $out[$f] = Get-Fingerprint (Join-Path $dir $f) }
  return $out
}
function Save-Record($fingerprints, [string]$note) {
  $record = [ordered]@{ recordedAt = (Get-Date).ToString('s'); note = $note; files = $fingerprints }
  [IO.File]::WriteAllText($recordFile, ($record | ConvertTo-Json), $utf8NoBom)
}

# Downloads the live script's current code into a new temporary folder and returns the folder.
function Get-LiveCopy {
  $dir = Join-Path ([IO.Path]::GetTempPath()) ('paydayflow-live-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $dir | Out-Null
  [IO.File]::WriteAllText("$dir\.clasp.json", ('{"scriptId":"' + $liveScriptId + '","rootDir":""}'), $utf8NoBom)
  Push-Location $dir
  try {
    $ErrorActionPreference = 'Continue'   # clasp writes notices to stderr; judge it by exit code instead
    clasp pull | Out-Null
    $ok = ($LASTEXITCODE -eq 0)
  } finally { Pop-Location }
  if (-not $ok) { throw 'Could not read the live script (clasp pull failed). Nothing was pushed.' }
  return $dir
}

# Throws unless the live script is exactly what was last recorded as deployed from this PC.
function Assert-LiveUnchanged {
  if (-not (Test-Path $recordFile)) {
    Write-Host 'No record of a previous deploy from this PC yet, so the live script could not be checked. One is kept from now on.'
    return
  }
  $recorded = Get-Content $recordFile -Raw | ConvertFrom-Json
  $dir = Get-LiveCopy
  $live = Get-Fingerprints $dir
  $changed = @($pushedFiles | Where-Object { $live[$_] -ne $recorded.files.$_ })
  if ($changed.Count) {
    throw ('The live script has changed since the last deploy from this PC (' + ($changed -join ', ') + '), for example in the Apps Script editor. Nothing was pushed. The live copy is in ' + $dir + ' for comparison.')
  }
  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host ('Live script is unchanged since the last deploy from this PC (' + $recorded.recordedAt + ').')
}

# Commits the deployed backend files to the local .backend-history repository.
function Save-BackendHistory([string]$message) {
  $hist = Join-Path $root '.backend-history'
  $ErrorActionPreference = 'Continue'
  if (-not (Test-Path (Join-Path $hist '.git'))) {
    New-Item -ItemType Directory -Force -Path $hist | Out-Null
    git -C $hist init -q
  }
  # Commit under this repository's name and email (this PC has no global Git identity).
  foreach ($key in 'user.name', 'user.email') {
    $value = git -C $root config $key
    if ($value) { git -C $hist config $key $value }
  }
  Copy-Item "$root\Code.js", "$root\Passkeys.js" $hist -Force
  git -C $hist add -A
  if (-not (git -C $hist status --porcelain)) { Write-Host 'Backend history: nothing new to record.'; return }
  git -C $hist commit -q -m $message | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Host 'Backend history updated (.backend-history).' }
  else { Write-Host 'Backend history: the commit failed (see above). The deploy itself is done.' }
}

if ($CheckLiveOnly) { Assert-LiveUnchanged; return }
if ($AcceptLiveAsBaseline) {
  $dir = Get-LiveCopy
  Save-Record (Get-Fingerprints $dir) 'accepted as baseline'
  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'Recorded the live script as the last deploy from this PC.'
  return
}
if (-not $Description) { throw 'Pass -Description "what changed". Nothing was pushed.' }

# A rehearsal needs all three test settings together. Any one alone could push the "only me" manifest to live
# (locking the website out) or the public manifest to the test copy.
$liveDeploymentId = 'AKfycbwiuLsruSCA-k2EeMn8bH6AZygi0ISA2WDTB_UJmetDOJdU6S4qLE21WmjyJK1ktCMrUA'
$testSettings = @([bool]$ScriptId, [bool]$PrivateManifest, ($DeploymentId -ne $liveDeploymentId))
if (($testSettings -contains $true) -and ($testSettings -contains $false)) {
  throw 'For a rehearsal pass -ScriptId, -DeploymentId (the test copy''s) and -PrivateManifest together; for live pass none of them. Nothing was pushed.'
}
$isLive = -not $ScriptId

# Fail early if the pre-built stylesheet doesn't match index.html's classes.
$ErrorActionPreference = 'Continue'   # native tools write notices to stderr; judge them by exit code instead
node "$root\build-css.js" --check
$cssOk = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = 'Stop'
if (-not $cssOk) { throw 'tailwind.css is out of date: run "node build-css.js" and commit the result.' }

if (-not $StageOnly) {
  # The quick automated checks (backend, fingerprint sign-in, mutation check, spending). The real-Chrome tests are
  # run with "node tests/run-all.js" while developing. The backend checks live in tests\private (not in the public
  # repo); --require-private makes their absence a failure, so a deploy never goes ahead without them.
  $ErrorActionPreference = 'Continue'
  node "$root\tests\run-all.js" --quick --require-private
  $testsOk = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = 'Stop'
  if (-not $testsOk) { throw 'The automated checks failed (see above). Nothing was pushed.' }
  if ($isLive) { Assert-LiveUnchanged }
}

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
  # The same goes for the font files: the copy loads them from the website instead.
  $html = $html.Replace("url('fonts/", "url('https://jonhoag.co.uk/fonts/")
  # The page's Content-Security-Policy is for the website. Google serves this copy from its own sandbox, where the
  # policy would get in the way of google.script.run, so the copy goes without it.
  $html = [regex]::Replace($html, '<meta http-equiv="Content-Security-Policy"[^>]*>', '')
  if ($html -match '<meta http-equiv="Content-Security-Policy"' -or $html -match "url\('fonts/") { throw 'Could not adapt index.html for Apps Script (policy tag or font links). Nothing was pushed.' }
  [IO.File]::WriteAllText("$stage\Index.html", $html, $utf8NoBom)

  if ($ScriptId) {
    [IO.File]::WriteAllText("$stage\.clasp.json", ('{"scriptId":"' + $ScriptId + '","rootDir":""}'), $utf8NoBom)
  }
  if ($PrivateManifest) {
    # The same manifest (so the same permissions), with the web app limited to you.
    $manifest = Get-Content "$root\appsscript.json" -Raw | ConvertFrom-Json
    $manifest.webapp = [pscustomobject]@{ executeAs = 'USER_ACCESSING'; access = 'MYSELF' }
    [IO.File]::WriteAllText("$stage\appsscript.json", ($manifest | ConvertTo-Json -Depth 5), $utf8NoBom)
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

  if ($isLive) {
    Save-Record (Get-Fingerprints $stage) $Description
    Save-BackendHistory $Description
  }
} finally {
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0   # deployed: don't report a leftover exit code from git or clasp notices
