# 股票篩選工具實作計畫

這是一份使用 Python、Pandas 和 Streamlit 建立強大、互動式股票篩選工具的完整計畫。該專案初期將使用 Yahoo Finance (`yfinance`) 擷取資料，隨後將轉換至 Financial Modeling Prep (FMP) API，以獲取更進階、更可靠的金融資料。

## 目標描述

建立一個基於網頁的股票篩選器，讓使用者能夠根據技術和基本面指標過濾和分析股票。此工具必須具備高效能、易於使用，且能夠同時處理多個股票代碼的資料。

## 開發階段與里程碑

### 階段一：基礎建設與 Yahoo Finance 整合 (MVP 最小可行性產品)
此階段的目標是建立核心網頁應用程式架構，並使用免費的 Yahoo Finance API 實作基本的資料擷取功能。

1. **環境建置**
   - 初始化 Python 專案（例如使用 `venv` 或 `poetry`）。
   - 安裝核心套件：`streamlit`, `pandas`, `yfinance`, `plotly`（用於互動式圖表）。
2. **資料層 (yfinance)**
   - 建立一個模組 (`data_fetcher.py`) 來處理 `yfinance` 的 API 呼叫。
   - 實作擷取歷史股價資料與基本股票資訊的函式。
3. **資料處理層 (Pandas)**
   - 建立一個模組 (`indicators.py`) 來計算標準技術指標（例如：簡單移動平均線 SMA、指數移動平均線 EMA、相對強弱指標 RSI、平滑異同移動平均線 MACD）。
4. **使用者介面架構 (Streamlit)**
   - 建立側邊欄供使用者輸入（股票代碼、日期範圍、指標參數）。
   - 建立主儀表板來顯示資料表（使用 `st.dataframe`）與價格圖表（使用 `st.plotly_chart`）。
5. **基礎篩選邏輯**
   - 實作一個過濾函式，根據使用者定義的條件（例如：價格 > SMA(50)，或 RSI < 30）對一系列股票代碼進行篩選。

### 階段二：進階功能與優化
在 MVP 的基礎上，提升效能、增加更多指標，並優化使用者體驗。

1. **效能優化**
   - 實作 Streamlit 的 `@st.cache_data` 來快取 API 回應和繁重的計算，以減少後續執行的載入時間。
   - 重構資料擷取邏輯，有效處理批次請求。
2. **進階篩選與指標**
   - 新增更多複雜的指標（布林通道、真實波動幅度 ATR）。
   - 實作「篩選器」預設條件（例如：「黃金交叉」、「超賣股票」）。
3. **資料匯出**
   - 透過 Streamlit 下載按鈕，新增匯出篩選結果為 CSV 或 Excel 格式的功能。

### 階段三：FMP API 整合與轉移
從 `yfinance` 轉移至 FMP API，以確保資料可靠性並存取更全面的金融數據集。

1. **API 金鑰管理**
   - 安全地處理 FMP API 金鑰，使用 Streamlit Secrets (`.streamlit/secrets.toml`) 或環境變數 (`.env`)。
2. **FMP 資料抽象層**
   - 擴充 `data_fetcher.py`，為資料提供者加入一個抽象基底類別 (或介面)。
   - 實作 FMP API 提供者類別，處理 API 速率限制與特定端點（報價、完整歷史價格、篩選器端點）。
3. **資料對齊與切換機制**
   - 確保 FMP 提供者回傳的資料結構符合 Pandas 處理層所預期的格式。
   - 在設定/側邊欄新增一個 UI 切換介面，讓使用者能順暢地在 `yfinance` 與 `FMP` 作為資料來源之間切換。
4. **善用 FMP 特定功能**
   - 利用 FMP 的進階篩選端點，在將資料引入 Pandas 之前進行伺服器端過濾，大幅提升掃描速度。

### 階段四：完善與部署
完成應用程式以供正式上線使用。

1. **UI/UX 完善**
   - 改善排版美觀度，如有必要可加入自訂 CSS。
   - 實作完善的錯誤處理（例如：無效的股票代碼、API 逾時）以及具描述性的使用者提示訊息 (Toast)。
2. **部署準備**
   - 建立 `requirements.txt` 或 `pyproject.toml`。
   - 撰寫 `Dockerfile` 進行容器化部署（選擇性）。
   - 準備部署至相關平台（例如 Streamlit Community Cloud、Heroku 或 Render）。

## 技術堆疊總結
- **語言**: Python 3.10+
- **前端框架**: Streamlit
- **資料處理**: Pandas, NumPy
- **資料視覺化**: Plotly (或選擇 Altair/Matplotlib)
- **資料來源**: `yfinance` (初期), `Financial Modeling Prep (FMP) API` (最終目標)

## 驗證計畫
### 自動化與手動測試
- 撰寫基本的單元測試 (`pytest`) 來驗證 Pandas 技術指標計算的數學正確性。
- 開發期間，手動驗證 UI 回應能力，並與知名平台 (如 TradingView) 的圖表資料進行交叉比對。
- 特別針對 FMP API 的錯誤處理進行測試 (認證失敗、速率限制)。
