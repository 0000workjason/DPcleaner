<div align="center">

# DPcleaner

![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6?style=flat-square&logo=windows&logoColor=white)
![CI](https://github.com/0000workjason/DPcleaner/actions/workflows/ci.yml/badge.svg)
![Release](https://img.shields.io/github/v/release/0000workjason/DPcleaner?style=flat-square)
![Tauri](https://img.shields.io/badge/Tauri-24C8DB?style=flat-square&logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white)

**在桌面上找出並清理近似重複的插畫。**
個人自學專案——開源、無廣告、無遙測。

[**下載**](#下載) · [**功能**](#功能) · [**常見問題**](#常見問題) · [**開發**](#開發) · [**License**](#license)

[English](README.md) | **繁體中文**

</div>

---

用 SSCD copy-detection embedding 找出同一張插畫的不同版本（縮放、壓縮、裁切、調色、鏡像）——這在從 Pixiv 或 Twitter 反覆存圖時很常見——讓你手動挑選要保留或丟到回收筒的版本。

> 個人自學 side project，主要目的是練習跨語言（Rust / Python / TypeScript）整合與工程實務。沒有簽章、沒有贊助、也不是正式維護中的產品——單純是自己想要這個工具而做的。

## 下載

去 [Releases](../../releases) 下載安裝檔（`.msi` 或 `-setup.exe`），雙擊安裝、打開就能用，不需要裝 Node/Rust/Python 任何開發工具——後端已經用 PyInstaller 打包成獨立執行檔，跟著安裝檔一起帶走了。

**系統需求：** Windows 10 或 11（64 位元）。安裝檔**沒有數位簽章**，Windows SmartScreen 第一次執行會跳警告（「Windows 已保護你的電腦」）——點**其他資訊 → 仍要執行**即可。簽章需要付費，這個專案沒有這筆預算。

> 目前還沒有自動化的 Release 流程，安裝檔要維護者手動照下面「打包成安裝檔」的步驟本地建置後上傳。

## 操作示範

**1. 選資料夾、調相似度門檻。** 點 **+ Add folder** 開啟選擇資料夾的對話框，或直接把資料夾拖進視窗，可以加任意多個。每個資料夾列後面有 **Rename**（開啟該資料夾的批次重新命名對話框）跟 **Remove**（從清單移除）；**Clear all** 清空整份清單。門檻滑桿（50%–85%）控制比對的嚴格程度——調高只抓幾乎一模一樣的複本，調低連改動較大的變體也抓得到（但誤判也會變多）。準備好之後點 **Start scan**。

<div align="center">
  <img src="screenshots/folders.png" alt="DPcleaner - 選擇要掃描的資料夾" width="800" />
</div>

**2. 掃描在本機執行。** 每張圖都會計算 SSCD embedding，即時顯示進度。**Stop** 可以隨時取消掃描。第一次掃描要下載約 94 MB 的模型（只需一次），之後同一個 session 只有新增/變更的圖片需要重新計算。

<div align="center">
  <img src="screenshots/scanning.png" alt="DPcleaner - 掃描進度" width="800" />
</div>

**3. 檢視重複群組。** 每張卡片是一組相符的圖片——縮圖、尺寸、檔案大小、來源資料夾、相似度範圍都看得到。用搜尋框、格式/排序下拉選單、**Min group** 來縮小範圍。每張卡片的 **Select group** 可以一次勾選整組圖片，**Compare** 打開並排比對畫面。右上角 **⚙ Settings** 是全域設定（語言、主題等）。

<div align="center">
  <img src="screenshots/results.png" alt="DPcleaner - 掃描完成，找到重複群組" width="800" />
</div>

**4. 並排比對。** **Compare** 打開同步縮放/平移的比對視窗——滾輪縮放、拖曳平移，按 `0` 重設視角，群組內所有圖片會一起動，方便對齊同一個區域看差異。**Reset** 恢復預設視角；**Close**（或右鍵/Esc）回到結果畫面。

<div align="center">
  <img src="screenshots/compare.png" alt="DPcleaner - 並排比對畫面" width="800" />
</div>

**5. 選取並清理。** 勾選不要的版本，可以跨群組選取——**Select all** / **Clear selection** 一次全選或清空，工具列會即時顯示已選數量跟能釋放多少空間。**Move to Recycle Bin** 會把勾選的圖片丟進真正的 Windows 回收筒，所以完全可以復原——點 **Undo** 或按 Ctrl+Z。

<div align="center">
  <img src="screenshots/results-selecting.png" alt="DPcleaner - 選取要丟到回收筒的圖片" width="800" />
</div>

## 功能

🔍 **相似度掃描。** 用 SSCD copy-detection embedding 找出重新存檔、縮放、壓縮、裁切、調色、或鏡像過的同一張插畫，門檻可即時調整。

🖼️ **並排比對。** 同步縮放、平移一個重複群組裡的所有圖片，讓同一個區域在每個版本間對齊。

🗑️ **批次清理 + 復原。** 跨群組選取、丟到系統回收筒，一鍵（或 Ctrl+Z）復原。

🔢 **批次重新命名 + 復原。** 把資料夾內的圖片重新編成乾淨的序號（001、002…），同樣可以復原。

🔎 **篩選與排序。** 依副檔名、檔名、最小群組大小縮小範圍；依相似度或建立時間排序。

🌐 **多語言。** 繁體中文、簡體中文、英文、日文，並支援深色 / 淺色主題。

## 常見問題

**為什麼第一次掃描要等比較久？**
SSCD 模型（約 94 MB）會在第一次使用時下載並快取到本機。之後同一個 session 內只有新增/變更的圖片需要重新計算 embedding。

**我的資料會被傳到哪裡去嗎？**
不會。掃描、embedding、回收筒操作全部都在本機執行，不會離開你的電腦。Embedding 快取刻意設計成只存在記憶體裡（每次重啟就清空），是為了隱私。

**為什麼只支援 Windows？**
回收筒整合（以及它的復原功能）是直接對接 Windows 的 `$Recycle.Bin` 格式實作的。跨平台支援目前不是這個學習專案的目標。

**需要 NVIDIA 顯卡嗎？**
不需要——打包好的安裝檔用的是 CPU 版模型，任何電腦都能跑。如果你是自己build，可以選擇裝 CUDA 版加速 embedding（見[開發](#開發)）。

## 技術棧

[Tauri](https://tauri.app/) · [FastAPI](https://fastapi.tiangolo.com/) · [React](https://react.dev/) + [Zustand](https://github.com/pmndrs/zustand) · [PyTorch](https://pytorch.org/) · Meta AI Research 的 [SSCD](https://github.com/facebookresearch/sscd-copy-detection) copy-detection 模型。

---

<details>
<summary><h2 style="display: inline;">開發</h2>（點擊展開）</summary>

以下內容只有想參與開發、看原始碼、或自己重新打包安裝檔的人才需要。

### 架構

```
DPcleaner/
├── src/            React + TypeScript 前端（Vite）
│   └── components/ 畫面與元件（Folders、Scanning、Results 等）
├── src-tauri/       Tauri（Rust）桌面殼，負責開視窗、拉起 Python 後端子行程
└── backend/         Python 後端（FastAPI + SSCD embedding 引擎）
    └── dpcleaner/   單一扁平 package：models/grouping（領域邏輯）、
                      embedder/scanner/renamer/trash_gateway_port（介面）、
                      fs_scanner/sscd_embedder/sqlite_repo/fs_renamer/trash_gateway（實作）、
                      dedupe/rename（服務層）、app/container/serializers/thumbs（API 層）
```

前端透過 REST（`/scan`、`/groups`、`/trash`…）+ WebSocket（`/ws` 掃描進度）跟後端溝通；Tauri 殼只負責拉起 Python 子行程並把 port/token 透過 `backend_info` 這個 command 交給前端。

### 開發環境安裝

**前端：**

```bash
npm install
```

**後端：**

```bash
python -m venv backend/.venv

# 依你的硬體選一種安裝 torch/torchvision：
backend/.venv/Scripts/pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124   # 有 NVIDIA 顯卡
# 或
backend/.venv/Scripts/pip install torch torchvision   # 沒有顯卡，用 CPU 版

backend/.venv/Scripts/pip install -r backend/requirements.txt
```

### 開發

```bash
npm run tauri dev
```

### 打包成安裝檔

後端要先用 PyInstaller 打包成獨立的 `dpcleaner-server.exe`，Tauri 才能把它一起包進安裝檔（Tauri 的 [externalBin](https://tauri.app/develop/sidecar/) 機制）。**打包用 CPU 版 torch**，不要用開發用的 `backend/.venv`（如果那邊裝的是 CUDA 版，包出來的安裝檔會變好幾 GB，而且只有裝對應顯卡的人能用）。

```bash
# 1. 建一個獨立的 CPU-only venv 專門用來打包（只需要建一次）
python -m venv backend/.venv-cpu
backend/.venv-cpu/Scripts/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
backend/.venv-cpu/Scripts/pip install -r backend/requirements.txt pyinstaller pyinstaller-hooks-contrib

# 2. 把 server_main.py 打包成單一 exe
backend/.venv-cpu/Scripts/pyinstaller \
  --name dpcleaner-server --onefile --noconsole \
  --distpath backend/dist_cpu --workpath backend/build --specpath backend \
  --paths backend backend/server_main.py

# 3. 放到 Tauri 的 sidecar 目錄，檔名要加上 rustc -vV 印出的 host target triple
mkdir -p src-tauri/binaries
cp backend/dist_cpu/dpcleaner-server.exe src-tauri/binaries/dpcleaner-server-x86_64-pc-windows-msvc.exe

# 4. 正式 build，產出 .msi 跟 -setup.exe 都在 src-tauri/target/release/bundle/
npm run tauri build
```

打包完拿 `src-tauri/target/release/desktop.exe` 直接跑（跟真的裝完一模一樣的目錄結構）可以快速驗證，不用每次都跑一遍安裝程式。

### 測試

```bash
npm run test                                    # Vitest + Testing Library（前端：store/groups 邏輯 + 全部元件）
backend/.venv/Scripts/python -m pytest backend/tests
```

### 靜態檢查

```bash
npm run lint            # ESLint（前端）
npm run format           # Prettier --write（前端）
backend/.venv/Scripts/ruff check backend      # ruff lint（後端）
backend/.venv/Scripts/ruff format backend     # ruff format（後端）
cd src-tauri && cargo clippy                  # clippy（Rust，需 rustup 內建元件）
```

### CI

`.github/workflows/ci.yml` 在每次 push / PR 時自動跑三個獨立 job：前端（tsc、eslint、prettier、vitest、build）、後端（ruff、pytest，CPU 版 torch）、Rust（cargo check、clippy）。

</details>

---

## 貢獻

這是個人學習專案，沒有太多心力長期維護，但歡迎回報 issue 或提交小型 PR（錯字修正、更清楚的錯誤訊息、翻譯修正）。

## Star History

<div align="center">

<a href="https://www.star-history.com/#0000workjason/DPcleaner&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=0000workjason/DPcleaner&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=0000workjason/DPcleaner&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=0000workjason/DPcleaner&type=Date" />
  </picture>
</a>

</div>

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) —— 允許非商業用途（學習、個人使用、修改），禁止商業使用。
