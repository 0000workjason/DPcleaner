<#
.SYNOPSIS
  Assemble the portable build into a self-contained folder and zip it.

.DESCRIPTION
  The portable build is the same binaries as the installer, plus three things:

    portable.txt   the marker that switches the app to portable mode, so the
                   settings file, model cache and WebView2 profile all live in
                   .\data instead of the user's home directory
    webview2\      a fixed-version WebView2 runtime, so the app runs on
                   machines that have none installed
    data\.cache\   the SSCD model, pre-placed so the first scan works offline

  Run `npm run tauri build` first -- this script only assembles what that
  produced. It never touches anything outside the output folder.

.PARAMETER WebView2Runtime
  Folder holding the extracted fixed-version WebView2 runtime. Download the
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
  [Parameter(Mandatory = $true)][string]$WebView2Runtime,
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
Need (Join-Path $release 'dpcleaner-server.exe') `
  'Build the sidecar with PyInstaller (see README), then run `npm run tauri build`.'
Need (Join-Path $WebView2Runtime 'msedgewebview2.exe') `
  'This should be the extracted WebView2 Fixed Version runtime folder.'

$serverSize = (Get-Item (Join-Path $release 'dpcleaner-server.exe')).Length
if ($serverSize -lt 50MB) {
  throw "dpcleaner-server.exe is only $([math]::Round($serverSize/1MB,1)) MB -- that looks like the CI placeholder, not a real backend build."
}

# ---- stage --------------------------------------------------------------
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Write-Host 'Copying binaries...'
Copy-Item (Join-Path $release 'desktop.exe') $stage
Copy-Item (Join-Path $release 'dpcleaner-server.exe') $stage

Write-Host 'Copying WebView2 runtime...'
Copy-Item $WebView2Runtime (Join-Path $stage 'webview2') -Recurse

@'
This file makes DPcleaner run in portable mode.

Settings, the model cache and the browser profile are all kept in the
"data" folder next to this file. Nothing is written anywhere else on the
computer, so you can run this from a USB stick and leave no trace.

Delete this file and the same app behaves like a normal install, storing
its settings in your user folder instead.
'@ | Set-Content -Path (Join-Path $stage 'portable.txt') -Encoding utf8

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
