# DPcleaner

近似重複插畫偵測與清理工具（Pixiv / Twitter 圖片向）。用 SSCD copy-detection embedding 找出同一張插畫的不同版本（縮放、壓縮、裁切、調色、鏡像），讓使用者手動挑選要保留或丟到回收筒的版本，並支援資料夾內圖片的批次數字重新命名。

Windows 桌面應用，Tauri（Rust）殼 + Python 後端（FastAPI）+ React 前端。

## 架構

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

## 安裝

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

> ⚠️ `src-tauri/icons/*` 目前是驗證階段生成的實心色塊佔位圖，還不是正式圖示，之後要換成真的 app icon。

## 開發

```bash
npm run tauri dev
```

## 測試

```bash
backend/.venv/Scripts/python -m pytest backend/tests
```

## Lint / Format

```bash
npm run lint            # ESLint（前端）
npm run format           # Prettier --write（前端）
backend/.venv/Scripts/ruff check backend      # ruff lint（後端）
backend/.venv/Scripts/ruff format backend     # ruff format（後端）
cd src-tauri && cargo clippy                  # clippy（Rust，需 rustup 內建元件）
```
