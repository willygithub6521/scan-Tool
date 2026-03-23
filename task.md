# 股票篩選工具 - 任務清單

## 階段一：基礎建設與 Yahoo Finance 整合 (MVP)
- [ ] 設定 Python 專案環境 (`poetry` 或 `venv`)。
- [ ] 安裝相依套件 (`streamlit`, `pandas`, `yfinance`, `plotly`)。
- [ ] 標示 `app.py` 作為 Streamlit 主要進入點。
- [ ] 設計基礎 UI 架構：
  - [ ] 側邊欄供使用者輸入 (股票代碼、日期)。
  - [ ] 主畫面區域顯示資料表與圖表。
- [ ] 使用 `yfinance` 實作 `data_fetcher.py`：
  - [ ] 擷取歷史資料函式。
  - [ ] 擷取基本資訊函式。
- [ ] 使用 Pandas 實作 `indicators.py`：
  - [ ] 計算 SMA (簡單移動平均線), EMA (指數移動平均線)。
  - [ ] 計算 RSI (相對強弱指標), MACD (平滑異同移動平均線)。
- [ ] 將資料擷取與處理功能整合至 `app.py`。
- [ ] 建立基本掃描/過濾邏輯：
  - [ ] 依據簡易價格條件過濾 (例如：股價 > SMA50)。

## 階段二：進階功能與優化
- [ ] 實作資料快取 (`@st.cache_data`) 於 `app.py` 或 `data_fetcher.py`。
- [ ] 在 `indicators.py` 中新增更多指標：
  - [ ] 布林通道 (Bollinger Bands)。
  - [ ] 真實波動幅度 (ATR)。
- [ ] 建立接收多個股票代碼輸入的 UI 元件 (例如：逗號分隔清單或檔案上傳)。
- [ ] 在 UI 新增 CSV/Excel 匯出功能。
- [ ] 優化 UI 排版設計：
  - [ ] 新增「篩選器」、「圖表分析」與「原始資料」等頁籤。

## 階段三：FMP API 整合與轉移
- [ ] 重構 `data_fetcher.py`：
  - [ ] 為資料提供者建立抽象基底類別/介面。
  - [ ] 將現有的 `yfinance` 邏輯抽象化封裝為提供者類別。
- [ ] 實作 FMP API 提供者：
  - [ ] 透過 `.env` 或 Streamlit Secrets 設定 FMP API Key。
  - [ ] 實作 FMP 相關 API (完整歷史價格、報價)。
- [ ] 將 FMP 提供者整合至應用程式：
  - [ ] 新增 UI 切換按鈕來選擇資料來源 (`yfinance` 或 `FMP`)。
  - [ ] 更新資料處理管線以相容 FMP 特定的 JSON/DataFrame 結構。
- [ ] (選擇性) 實作 FMP API 篩選端點來執行伺服器端過濾。

## 階段四：完善與部署
- [ ] 新增錯誤處理與使用者提示訊息 (例如：「API 限制已達」、「無效的股票代碼」)。
- [ ] 完成 `requirements.txt` / `pyproject.toml` 定義。
- [ ] (選擇性) 建立 `Dockerfile` 進行容器化。
- [ ] 部署至目標環境 (例如：Streamlit Community Cloud)。
- [ ] 撰寫基礎的 README 專案文件。
