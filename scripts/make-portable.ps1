<#
.SYNOPSIS
  Assemble the portable build into a self-contained folder and zip it.

.DESCRIPTION
  This is the only thing the project ships. Alongside the two executables it
  adds:

    portable.txt   the marker that switches the app to portable mode, so the
                   settings file, model cache and WebView2 profile all live in
                   .\data instead of the user's home directory
    data\.cache\   the SSCD model, pre-placed so the first scan works offline
    webview2\      optional: a fixed-version WebView2 runtime. Without it the
                   app uses whatever WebView2 the machine already has, which
                   Windows 11 always ships and Windows 10 gets with Edge.

  Run `npm run tauri build` first -- this script only assembles what that
  produced. It never touches anything outside the output folder.

.PARAMETER WebView2Runtime
  Optional. Folder holding the extracted fixed-version WebView2 runtime, for a
  build that works even on machines with no WebView2 at all. Download the
  "Fixed Version" x64 archive from
  https://developer.microsoft.com/microsoft-edge/webview2/ and extract it; the
  folder should contain msedgewebview2.exe.

.PARAMETER OutDir
  Where to assemble. Defaults to dist-portable\ in the repo root.

.PARAMETER SkipZip
  Assemble the folder but don't produce the .zip.
#>
[CmdletBinding()]
param(
  [string]$WebView2Runtime,
  [string]$OutDir,
  [switch]$SkipZip
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$release = Join-Path $repo 'src-tauri\target\release'
if (-not $OutDir) { $OutDir = Join-Path $repo 'dist-portable' }
$stage = Join-Path $OutDir 'DPcleaner-portable'

# Keep in sync with backend/dpcleaner/sscd_embedder.py
$modelUrl = 'https://dl.fbaipublicfiles.com/sscd-copy-detection/sscd_disc_mixup.torchscript.pt'
$modelSha = '9f26bd4c848cc19b73d2ae92eea6e04886f61a7b764ceb7a13aeee62e6a6db56'

function Need($path, $hint) {
  if (-not (Test-Path $path)) { throw "Missing $path`n  $hint" }
}

# ---- checks -------------------------------------------------------------
Need (Join-Path $release 'desktop.exe') 'Run `npm run tauri build` first.'

# Take the backend straight from binaries\ rather than from target\release\.
# That is where the build reads it from anyway, and bundling is turned off
# (tauri.conf.json bundle.active), so Tauri has no reason to copy it next to
# the exe. One source, no dependency on bundling behaviour.
$serverSrc = @(Get-ChildItem (Join-Path $repo 'src-tauri\binaries') -Filter 'dpcleaner-server-*.exe' -ErrorAction SilentlyContinue)
if ($serverSrc.Count -eq 0) {
  throw "No dpcleaner-server-*.exe in src-tauri\binaries`n  Build it with PyInstaller first (see README)."
}
if ($serverSrc.Count -gt 1) {
  throw "Expected one backend in src-tauri\binaries, found $($serverSrc.Count):`n  $($serverSrc.Name -join "`n  ")"
}
$serverSrc = $serverSrc[0]

# The build only requires this file to exist, so a zero-byte placeholder gets
# you an installer-sized zip containing a backend that cannot start, with
# nothing along the way failing. This check is the only thing that catches it.
if ($serverSrc.Length -lt 50MB) {
  throw "$($serverSrc.Name) is only $([math]::Round($serverSrc.Length/1MB,1)) MB -- that is the placeholder, not a real backend build."
}

if ($WebView2Runtime) {
  Need (Join-Path $WebView2Runtime 'msedgewebview2.exe') `
    'This should be the extracted WebView2 Fixed Version runtime folder.'
}

# ---- stage --------------------------------------------------------------
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Write-Host 'Copying binaries...'
Copy-Item (Join-Path $release 'desktop.exe') $stage
# desktop.exe looks for exactly this name beside itself.
Copy-Item $serverSrc.FullName (Join-Path $stage 'dpcleaner-server.exe')

if ($WebView2Runtime) {
  Write-Host 'Copying WebView2 runtime...'
  Copy-Item $WebView2Runtime (Join-Path $stage 'webview2') -Recurse
  $webviewNote = ''
} else {
  Write-Host 'No WebView2 runtime bundled -- the app will use the one already on the machine.'
  $webviewNote = @'


Requires WebView2, which Windows 11 includes and Windows 10 gets with
Microsoft Edge. Practically every machine already has it.
'@
}

@"
This file makes DPcleaner run in portable mode.

Settings, the model cache and the browser profile are all kept in the
"data" folder next to this file. Nothing is written anywhere else on the
computer, so you can run this from a USB stick and leave no trace.

Delete this file and the same app behaves like a normal install, storing
its settings in your user folder instead.$webviewNote
"@ | Set-Content -Path (Join-Path $stage 'portable.txt') -Encoding utf8

# ---- model --------------------------------------------------------------
$modelDir = Join-Path $stage 'data\.cache\sscd'
New-Item -ItemType Directory -Path $modelDir -Force | Out-Null
$modelPath = Join-Path $modelDir 'sscd_disc_mixup.torchscript.pt'

$cached = Join-Path $env:USERPROFILE '.cache\sscd\sscd_disc_mixup.torchscript.pt'
if (Test-Path $cached) {
  Write-Host 'Reusing the locally cached SSCD model...'
  Copy-Item $cached $modelPath
} else {
  Write-Host 'Downloading the SSCD model (~94 MB)...'
  Invoke-WebRequest -Uri $modelUrl -OutFile $modelPath
}

Write-Host 'Verifying model hash...'
$got = (Get-FileHash $modelPath -Algorithm SHA256).Hash.ToLower()
if ($got -ne $modelSha) {
  throw "SSCD model SHA-256 mismatch`n  expected $modelSha`n  got      $got"
}

# ---- zip ----------------------------------------------------------------
if (-not $SkipZip) {
  $zip = Join-Path $OutDir 'DPcleaner-portable.zip'
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Write-Host 'Compressing...'
  Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal
  $mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
  Write-Host "Done: $zip ($mb MB)"
} else {
  Write-Host "Done: $stage"
}
