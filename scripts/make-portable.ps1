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
  if (-not (Test-Path $path)) { throw "找不到 $path`n  $hint" }
}

# ---- checks -------------------------------------------------------------
Need (Join-Path $release 'desktop.exe') '先執行 npm run tauri build'
Need (Join-Path $release 'dpcleaner-server.exe') `
  '先依 README 用 PyInstaller 建置 sidecar，再執行 npm run tauri build'
Need (Join-Path $WebView2Runtime 'msedgewebview2.exe') `
  '這個資料夾要是解壓後的 WebView2 Fixed Version runtime'

$serverSize = (Get-Item (Join-Path $release 'dpcleaner-server.exe')).Length
if ($serverSize -lt 50MB) {
  throw "dpcleaner-server.exe 只有 $([math]::Round($serverSize/1MB,1)) MB，看起來是佔位檔而不是真的後端。"
}

# ---- stage --------------------------------------------------------------
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Write-Host '複製執行檔…'
Copy-Item (Join-Path $release 'desktop.exe') $stage
Copy-Item (Join-Path $release 'dpcleaner-server.exe') $stage

Write-Host '複製 WebView2 runtime…'
Copy-Item $WebView2Runtime (Join-Path $stage 'webview2') -Recurse

@'
這個檔案讓 DPcleaner 以「可攜模式」執行。

設定、模型與瀏覽器快取都會存放在同一層的 data 資料夾裡，
不會寫入這台電腦的其他位置。

刪掉這個檔案，程式就會改用一般模式（設定寫到你的使用者資料夾）。
'@ | Set-Content -Path (Join-Path $stage 'portable.txt') -Encoding utf8

# ---- model --------------------------------------------------------------
$modelDir = Join-Path $stage 'data\.cache\sscd'
New-Item -ItemType Directory -Path $modelDir -Force | Out-Null
$modelPath = Join-Path $modelDir 'sscd_disc_mixup.torchscript.pt'

$cached = Join-Path $env:USERPROFILE '.cache\sscd\sscd_disc_mixup.torchscript.pt'
if (Test-Path $cached) {
  Write-Host '沿用本機已下載的 SSCD 模型…'
  Copy-Item $cached $modelPath
} else {
  Write-Host ' 下載 SSCD 模型（約 94 MB）…'
  Invoke-WebRequest -Uri $modelUrl -OutFile $modelPath
}

Write-Host '驗證模型雜湊…'
$got = (Get-FileHash $modelPath -Algorithm SHA256).Hash.ToLower()
if ($got -ne $modelSha) {
  throw "模型 SHA-256 不符`n  預期 $modelSha`n  實際 $got"
}

# ---- zip ----------------------------------------------------------------
if (-not $SkipZip) {
  $zip = Join-Path $OutDir 'DPcleaner-portable.zip'
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Write-Host '壓縮中…'
  Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal
  $mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
  Write-Host "完成: $zip ($mb MB)"
} else {
  Write-Host "完成: $stage"
}
